<script setup lang="ts">
import { ref, shallowRef, computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Checkbox from 'primevue/checkbox';
import Popover from 'primevue/popover';
import type PopoverType from 'primevue/popover';
import Skeleton from 'primevue/skeleton';
import type { HistoryItem, ServiceType } from '../../../config/types';
import { getPrimaryImageUrl } from '../../../utils/imageUrl';
import { getServiceDisplayName } from '../../../constants/serviceNames';
import { getServiceIcon } from '../../../utils/icons';
import { formatFileSize } from '../../../utils/formatters';
import { useHistoryViewState } from '../../../composables/useHistoryViewState';
import { useHistoryManager } from '../../../composables/useHistory';
import { useThumbCache } from '../../../composables/useThumbCache';
import { useConfigManager } from '../../../composables/useConfig';
import { useToast } from '../../../composables/useToast';
import { onCacheEventType } from '../../../events/cacheEvents';
import HistoryLightbox from './HistoryLightbox.vue';
import FloatingActionBar from './FloatingActionBar.vue';
import ThumbnailImage from '../../common/ThumbnailImage.vue';
import { getThumbnailCandidates } from '../../../composables/useThumbCache';

interface SkeletonItem {
  id: string;
  _skeleton: true;
}

const props = defineProps<{
  filter: ServiceType | 'all';
  searchTerm: string;
}>();

const emit = defineEmits<{
  (e: 'update:totalCount', count: number): void;
  (e: 'update:selectedCount', count: number): void;
}>();

const toast = useToast();
const configManager = useConfigManager();
const viewState = useHistoryViewState();
const historyManager = useHistoryManager();
const thumbCache = useThumbCache();

const PREVIEW_MAX_SIZE = 300;
const PREVIEW_MARGIN = 8;

const currentPageData = shallowRef<HistoryItem[]>([]);
const currentPage = ref(1);
const pageSize = ref(100);
const totalRecords = ref(0);
const isLoadingPage = ref(true);  // 初始为 true，组件挂载时显示骨架屏
const first = ref(0);

const DEFAULT_SKELETON_COUNT = 20;

function generateSkeletonData(count: number): SkeletonItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `skeleton-${i}`,
    _skeleton: true as const
  }));
}

const skeletonData = computed(() => {
  if (totalRecords.value > 0) {
    const remaining = totalRecords.value - (currentPage.value - 1) * pageSize.value;
    return generateSkeletonData(Math.min(pageSize.value, remaining));
  }
  return generateSkeletonData(DEFAULT_SKELETON_COUNT);
});

function isSkeleton(data: HistoryItem | SkeletonItem): data is SkeletonItem {
  return '_skeleton' in data && data._skeleton === true;
}

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});

function formatTime(timestamp: number): string {
  return dateFormatter.format(new Date(timestamp));
}

const lightboxVisible = ref(false);
const lightboxItem = ref<HistoryItem | null>(null);

const hoverPreview = ref({
  visible: false,
  url: '',
  alt: '',
  style: {} as Record<string, string>
});

const selectAll = ref(false);

let unlistenUpdated: (() => void) | null = null;
let unlistenDeleted: (() => void) | null = null;

async function loadCurrentPage() {
  try {
    isLoadingPage.value = true;

    const hasSearch = props.searchTerm?.trim();

    if (hasSearch) {
      const result = await historyManager.searchHistory(props.searchTerm, {
        serviceFilter: props.filter === 'all' ? undefined : props.filter,
        limit: pageSize.value,
        offset: (currentPage.value - 1) * pageSize.value
      });
      currentPageData.value = result.items;
      totalRecords.value = result.total;
    } else {
      const result = await historyManager.loadPageByNumber(
        currentPage.value,
        pageSize.value,
        props.filter
      );
      currentPageData.value = result.items;
      totalRecords.value = result.total;
    }

    console.log(`[HistoryTableView] 加载第 ${currentPage.value} 页: ${currentPageData.value.length}/${totalRecords.value} 条`);
  } catch (error) {
    console.error('[HistoryTableView] 加载失败:', error);
    toast.error('加载失败', String(error));
    currentPageData.value = [];
    totalRecords.value = 0;
  } finally {
    isLoadingPage.value = false;
    nextTick(() => setupBadgeWidthObserver());
  }
}

