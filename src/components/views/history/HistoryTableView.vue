<script setup lang="ts">
import { ref, computed, onUnmounted, watch } from 'vue';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Checkbox from 'primevue/checkbox';
import Popover from 'primevue/popover';
import type PopoverType from 'primevue/popover';
import Skeleton from 'primevue/skeleton';
import type { HistoryItem, ServiceType } from '../../../config/types';
import { getServiceDisplayName } from '../../../constants/serviceNames';
import { getServiceIcon } from '../../../utils/icons';
import { formatFileSize } from '../../../utils/formatters';
import EmptyState from '../../common/EmptyState.vue';
import { useHistoryViewState } from '../../../composables/useHistoryViewState';
import { useHistoryManager } from '../../../composables/useHistory';
import { useConfigManager } from '../../../composables/useConfig';
import HistoryLightbox from './HistoryLightbox.vue';
import FloatingActionBar from './FloatingActionBar.vue';
import ThumbnailImage from '../../common/ThumbnailImage.vue';
import { getThumbnailCandidates } from '../../../composables/useThumbCache';
import { useHistoryTableData, isSkeleton } from '../../../composables/history/useHistoryTableData';
import { useHistoryBadgeLayout } from '../../../composables/history/useHistoryBadgeLayout';
import { useTableInteractions } from '../../../composables/history/useTableInteractions';

const props = defineProps<{
  filter: ServiceType | 'all';
  searchTerm: string;
  visible?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:totalCount', count: number): void;
}>();

const configManager = useConfigManager();
const viewState = useHistoryViewState();
const historyManager = useHistoryManager();

const isFilterActive = computed(() => !!(props.searchTerm || props.filter !== 'all'));
const tableViewRef = ref<HTMLElement | null>(null);
const servicePopoverRef = ref<InstanceType<typeof PopoverType> | null>(null);

// ---- Composables ----
const {
  setupBadgeWidthObserver,
  getVisibleCount,
  getCachedServices,
} = useHistoryBadgeLayout(tableViewRef);

const {
  currentPageData, currentPage, pageSize, totalRecords, totalPages, isLoadingPage, first,
  selectAll, skeletonData, formatTime,
  onPageChange, goToPage, peekPage, handleHeaderCheckboxChange, getSuccessfulServices, selectedAvailableServices,
} = useHistoryTableData({
  filter: computed(() => props.filter),
  searchTerm: computed(() => props.searchTerm),
  onPageLoaded: setupBadgeWidthObserver,
  viewState,
});

// 两种加载态语义拆分：
//  - showSkeleton：首次进入且无旧数据 → 显示骨架行（真的没东西可看）
//  - isPaginating：已有旧数据，翻页/筛选中 → 保持旧数据可读，仅 tbody 变暗
// 这样每次翻页只会触发一次 DataTable row diff（旧数据 → 新数据），
// 而不是 "旧数据 → skeleton(全删全插) → 新数据(全删全插)" 的三次渲染
const showSkeleton = computed(() => isLoadingPage.value && currentPageData.value.length === 0);
const isPaginating = computed(() => isLoadingPage.value && currentPageData.value.length > 0);

const {
  lightboxVisible, lightboxItem, lightboxHasPrev, lightboxHasNext,
  openLightbox, handleLightboxDelete, handleLightboxNavigate, handleToggleFavorite,
  resolveLightboxCloseTargetMode,
  popoverServices, openServicePopover, handlePopoverCopyLink, handleCopyServiceLink,
  hoverPreview, handlePreviewEnter, handlePreviewLeave,
} = useTableInteractions({
  currentPageData, currentPage, totalPages, goToPage,
  peekPage,
  getSuccessfulServices, servicePopoverRef,
});

// 收藏状态快路径：favoriteSet 来自 stats（loadStats/loadHistory 任一加载完即可）
// stats 未就绪时回退到 item.isFavorited（loadCurrentPage 已从 DB 直接读取，即时可用）
const isItemFavorited = (item: HistoryItem): boolean => {
  if (historyManager.favoriteSet.value.has(item.id)) return true;
  // stats 已加载：set 为权威源；未加载：用 item 自身字段兜底
  return historyManager.isStatsLoaded.value ? false : item.isFavorited === true;
};

