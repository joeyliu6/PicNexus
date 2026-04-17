<script setup lang="ts">
/** Timeline View — Google Photos 风格虚拟滚动图片浏览 */
import { ref, computed, onUnmounted, watch } from 'vue';
import { useHistoryViewState } from '../../composables/useHistoryViewState';
import { useHistoryManager } from '../../composables/useHistory';
import { useVirtualTimeline } from '../../composables/useVirtualTimeline';
import { useConfigManager } from '../../composables/useConfig';
import { useImageLoadManager } from '../../composables/useImageLoadManager';
import { useTimelineSidebarControl } from '../../composables/useTimelineSidebarControl';
import { useScrollRestore } from '../../composables/timeline/useScrollRestore';
import { useImagePreload } from '../../composables/timeline/useImagePreload';
import { useTimelineLightbox } from '../../composables/timeline/useTimelineLightbox';
import { useTimelineDragAndSkeleton } from '../../composables/timeline/useTimelineDragAndSkeleton';
import { useTimelineData } from '../../composables/timeline/useTimelineData';
import { useTimelineDayPagination } from '../../composables/timeline/useTimelineDayPagination';
import { useToast } from '../../composables/useToast';
import { type ServiceType } from '../../config/types';

import EmptyState from '../common/EmptyState.vue';
import TimelineSkeleton from './timeline/TimelineSkeleton.vue';
import TimelinePhotoGrid from './timeline/TimelinePhotoGrid.vue';
import TimelineIndicator from './timeline/TimelineIndicator.vue';
import HistoryLightbox from './history/HistoryLightbox.vue';
import FloatingActionBar from './history/FloatingActionBar.vue';

const props = defineProps<{
  filter?: ServiceType | 'all';
  searchTerm?: string;
  visible?: boolean;
  activationTrigger?: number;
  favoritesOnly?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:totalCount', count: number): void;
  (e: 'update:selectedCount', count: number): void;
}>();

const toast = useToast();
const viewState = useHistoryViewState();
const historyManager = useHistoryManager();
const configManager = useConfigManager();

const scrollContainer = ref<HTMLElement | null>(null);

const {
  isSidebarVisible,
  onScroll: onSidebarScroll,
  onSidebarEnter: handleSidebarEnter,
  onSidebarLeave: handleSidebarLeave,
  cleanup: cleanupSidebarControl,
} = useTimelineSidebarControl({ scrollHideDelay: 1000, hoverHideDelay: 300 });

// ==================== 服务端分页数据源 ====================

const timelinePagination = useTimelineDayPagination({
  filter: computed(() => props.filter ?? 'all'),
  searchTerm: computed(() => props.searchTerm ?? ''),
  favoritesOnly: computed(() => props.favoritesOnly ?? false),
  visible: computed(() => props.visible ?? false),
});
const { groups, dayStats, ensureDaysLoaded, totalCount: dayTotalCount, isLoadingStats } = timelinePagination;

/** 所有已加载天的 metas（展平），供选中操作和灯箱导航使用 */
const allLoadedMetas = computed(() => groups.value.flatMap(g => g.items));

// ==================== 工具函数 ====================

const { getThumbnailUrl, selectedAvailableServices, handleToggleFavorite, hoverDetailsMap, handleImageHover } = useTimelineData({
  filteredMetas: allLoadedMetas,
  favoriteSet: historyManager.favoriteSet,
  favoritesOnly: computed(() => props.favoritesOnly),
  selectedIdList: computed(() => viewState.selectedIdList.value),
  config: configManager.config,
  detailCache: viewState.detailCache,
  toggleFavorite: historyManager.toggleFavorite,
});

const {
  totalHeight,
  scrollTop: virtualScrollTop,
  scrollProgress,
  isCalculating,
  viewportHeight,
  displayMode,
  scrollDirection,
  visibleItems,
  visibleHeaders,
  layoutResult,
  visibleDayKeys,
  scrollToItem,
  scrollToProgress,
  forceUpdateVisibleArea,
  restoreScrollTop,
  handleScroll: virtualHandleScroll,
} = useVirtualTimeline(scrollContainer, groups, {
  targetRowHeight: 200,
  gap: 4,
  headerHeight: 48,
  groupGap: 24,
  overscan: 3,
});

const {
  loadedImages,
  failedImages,
  onImageLoad,
  onImageError,
  isImageLoaded,
  clearAll: clearImageLoadState,
} = useImageLoadManager(visibleItems, { maxCache: 500, destroyDelay: 2500, maxRetry: 1 });

const loadedImagesSet = computed(() => new Set(loadedImages.value));
const failedImagesSet = computed(() => new Set(failedImages.value));
const selectedIdsSet = computed(() => new Set(viewState.selectedIdList.value));