function onPageChange(event: { page: number; first: number; rows: number }) {
  if (isLoadingPage.value) return;
  currentPage.value = event.page + 1;  // PrimeVue 页码从 0 开始
  first.value = event.first;
  loadCurrentPage();
}

onMounted(async () => {
  unlistenUpdated = await onCacheEventType('history-updated', () => {
    currentPage.value = 1;
    first.value = 0;
    loadCurrentPage();
  });

  unlistenDeleted = await onCacheEventType('history-deleted', () => {
    loadCurrentPage();
  });

  await loadCurrentPage();
  nextTick(() => setupBadgeWidthObserver());
});

onUnmounted(() => {
  unlistenUpdated?.();
  unlistenDeleted?.();

  badgeResizeObserver?.disconnect();
  badgeResizeObserver = null;
  cancelAnimationFrame(resizeRafId);

  viewState.reset();
  thumbCache.clearThumbCache();
});

watch([() => props.filter, () => props.searchTerm], () => {
  currentPage.value = 1;
  first.value = 0;
  viewState.clearSelection();
  loadCurrentPage();
});

watch(() => totalRecords.value, (count) => {
  emit('update:totalCount', count);
}, { immediate: true });

watch(() => viewState.selectedIdList.value.length, (count) => {
  emit('update:selectedCount', count);
}, { immediate: true });

watch(() => {
  if (currentPageData.value.length === 0) return false;
  return currentPageData.value.every(item => viewState.isSelected(item.id));
}, (allSelected) => {
  selectAll.value = allSelected;
});

function getSuccessfulServices(item: HistoryItem): ServiceType[] {
  return item.results
    .filter(r => r.status === 'success')
    .map(r => r.serviceId);
}

const badgeColumnWidth = ref(200);
let badgeResizeObserver: ResizeObserver | null = null;
let resizeRafId = 0;

function setupBadgeWidthObserver(): void {
  if (badgeResizeObserver) return;
  const badge = document.querySelector('.service-badges') as HTMLElement | null;
  const td = badge?.closest('td') as HTMLElement | null;
  if (!td) return;

  badgeColumnWidth.value = td.clientWidth - 32; // clientWidth 含 padding，减去 16px * 2
  badgeResizeObserver = new ResizeObserver(entries => {
    cancelAnimationFrame(resizeRafId);
    resizeRafId = requestAnimationFrame(() => {
      for (const entry of entries) {
        badgeColumnWidth.value = entry.contentRect.width; // contentRect 已是 content box
      }
    });
  });
  badgeResizeObserver.observe(td);
}

const MORE_BTN_WIDTH = 30;
const BADGE_GAP = 4;
const BADGE_PADDING = 16;
const BADGE_ICON_WITH_GAP = 18; // icon(14) + gap(4)
const CHAR_WIDTH_ASCII = 7;
const CHAR_WIDTH_CJK = 12;

function estimateBadgeWidth(name: string): number {
  let textWidth = 0;
  for (const char of name) {
    textWidth += char.charCodeAt(0) > 0x7F ? CHAR_WIDTH_CJK : CHAR_WIDTH_ASCII;
  }
  return BADGE_PADDING + BADGE_ICON_WITH_GAP + textWidth;
}

function getVisibleCount(services: ServiceType[]): number {
  const available = badgeColumnWidth.value;
  let used = 0;
  let count = 0;

  for (let i = 0; i < services.length; i++) {
    const width = estimateBadgeWidth(getServiceDisplayName(services[i]));
    const gap = count > 0 ? BADGE_GAP : 0;
    const remaining = services.length - i - 1;
    const reserveMore = remaining > 0 ? MORE_BTN_WIDTH + BADGE_GAP : 0;

    if (used + gap + width + reserveMore > available && count > 0) break;
    used += gap + width;
    count++;
  }

  return Math.max(count, 1);
}

const servicePopoverRef = ref<InstanceType<typeof PopoverType> | null>(null);
const popoverItem = ref<HistoryItem | null>(null);

const popoverServices = computed<ServiceType[]>(() => {
  if (!popoverItem.value) return [];
  return getSuccessfulServices(popoverItem.value);
});

function openServicePopover(event: Event, item: HistoryItem): void {
  popoverItem.value = item;
  servicePopoverRef.value?.toggle(event);
}

function handlePopoverCopyLink(serviceId: ServiceType): void {
  if (!popoverItem.value) return;
  handleCopyServiceLink(popoverItem.value, serviceId);
}