// 三态收藏状态（MECE：none/partial/all），基于全局 favoriteSet 查询（无跨页限制）
const favoriteStateOfSelected = computed((): 'all' | 'partial' | 'none' => {
  const ids = viewState.selectedIdList.value;
  if (ids.length === 0) return 'none';
  const favSet = historyManager.favoriteSet.value;
  const favoritedCount = ids.filter(id => favSet.has(id)).length;
  if (favoritedCount === 0) return 'none';
  if (favoritedCount === ids.length) return 'all';
  return 'partial';
});

// ---- emit 联动 ----
watch(
  [() => totalRecords.value, () => props.visible],
  ([count, isVisible]) => {
    if (isVisible !== false) emit('update:totalCount', count);
  },
  { immediate: true },
);

onUnmounted(() => {
  viewState.reset();
});

// Shift+Click 支持：capture 阶段存 shiftKey，在 PrimeVue 的 update:model-value 回调中使用
let _shiftHeld = false;

function captureShiftState(event: MouseEvent) {
  _shiftHeld = event.shiftKey;
}

function handleCheckboxToggle(id: string) {
  const orderedIds = currentPageData.value
    .filter(item => !isSkeleton(item))
    .map(item => (item as HistoryItem).id);
  viewState.handleSelectClick(id, { shiftKey: _shiftHeld } as MouseEvent, orderedIds);
  _shiftHeld = false;
}
</script>

