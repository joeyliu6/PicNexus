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
import { useThumbCache } from '../../../composables/useThumbCache';
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
  (e: 'update:selectedCount', count: number): void;
}>();

const configManager = useConfigManager();
const viewState = useHistoryViewState();
const historyManager = useHistoryManager();
const thumbCache = useThumbCache();

const isFilterActive = computed(() => !!(props.searchTerm || props.filter !== 'all'));
const tableViewRef = ref<HTMLElement | null>(null);
const servicePopoverRef = ref<InstanceType<typeof PopoverType> | null>(null);

// ---- Composables ----
const { setupBadgeWidthObserver, getVisibleCount } = useHistoryBadgeLayout(tableViewRef);

const {
  currentPageData, pageSize, totalRecords, isLoadingPage, first,
  selectAll, skeletonData, formatTime,
  onPageChange, handleHeaderCheckboxChange, getSuccessfulServices, selectedAvailableServices,
} = useHistoryTableData({
  filter: computed(() => props.filter),
  searchTerm: computed(() => props.searchTerm),
  onPageLoaded: setupBadgeWidthObserver,
});

const {
  lightboxVisible, lightboxItem, lightboxHasPrev, lightboxHasNext,
  openLightbox, handleLightboxDelete, handleLightboxNavigate, handleToggleFavorite,
  popoverServices, openServicePopover, handlePopoverCopyLink, handleCopyServiceLink,
  hoverPreview, handlePreviewEnter, handlePreviewLeave,
} = useTableInteractions({ currentPageData, getSuccessfulServices, servicePopoverRef });

// ---- emit 联动 ----
watch(
  [() => totalRecords.value, () => props.visible],
  ([count, isVisible]) => {
    if (isVisible !== false) emit('update:totalCount', count);
  },
  { immediate: true },
);

watch(() => viewState.selectedIdList.value.length, (count) => {
  emit('update:selectedCount', count);
}, { immediate: true });

onUnmounted(() => {
  viewState.reset();
  thumbCache.clearThumbCache();
});
</script>

<template>
  <div ref="tableViewRef" class="table-view-container" :class="{ 'has-selection': viewState.hasSelection.value, 'is-loading': isLoadingPage }">
    <!-- 表格视图（服务端分页，加载时使用骨架数据） -->
    <DataTable
      :value="isLoadingPage ? skeletonData : currentPageData"
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
      :emptyMessage="totalRecords === 0 ? '暂无历史记录' : '未找到匹配的记录'"
    >
      <template #empty>
        <EmptyState
          :icon="isFilterActive ? 'pi pi-search' : 'pi pi-images'"
          :title="isFilterActive ? '没有找到匹配的记录' : '暂无上传记录'"
          :description="isFilterActive ? '尝试调整搜索关键词或筛选条件' : '上传图片后，历史记录将在这里显示'"
        />
      </template>

      <!-- 复选框列 -->
      <Column headerStyle="width: 3rem">
        <template #header>
          <Checkbox
            v-if="!isLoadingPage"
            :model-value="selectAll"
            @update:model-value="handleHeaderCheckboxChange"
            :binary="true"
            :indeterminate="currentPageData.some(item => viewState.isSelected(item.id)) && !selectAll"
          />
          <Skeleton v-else width="1.25rem" height="1.25rem" borderRadius="4px" />
        </template>
        <template #body="slotProps">
          <Skeleton v-if="isSkeleton(slotProps.data)" width="1.25rem" height="1.25rem" borderRadius="4px" />
          <Checkbox
            v-else
            :model-value="viewState.isSelected(slotProps.data.id)"
            @update:model-value="viewState.toggleSelection(slotProps.data.id)"
            :binary="true"
          />
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
            <div class="thumb-box" :data-lightbox-id="slotProps.data.id" @click="openLightbox(slotProps.data)">
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
            <span class="fname" v-tooltip.top="slotProps.data.localFileName">
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

      <!-- 已传图床列 -->
      <Column header="已传图床" style="min-width: 180px; width: 30%">
        <template #body="{ data }">
          <Skeleton v-if="isSkeleton(data)" width="50px" height="22px" borderRadius="4px" />
          <!-- v-memo 确保同一条记录不因父组件重渲染而重复执行 getSuccessfulServices；用 length 而非引用比较，因为数据库查询每次返回新数组 -->
          <div v-else v-memo="[data.id, data.results.length]" class="service-badges">
            <span
              v-for="serviceId in getSuccessfulServices(data).slice(0, getVisibleCount(getSuccessfulServices(data)))"
              :key="serviceId"
              class="service-badge-icon"
              v-tooltip.top="`点击复制 ${getServiceDisplayName(serviceId)} 链接`"
              @click="handleCopyServiceLink(data, serviceId)"
            >
              <span class="badge-icon" v-html="getServiceIcon(serviceId)" />
              <span class="badge-label">{{ getServiceDisplayName(serviceId) }}</span>
            </span>
            <span
              v-if="getSuccessfulServices(data).length > getVisibleCount(getSuccessfulServices(data))"
              class="service-badge-more"
              @click="openServicePopover($event, data)"
            >
              +{{ getSuccessfulServices(data).length - getVisibleCount(getSuccessfulServices(data)) }}
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
      @delete="handleLightboxDelete"
      @navigate="handleLightboxNavigate"
      @toggle-favorite="handleToggleFavorite"
    />

    <!-- 浮动操作栏 -->
    <FloatingActionBar
      :selected-count="viewState.selectedIdList.value.length"
      :visible="viewState.hasSelection.value"
      :available-services="selectedAvailableServices"
      @copy="viewState.bulkCopyFormatted"
      @export="viewState.bulkExport"
      @delete="viewState.bulkDelete"
      @clear-selection="viewState.clearSelection"
      @batch-favorite="(favorited: boolean) => historyManager.batchSetFavorite(viewState.selectedIdList.value, favorited)"
    />

    <!-- 全局悬浮预览层 -->
    <Teleport to="body">
      <Transition name="thumb-preview">
        <div
          v-if="hoverPreview.visible && hoverPreview.url"
          class="global-thumb-hover-preview"
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
  height: 100%;
}

.table-view-container.has-selection {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 底部浮动操作栏的固定留白高度，非间距 token */
  padding-bottom: 80px;
}

.history-table {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  overflow: hidden;
  width: 100%;
}
</style>

<!-- 全局样式（悬浮预览层） -->
<style>
.global-thumb-hover-preview {
  position: fixed;
  z-index: var(--z-lightbox);
  pointer-events: none;
}

.thumb-preview-enter-active {
  transition: opacity var(--duration-normal) ease, transform var(--duration-normal) ease;
}

.thumb-preview-enter-from {
  opacity: 0;
  transform: scale(0.92);
}

.thumb-preview-leave-active {
  transition: opacity var(--duration-fast) ease, transform var(--duration-fast) ease;
}

.thumb-preview-leave-to {
  opacity: 0;
  transform: scale(0.92);
}

.global-thumb-hover-preview img {
  max-width: 300px;
  max-height: 300px;
  border-radius: var(--radius-md);
  box-shadow: 0 8px 32px var(--photo-shadow-light);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  object-fit: contain;
}
</style>