async function handleCopyServiceLink(item: HistoryItem, serviceId: ServiceType): Promise<void> {
  try {
    const result = item.results.find(r => r.serviceId === serviceId && r.status === 'success');
    if (!result?.result?.url) {
      toast.warn('无可用链接', `${getServiceDisplayName(serviceId)} 图床没有可用的链接`);
      return;
    }

    let link = result.result.url;
    if (serviceId === 'weibo' && configManager.config.value.linkPrefixConfig) {
      const activePrefix = configManager.getActivePrefix(configManager.config.value.linkPrefixConfig);
      if (activePrefix) {
        link = `${activePrefix}${link}`;
      }
    }

    await writeText(link);
    toast.success('已复制', `${getServiceDisplayName(serviceId)} 链接已复制到剪贴板`, 1500);
  } catch (error) {
    console.error(`[历史记录] 复制 ${serviceId} 链接失败:`, error);
    toast.error('复制失败', String(error));
  }
}

function handlePreviewEnter(event: MouseEvent, item: HistoryItem): void {
  const url = thumbCache.getMediumImageUrl(item);
  if (!url) return;

  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();

  let top = rect.top + rect.height / 2 - PREVIEW_MAX_SIZE / 2;
  let left = rect.right + PREVIEW_MARGIN;

  if (top < PREVIEW_MARGIN) top = PREVIEW_MARGIN;
  if (top + PREVIEW_MAX_SIZE > window.innerHeight - PREVIEW_MARGIN) {
    top = window.innerHeight - PREVIEW_MAX_SIZE - PREVIEW_MARGIN;
  }
  if (left + PREVIEW_MAX_SIZE > window.innerWidth - PREVIEW_MARGIN) {
    left = rect.left - PREVIEW_MAX_SIZE - PREVIEW_MARGIN;
  }
  if (left < PREVIEW_MARGIN) {
    left = PREVIEW_MARGIN;
  }

  hoverPreview.value = {
    visible: true,
    url,
    alt: item.localFileName,
    style: {
      top: `${top}px`,
      left: `${left}px`
    }
  };
}

function handlePreviewLeave(): void {
  hoverPreview.value.visible = false;
}

const lightboxIndex = computed(() => {
  if (!lightboxItem.value) return -1;
  return currentPageData.value.findIndex(item => item.id === lightboxItem.value!.id);
});

const lightboxHasPrev = computed(() => lightboxIndex.value > 0);
const lightboxHasNext = computed(() =>
  lightboxIndex.value >= 0 && lightboxIndex.value < currentPageData.value.length - 1
);

function openLightbox(item: HistoryItem): void {
  lightboxItem.value = item;
  lightboxVisible.value = true;
}

async function handleLightboxDelete(item: HistoryItem): Promise<void> {
  try {
    await viewState.deleteHistoryItem(item.id);
    lightboxVisible.value = false;
    toast.success('已删除', '1 条记录');
  } catch (error) {
    console.error('[历史记录] 删除失败:', error);
    toast.error('删除失败', String(error));
  }
}

function getItemImageUrl(item: HistoryItem): string {
  return getPrimaryImageUrl(item, configManager.config.value);
}

function preloadAdjacentImage(currentIdx: number, direction: 'prev' | 'next'): void {
  const preloadIdx = direction === 'prev' ? currentIdx - 1 : currentIdx + 1;
  if (preloadIdx < 0 || preloadIdx >= currentPageData.value.length) return;
  const url = getItemImageUrl(currentPageData.value[preloadIdx]);
  if (url) new Image().src = url;
}

function handleLightboxNavigate(direction: 'prev' | 'next'): void {
  const idx = lightboxIndex.value;
  const nextIdx = direction === 'prev' ? idx - 1 : idx + 1;
  if (nextIdx < 0 || nextIdx >= currentPageData.value.length) return;
  lightboxItem.value = currentPageData.value[nextIdx];
  preloadAdjacentImage(nextIdx, direction);
}

function handleHeaderCheckboxChange(checked: boolean): void {
  selectAll.value = checked;
  currentPageData.value.forEach(item => {
    if (checked) {
      viewState.select(item.id);
    } else {
      viewState.deselect(item.id);
    }
  });
}