<template>
  <div ref="tableViewRef" class="table-view-container" :class="{ 'is-paginating': isPaginating }">
    <!-- 空状态：无数据时直接居中显示，不显示表格和表头 -->
    <div v-if="totalRecords === 0 && !isLoadingPage" class="empty-state-wrapper">
      <EmptyState
        :icon="isFilterActive ? 'pi pi-search' : 'pi pi-table'"
        :title="isFilterActive ? '没有找到匹配的记录' : '暂无上传记录'"
        :description="isFilterActive ? '尝试调整搜索关键词或筛选条件' : '上传图片后，历史记录将在这里显示'"
      />
    </div>

    <!-- 表格视图（服务端分页，首次无数据时用骨架；翻页期间保留旧数据 + dim） -->
    <DataTable
      v-else
      :value="showSkeleton ? skeletonData : currentPageData"
      dataKey="id"
      lazy
      :paginator="totalRecords > 0"
      :first="first"
      :rows="pageSize"
      :totalRecords="totalRecords"
      @page="onPageChange"
      sortField="timestamp"
      :sortOrder="-1"
      class="history-table minimal-table"
      rowHover
      :rowClass="(data: HistoryItem) => isSkeleton(data) ? '' : (viewState.isSelected(data.id) ? 'row-selected' : '')"
    >
      <template #empty>
        <EmptyState
          :icon="isFilterActive ? 'pi pi-search' : 'pi pi-table'"
          :title="isFilterActive ? '没有找到匹配的记录' : '暂无上传记录'"
          :description="isFilterActive ? '尝试调整搜索关键词或筛选条件' : '上传图片后，历史记录将在这里显示'"
        />
      </template>

      <!-- 复选框列（3rem 宽，给复选框右侧留出呼吸感） -->
      <Column headerStyle="width: 3rem">
        <template #header>
          <div class="col-center">
            <Checkbox
              v-if="!showSkeleton"
              :model-value="selectAll"
              @update:model-value="handleHeaderCheckboxChange"
              :binary="true"
              :indeterminate="currentPageData.some(item => viewState.isSelected(item.id)) && !selectAll"
            />
            <Skeleton v-else width="1.25rem" height="1.25rem" borderRadius="4px" />
          </div>
        </template>
        <template #body="slotProps">
          <div class="col-center" @click.capture="captureShiftState">
            <Skeleton v-if="isSkeleton(slotProps.data)" width="1.25rem" height="1.25rem" borderRadius="4px" />
            <Checkbox
              v-else
              :model-value="viewState.isSelected(slotProps.data.id)"
              @update:model-value="handleCheckboxToggle(slotProps.data.id)"
              :binary="true"
            />
          </div>
        </template>
      </Column>

      <!-- 收藏列（Gmail 模式，1.5rem 紧贴复选框） -->
      <Column headerStyle="width: 1.5rem">
        <template #header>
          <div class="col-center">
            <i class="pi pi-star header-fav-icon" />
          </div>
        </template>
        <template #body="slotProps">
          <div class="col-center">
            <Skeleton v-if="isSkeleton(slotProps.data)" width="1rem" height="1rem" borderRadius="2px" />
            <i
              v-else
              :class="['pi row-favorite-btn', isItemFavorited(slotProps.data) ? 'pi-star-fill favorited' : 'pi-star']"
              v-tooltip.top="isItemFavorited(slotProps.data) ? '取消收藏' : '收藏'"
              @click.stop="handleToggleFavorite(slotProps.data)"
            />
          </div>
        </template>
      </Column>

      <!-- 预览列 -->
      <Column header="预览" style="width: 64px">
        <template #body="slotProps">
          <!-- 骨架屏状态 - 使用与真实数据相同的结构 -->
          <div v-if="isSkeleton(slotProps.data)" class="thumb-preview-wrapper">
            <div class="thumb-box">
              <Skeleton width="100%" height="100%" borderRadius="0" />
            </div>
          </div>
          <!-- 真实数据 -->
          <div
            v-else
            class="thumb-preview-wrapper"
            @mouseenter="handlePreviewEnter($event, slotProps.data)"
            @mouseleave="handlePreviewLeave"
          >
            <div class="thumb-box" :data-lightbox-id="slotProps.data.id" @click="openLightbox(slotProps.data, $event)">
              <ThumbnailImage
                :srcs="getThumbnailCandidates(slotProps.data, configManager.config.value)"
                :alt="slotProps.data.localFileName"
                imageClass="thumb-img"
              >
                <template #placeholder>
                  <i class="pi pi-image thumb-placeholder"></i>
                </template>
              </ThumbnailImage>
            </div>
          </div>
        </template>
      </Column>

      <!-- 文件名列 -->
      <Column field="localFileName" header="文件名">
        <template #body="slotProps">
          <!-- 骨架屏状态 -->
          <div v-if="isSkeleton(slotProps.data)" class="filename-cell">
            <Skeleton width="70%" height="13px" />
            <Skeleton width="140px" height="11px" class="mt-skeleton" />
          </div>
          <!-- 真实数据 -->
          <div v-else class="filename-cell">
            <span class="fname">
              {{ slotProps.data.localFileName }}
            </span>
            <span class="fmeta">
              <span class="fmeta-date">{{ formatTime(slotProps.data.timestamp) }}</span>
              <template v-if="slotProps.data.fileSize">
                <span class="meta-dot">·</span>
                <span class="fmeta-size">{{ formatFileSize(slotProps.data.fileSize) }}</span>
              </template>
            </span>
          </div>
        </template>
      </Column>

      <!-- 已传图床列（固定 180px，确保两个典型中文图床 badge 可同时显示；headerClass 供 useHistoryBadgeLayout selector 精准定位）-->
      <Column header="已传图床" headerClass="history-badge-col" style="min-width: 180px; width: 30%">
        <template #body="{ data }">
          <Skeleton v-if="isSkeleton(data)" width="50px" height="22px" borderRadius="4px" />
          <!-- v-memo 依赖使用稳定的 visibleCount（离散值），避免列宽 ResizeObserver 1-2 像素抖动导致整表重渲 -->
          <div v-else v-memo="[data.id, data.results.length, getVisibleCount(getCachedServices(data))]" class="service-badges">
            <span
              v-for="serviceId in getCachedServices(data).slice(0, getVisibleCount(getCachedServices(data)))"
              :key="serviceId"
              class="service-badge-icon"
              v-tooltip.top="'点击复制链接'"
              @click="handleCopyServiceLink(data, serviceId)"
            >
              <span class="badge-icon" v-html="getServiceIcon(serviceId)" />
              <span class="badge-label">{{ getServiceDisplayName(serviceId) }}</span>
            </span>
            <span
              v-if="getCachedServices(data).length > getVisibleCount(getCachedServices(data))"
              class="service-badge-more"
              @click="openServicePopover($event, data)"
            >
              +{{ getCachedServices(data).length - getVisibleCount(getCachedServices(data)) }}
            </span>
          </div>
        </template>
      </Column>
    </DataTable>

    <!-- 图床服务 Popover -->
    <Popover ref="servicePopoverRef">
      <div class="service-popover-list">
        <button
          v-for="serviceId in popoverServices"
          :key="serviceId"
          class="service-popover-item"
          :aria-label="`复制 ${getServiceDisplayName(serviceId)} 链接`"
          @click="handlePopoverCopyLink(serviceId)"
        >
          <span class="badge-icon" v-html="getServiceIcon(serviceId)" />
          <span>{{ getServiceDisplayName(serviceId) }}</span>
          <i class="pi pi-copy" />
        </button>
      </div>
    </Popover>

    <!-- Lightbox -->
    <HistoryLightbox
      v-model:visible="lightboxVisible"
      :item="lightboxItem"
      :has-prev="lightboxHasPrev"
      :has-next="lightboxHasNext"
      :resolve-close-target-mode="resolveLightboxCloseTargetMode"
      @delete="handleLightboxDelete"
      @navigate="handleLightboxNavigate"
      @toggle-favorite="handleToggleFavorite"
    />

    <!-- 浮动操作栏 -->
    <FloatingActionBar
      :selected-count="viewState.selectedIdList.value.length"
      :visible="viewState.hasSelection.value"
      :available-services="selectedAvailableServices"
      :favorite-state="favoriteStateOfSelected"
      @copy="viewState.bulkCopyFormatted"
      @export="viewState.bulkExport"
      @delete="viewState.bulkDelete"
      @clear-selection="viewState.clearSelection"
      @batch-favorite="async (favorited: boolean) => { await historyManager.batchSetFavorite(viewState.selectedIdList.value, favorited); }"
    />

    <!-- 全局悬浮预览层 -->
    <Teleport to="body">
      <Transition name="thumb-preview">
        <div
          v-if="hoverPreview.visible && hoverPreview.url"
          class="global-thumb-hover-preview"
          :class="{ 'is-closing': hoverPreview.closing }"
          :data-lightbox-id="hoverPreview.itemId"
          :style="hoverPreview.style"
        >
          <img
            :src="hoverPreview.url"
            :alt="hoverPreview.alt"
            @error="(e: Event) => (e.target as HTMLImageElement).style.display = 'none'"
          />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<!-- DataTable 深度选择器样式（外部文件） -->