const { trackScrollPosition, setLastStableProgress } = useScrollRestore({
  scrollContainer,
  virtualScrollTop,
  totalHeight,
  viewportHeight,
  visibleItems,
  isCalculating,
  isLoading: isLoadingStats,
  visible: computed(() => props.visible),
  activationTrigger: computed(() => props.activationTrigger),
  callbacks: {
    restoreScrollTop,
    scrollToProgress,
    scrollToItem,
    forceUpdateVisibleArea,
    hasItem: (id: string) => layoutResult.value?.itemPositionMap.has(id) ?? false,
  },
});

const { cleanup: cleanupPreload } = useImagePreload({
  visibleItems,
  allMetas: allLoadedMetas,
  displayMode,
  scrollDirection,
  getThumbnailUrl,
  isImageLoaded,
  onImageLoad,
  onImageError,
});

const {
  lightboxVisible,
  lightboxItem,
  lightboxHasPrev,
  lightboxHasNext,
  openLightbox,
  handleLightboxDelete,
  handleLightboxNavigate,
} = useTimelineLightbox({
  dayMetaCache: timelinePagination.dayMetaCache,
  loadedDayKeys: timelinePagination.loadedDayKeys,
  ensureDaysLoaded,
  findDayBefore: timelinePagination.findDayBefore,
  findDayAfter: timelinePagination.findDayAfter,
  detailCache: viewState.detailCache,
  config: configManager.config,
  deleteHistoryItem: viewState.deleteHistoryItem,
  scrollToItem,
  toast,
});

const {
  showSkeleton,
  skeletonLayout,
  loadedMonthsSet,
  monthLayoutPositions,
  visibleRatio,
  getIsDragging,
  handleSidebarWheel,
  handleDragScroll,
  handleJumpToPeriod,
  handleJumpToYear,
  cleanup: cleanupDragAndSkeleton,
} = useTimelineDragAndSkeleton({
  scrollContainer,
  groups,
  isCalculating,
  visible: computed(() => props.visible),
  totalHeight,
  viewportHeight,
  layoutResult,
  timePeriodStats: computed(() => historyManager.timePeriodStats.value),
  setLastStableProgress,
  scrollToProgress,
  scrollToItem,
  forceUpdateVisibleArea,
  jumpToMonth: historyManager.jumpToMonth,
});

const handleScroll = () => {
  trackScrollPosition();
  virtualHandleScroll();
  if (!getIsDragging()) onSidebarScroll();
};

// 首次激活时加载时间段统计（侧边栏指示器需要）
watch(() => props.visible, (v) => { if (v) void historyManager.loadTimePeriodStats(); }, { once: true, immediate: true });

// 视口可见天变化 → 扩展 ±5 天缓冲区后按需加载
let ensureTimer: ReturnType<typeof setTimeout> | null = null;
watch(visibleDayKeys, (keys) => {
  if (ensureTimer) clearTimeout(ensureTimer);
  ensureTimer = setTimeout(() => {
    ensureTimer = null;
    if (keys.length === 0) return;
    const stats = dayStats.value;
    const keySet = new Set(keys);
    const indices = stats
      .map((s, i) => ({ key: `${s.year}-${s.month}-${s.day}`, i }))
      .filter(({ key }) => keySet.has(key))
      .map(({ i }) => i);
    if (indices.length === 0) return;
    const minIdx = Math.max(0, Math.min(...indices) - 5);
    const maxIdx = Math.min(stats.length - 1, Math.max(...indices) + 5);
    const buffered = stats.slice(minIdx, maxIdx + 1).map(s => `${s.year}-${s.month}-${s.day}`);
    void ensureDaysLoaded(buffered);
  }, 100);
});

onUnmounted(() => {
  if (ensureTimer) clearTimeout(ensureTimer);
  clearImageLoadState();
  cleanupSidebarControl();
  cleanupPreload();
  viewState.reset();
  cleanupDragAndSkeleton();
});

watch(
  dayTotalCount,
  (c) => { if (props.visible !== false) emit('update:totalCount', c); },
  { immediate: true }
);

watch(
  () => viewState.selectedIdList.value.length,
  (c) => emit('update:selectedCount', c),
  { immediate: true }
);

function handleItemToggleSelect(id: string, event: MouseEvent): void {
  const orderedIds = allLoadedMetas.value.map(m => m.id);
  viewState.handleSelectClick(id, event, orderedIds);
}
</script>