const selectedAvailableServices = computed<ServiceType[]>(() => {
  const ids = viewState.selectedIdList.value;
  if (ids.length === 0) return [];
  const serviceSet = new Set<ServiceType>();
  for (const item of currentPageData.value) {
    if (!ids.includes(item.id)) continue;
    for (const r of item.results) {
      if (r.status === 'success') serviceSet.add(r.serviceId);
    }
  }
  return Array.from(serviceSet);
});

</script>

<template>
  <div class="table-view-container" :class="{ 'has-selection': viewState.hasSelection.value, 'is-loading': isLoadingPage }">
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
      :rowClass="(data: HistoryItem | SkeletonItem) => isSkeleton(data) ? '' : (viewState.isSelected(data.id) ? 'row-selected' : '')"
      :emptyMessage="totalRecords === 0 ? '暂无历史记录' : '未找到匹配的记录'"
    >
      <template #empty>
        <div class="empty-state">
          <i class="pi pi-folder-open"></i>
          <p>没有找到相关记录</p>
        </div>
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
      <Column header="预览" style="width: 60px">
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
            <div class="thumb-box" @click="openLightbox(slotProps.data)">
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
      <Column field="localFileName" header="文件名" sortable style="width: 285px">
        <template #body="slotProps">
          <!-- 骨架屏状态 -->
          <div v-if="isSkeleton(slotProps.data)" class="filename-cell">
            <Skeleton width="70%" height="13px" />
            <Skeleton width="140px" height="11px" class="mt-skeleton" />
          </div>
          <!-- 真实数据 -->
          <div v-else class="filename-cell">
            <span class="fname" :title="slotProps.data.localFileName">
              {{ slotProps.data.localFileName }}
            </span>
            <span class="fmeta">
              {{ formatTime(slotProps.data.timestamp) }}
              <template v-if="slotProps.data.fileSize">
                <span class="meta-dot">·</span>{{ formatFileSize(slotProps.data.fileSize) }}
              </template>
            </span>
          </div>
        </template>
      </Column>

      <!-- 已传图床列 -->
      <Column header="已传图床" style="min-width: 120px">
        <template #body="{ data }">
          <Skeleton v-if="isSkeleton(data)" width="50px" height="22px" borderRadius="4px" />
          <div v-else class="service-badges">
            <TransitionGroup name="badge-pop">
              <span
                v-for="serviceId in getSuccessfulServices(data).slice(0, getVisibleCount(getSuccessfulServices(data)))"
                :key="serviceId"
                class="service-badge-icon"
                :title="`点击复制 ${getServiceDisplayName(serviceId)} 链接`"
                @click="handleCopyServiceLink(data, serviceId)"
              >
                <span class="badge-icon" v-html="getServiceIcon(serviceId)" />
                <span class="badge-label">{{ getServiceDisplayName(serviceId) }}</span>
              </span>
              <span
                v-if="getSuccessfulServices(data).length > getVisibleCount(getSuccessfulServices(data))"
                :key="'more-' + getVisibleCount(getSuccessfulServices(data))"
                class="service-badge-more"
                @click="openServicePopover($event, data)"
              >
                +{{ getSuccessfulServices(data).length - getVisibleCount(getSuccessfulServices(data)) }}
              </span>
            </TransitionGroup>
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
    />

    <!-- 全局悬浮预览层 -->
    <Teleport to="body">
      <div
        v-if="hoverPreview.visible && hoverPreview.url"
        class="global-thumb-hover-preview"
        :style="hoverPreview.style"
      >
        <img
          :src="hoverPreview.url"
          :alt="hoverPreview.alt"
          @error="(e: Event) => (e.target as HTMLImageElement).style.display = 'none'"
        />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.table-view-container {
  height: 100%;
}

.table-view-container.has-selection {
  padding-bottom: 80px;
}

.table-view-container.is-loading :deep(.p-paginator) {
  opacity: 0.5;
  pointer-events: none;
}

.history-table {
  background: var(--bg-card);
  border-radius: 12px;
  overflow: hidden;
  width: 100%;
}

:deep(.minimal-table .p-datatable-table) {
  table-layout: fixed;
}

:deep(.history-table .p-datatable-table-container) {
  overflow: visible !important;
}

:deep(.minimal-table .p-datatable-thead > tr > th) {
  background: var(--bg-card) !important;
  border-bottom: 2px solid var(--border-subtle) !important;
  padding: 10px 16px !important;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  height: 40px !important;  /* 固定表头高度 */
  box-sizing: border-box;
}