<style src="./history-table.css" scoped></style>

<style scoped>
.table-view-container {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.empty-state-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.history-table {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  overflow: hidden;
  width: 100%;
  flex: 1;
}
</style>

<!-- 全局样式（悬浮预览层） -->
<style>
.global-thumb-hover-preview {
  position: fixed;
  z-index: var(--z-modal);
  pointer-events: none;

  --preview-close-duration: 180ms;
}

.thumb-preview-enter-active {
  transition: opacity var(--duration-normal) ease, transform var(--duration-normal) ease;
}

.thumb-preview-enter-from {
  opacity: 0;
  transform: scale(0.92);
}

.thumb-preview-leave-active {
  transition:
    opacity var(--duration-medium) var(--ease-standard),
    filter var(--duration-medium) var(--ease-standard);
  will-change: opacity, filter;
}

.thumb-preview-leave-to {
  opacity: 0;
  filter: blur(3px);
}

.global-thumb-hover-preview img {
  max-width: 300px;
  max-height: 300px;
  border-radius: var(--radius-md);
  box-shadow: 0 8px 32px var(--photo-shadow-light);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  object-fit: contain;
  transition:
    opacity var(--preview-close-duration) var(--ease-standard),
    filter var(--preview-close-duration) var(--ease-standard),
    transform var(--preview-close-duration) var(--ease-standard);
  transition-delay: 0ms;
  transform: translateZ(0) scale(1);
}

.global-thumb-hover-preview.is-closing.thumb-preview-leave-active {
  transition: none;
}

.global-thumb-hover-preview.is-closing img {
  opacity: 0;
  filter: blur(2px);
}
</style>