<template>
  <div class="timeline-view">
    <!-- Empty State -->
    <div v-if="groups.length === 0 && !isLoadingStats.value && !showSkeleton" class="empty-state-wrapper">
      <EmptyState
        :icon="favoritesOnly ? 'pi pi-star' : 'pi pi-images'"
        :title="favoritesOnly ? '暂无收藏' : '暂无上传记录'"
        :description="favoritesOnly ? '点击图片右上角的 ★ 开始收藏' : '上传图片后，历史记录将在这里显示'"
      />
    </div>

    <!-- Main Scroll Area -->
    <div v-else ref="scrollContainer" class="timeline-scroll-area" @scroll="handleScroll">
      <TimelineSkeleton
        v-if="isLoadingStats.value || showSkeleton"
        :layout="skeletonLayout"
      />

      <TimelinePhotoGrid
        v-else
        :groups="groups"
        :visible-items="visibleItems"
        :visible-headers="visibleHeaders"
        :total-height="totalHeight"
        :display-mode="displayMode"
        :selected-ids="selectedIdsSet"
        :favorite-ids="historyManager.favoriteSet.value"
        :has-selection="viewState.hasSelection.value"
        :loaded-images="loadedImagesSet"
        :failed-images="failedImagesSet"
        :hover-details-map="hoverDetailsMap"
        :get-thumbnail-url="getThumbnailUrl"
        @item-click="openLightbox"
        @item-toggle-select="handleItemToggleSelect"
        @item-toggle-favorite="handleToggleFavorite"
        @item-hover="handleImageHover"
        @image-load="onImageLoad"
        @image-error="onImageError"
      >
        <template #footer>
          共 {{ dayTotalCount.value }} 张照片
        </template>
      </TimelinePhotoGrid>

      <div style="height: 100px"></div>
    </div>

    <!-- Right Sidebar -->
    <div
      class="sidebar-wrapper"
      :class="{ visible: isSidebarVisible }"
      @mouseenter="handleSidebarEnter"
      @mouseleave="handleSidebarLeave"
      @wheel.prevent="handleSidebarWheel"
    >
      <TimelineIndicator
        :periods="historyManager.timePeriodStats.value"
        :scroll-progress="scrollProgress"
        :visible-ratio="visibleRatio"
        :total-height="totalHeight"
        :loaded-months="loadedMonthsSet"
        :month-layout-positions="monthLayoutPositions"
        @drag-scroll="handleDragScroll"
        @jump-to-period="handleJumpToPeriod"
        @jump-to-year="handleJumpToYear"
      />
    </div>

    <HistoryLightbox
      v-model:visible="lightboxVisible"
      :item="lightboxItem"
      :has-prev="lightboxHasPrev"
      :has-next="lightboxHasNext"
      @delete="handleLightboxDelete"
      @navigate="handleLightboxNavigate"
      @toggle-favorite="handleToggleFavorite"
    />

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

    <div v-if="isCalculating" class="layout-indicator">
      <i class="pi pi-spin pi-spinner"></i>
    </div>
  </div>
</template>

<style scoped>
.timeline-view {
  position: relative;
  height: 100%;
  display: flex;
  background: var(--bg-app);
  overflow: hidden;
}

.timeline-scroll-area {
  flex: 1;
  height: 100%;
  overflow: hidden auto;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 70px 为时间轴右侧留白，无对应 spacing token */
  padding: 0 70px 0 var(--space-lg-xl);
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.timeline-scroll-area::-webkit-scrollbar {
  display: none;
}

.sidebar-wrapper {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 120px;
  z-index: 20;
  background: transparent;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--duration-medium) ease;
  overflow: visible;
}

.sidebar-wrapper.visible {
  opacity: 1;
  pointer-events: auto;
}

.sidebar-wrapper > * {
  pointer-events: auto;
}

.empty-state-wrapper {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  background: var(--bg-app);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-3xl);
  height: 100%;
  color: var(--text-secondary);
}

.empty-state-hint {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
  margin-top: var(--space-xs);
}

.layout-indicator {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 40px;
  height: 40px;
  background: var(--bg-secondary);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- box-shadow 含 rgb 色值，无对应 CSS 变量 */
  box-shadow: 0 2px 8px rgb(0 0 0 / 20%);
  z-index: var(--z-dropdown);
}

.layout-indicator i {
  font-size: var(--text-lg-xl);
  color: var(--primary);
}

@media (width <= 1024px) {
  .timeline-scroll-area {
    /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 50px 为平板端时间轴右侧留白，无对应 spacing token */
    padding: 0 50px 0 var(--space-lg);
  }
}

@media (width <= 768px) {
  .timeline-scroll-area {
    padding: 0 var(--space-3xl) 0 var(--space-md);
  }

  .sidebar-wrapper {
    width: 52px;
  }
}

@media (width <= 480px) {
  .timeline-scroll-area {
    padding: 0 var(--space-sm);
  }

  .sidebar-wrapper {
    display: none;
  }
}
</style>