:deep(.minimal-table .p-datatable-tbody > tr) {
  background: transparent !important;
}

:deep(.minimal-table .p-datatable-tbody > tr:nth-child(even)) {
  background: rgba(0, 0, 0, 0.015) !important;
}

:deep(.minimal-table .p-datatable-tbody > tr:hover) {
  background: var(--primary-alpha-8) !important;
}

:root.dark-theme :deep(.minimal-table .p-datatable-tbody > tr:hover) {
  background: var(--primary-alpha-15) !important;
}

:deep(.minimal-table .p-datatable-tbody > tr.row-selected) {
  background: var(--primary-alpha-12) !important;
}

:root.dark-theme :deep(.minimal-table .p-datatable-tbody > tr.row-selected) {
  background: var(--primary-alpha-18) !important;
}

:deep(.minimal-table .p-datatable-tbody > tr.row-selected:hover) {
  background: var(--primary-alpha-16) !important;
}

:root.dark-theme :deep(.minimal-table .p-datatable-tbody > tr.row-selected:hover) {
  background: var(--primary-alpha-22) !important;
}

:deep(.minimal-table .p-datatable-tbody > tr > td) {
  padding: 8px 16px !important;
  border-bottom: 1px solid var(--border-subtle) !important;
  font-size: 13px;
  vertical-align: middle;
  height: 52px !important;  /* 固定行高，与骨架屏一致 */
  box-sizing: border-box;
}

.thumb-box {
  width: 36px;
  height: 36px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  cursor: zoom-in;
  background: var(--bg-input);
  display: inline-block;
  position: relative;  /* 确保子元素可以绝对定位 */
}

.thumb-skeleton {
  position: absolute;
  inset: 0;
  width: 100% !important;
  height: 100% !important;
  border-radius: 0;
  z-index: 0;
}

.thumb-img {
  position: absolute;
  inset: 0;
  z-index: 1;  /* 图片在骨架屏之上 */
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-placeholder {
  font-size: 1.5rem;
  color: var(--text-muted);
  opacity: 0.5;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.thumb-preview-wrapper {
  position: relative;
  display: inline-block;
}

.filename-cell {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.fname {
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fmeta {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.meta-dot {
  margin: 0 4px;
  opacity: 0.5;
}

.service-badges {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: nowrap;
  overflow: hidden;
  position: relative;
}

.service-badge-icon {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: var(--primary-alpha-10);
  border-radius: 4px;
  font-size: 11px;
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
  flex-shrink: 0;
}

.service-badge-icon:hover {
  background: var(--primary-alpha-15);
}

.badge-icon {
  width: 14px;
  height: 14px;
  display: inline-flex;
  flex-shrink: 0;
  color: var(--text-muted);
}

.badge-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.badge-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.service-badge-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px 6px;
  background: var(--bg-input);
  border-radius: 4px;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s;
}

.service-badge-more:hover {
  background: var(--primary-alpha-15);
  color: var(--text-primary);
}

.badge-pop-enter-active {
  animation: badgeBounceIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.badge-pop-leave-active {
  display: none;
}

.badge-pop-move {
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes badgeBounceIn {
  0% {
    opacity: 0;
    transform: scale(0.3);
  }
  70% {
    transform: scale(1.08);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

.service-popover-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 140px;
}

.service-popover-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: none;
  background: none;
  width: 100%;
  text-align: left;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  color: var(--text-primary);
  transition: background 0.15s;
}

.service-popover-item:hover {
  background: var(--primary-alpha-10);
}

.service-popover-item .pi-copy {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0;
  transition: opacity 0.15s;
}

.service-popover-item:hover .pi-copy {
  opacity: 1;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: var(--text-muted);
  gap: 16px;
}

.empty-state i {
  font-size: 48px;
  opacity: 0.5;
}

.mt-1 {
  margin-top: 4px;
}

.mt-skeleton {
  margin-top: 2px;
}

:deep(.minimal-table .p-datatable-tbody .p-skeleton) {
  display: inline-block !important;
  vertical-align: middle;
}
</style>

<!-- 全局样式（悬浮预览层） -->
<style>
.global-thumb-hover-preview {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  animation: globalPreviewFadeIn 0.2s ease;
}

@keyframes globalPreviewFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.global-thumb-hover-preview img {
  max-width: 300px;
  max-height: 300px;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  object-fit: contain;
}
</style>
