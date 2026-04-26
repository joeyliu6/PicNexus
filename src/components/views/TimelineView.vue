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
import { useVisibleDayBuffer } from '../../composables/timeline/useVisibleDayBuffer';
import { useScrollAnchor } from '../../composables/timeline/useScrollAnchor';
import { useDebouncedTrue } from '../../composables/useDebouncedTrue';
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
const { groups, dayStats, ensureDaysLoaded, prefetchDayAspectRatios, loadedDayKeys, totalCount: dayTotalCount, isLoadingStats, hasLoadedStats, isFullyPreloaded } = timelinePagination;

/** 所有已加载天的 metas（展平），供选中操作和灯箱导航使用 */
const allLoadedMetas = computed(() => groups.value.flatMap(g => g.items));

// ==================== 工具函数 ====================

const { getThumbnailUrl, getThumbnailUrls, selectedAvailableServices, handleToggleFavorite, hoverDetailsMap, handleImageHover } = useTimelineData({
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
  visibleSkeletonSlots,
  visibleHeaders,
  fastModeItems,
  layoutResult,
  visibleDayKeys,
  scrollToItem,
  scrollToProgress,
  forceUpdateVisibleArea,
  forceNormalMode,
  restoreScrollTop,
  handleScroll: virtualHandleScroll,
} = useVirtualTimeline(scrollContainer, groups, {
  targetRowHeight: 200,
  gap: 4,
  headerHeight: 36,
  groupGap: 16,
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

// layout 重算时保持视口锚点 → 消除高度估算偏差导致的图片跳动
const { suspend: suspendScrollAnchor, resume: resumeScrollAnchor } = useScrollAnchor(scrollContainer, layoutResult, isCalculating, visibleItems);
// spinner 只在重算持续 >300ms 才显示 → 偶发重算不闪烁
const isCalculatingVisible = useDebouncedTrue(isCalculating, 300);

const {
  isJumping,
  isFirstLoadSkeleton,
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
  scrollProgress,
  viewportHeight,
  layoutResult,
  timePeriodStats: computed(() => historyManager.timePeriodStats.value),
  setLastStableProgress,
  scrollToProgress,
  scrollToItem,
  forceUpdateVisibleArea,
  jumpToMonth: historyManager.jumpToMonth,
  ensureDaysLoaded,
  prefetchDayAspectRatios,
  loadedDayKeys,
  isFullyPreloaded,
  hasLoadedStats,
  forceNormalMode,
  suspendScrollAnchor, resumeScrollAnchor,
});

const handleScroll = () => {
  trackScrollPosition();
  virtualHandleScroll();
  if (!getIsDragging()) onSidebarScroll();
};

// 激活时加载时间段统计（侧边栏指示器需要）；loadTimePeriodStats 内部幂等，可重复触发
watch(() => props.visible, (v) => { if (v) void historyManager.loadTimePeriodStats(); }, { immediate: true });

// 视口可见天 → ±5 天缓冲 → 按需加载
const { cleanup: cleanupVisibleDayBuffer } = useVisibleDayBuffer({ visibleDayKeys, dayStats, ensureDaysLoaded });

onUnmounted(() => {
  cleanupVisibleDayBuffer();
  clearImageLoadState();
  cleanupSidebarControl();
  cleanupPreload();
  viewState.reset();
  cleanupDragAndSkeleton();
});

// 同时 watch visible：Tab 切回来（false → true）时主动重发 totalCount，
// 避免父组件在不可见期间错过 dayTotalCount 变化、切回后顶栏计数停留在旧值
watch(
  [dayTotalCount, () => props.visible],
  ([c, isVisible]) => { if (isVisible !== false) emit('update:totalCount', c); },
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
  <div class="timeline-view" :class="{ 'is-jumping': isJumping || isFirstLoadSkeleton }">
    <!-- Empty State -->
    <div v-if="groups.length === 0 && !isLoadingStats" class="empty-state-wrapper">
      <EmptyState
        :icon="favoritesOnly ? 'pi pi-star' : 'pi pi-images'"
        :title="favoritesOnly ? '暂无收藏' : '暂无上传记录'"
        :description="favoritesOnly ? '点击图片右上角的 ★ 开始收藏' : '上传图片后，历史记录将在这里显示'"
      />
    </div>

    <!-- Main Scroll Area -->
    <div v-else ref="scrollContainer" class="timeline-scroll-area" @scroll="handleScroll">
      <div class="timeline-content-stack">

      <TimelinePhotoGrid
        :groups="groups"
        :visible-items="visibleItems"
        :visible-skeleton-slots="visibleSkeletonSlots"
        :visible-headers="visibleHeaders"
        :fast-mode-items="fastModeItems"
        :total-height="totalHeight"
        :display-mode="displayMode"
        :selected-ids="selectedIdsSet"
        :favorite-ids="historyManager.favoriteSet.value"
        :has-selection="viewState.hasSelection.value"
        :loaded-images="loadedImagesSet"
        :failed-images="failedImagesSet"
        :hover-details-map="hoverDetailsMap"
        :get-thumbnail-urls="getThumbnailUrls"
        @item-click="openLightbox"
        @item-toggle-select="handleItemToggleSelect"
        @item-toggle-favorite="handleToggleFavorite"
        @item-hover="handleImageHover"
        @image-load="onImageLoad"
        @image-error="onImageError"
      >
        <template #footer>共 {{ dayTotalCount }} 张照片</template>
      </TimelinePhotoGrid>

        <Transition name="t-fade-out">
          <TimelineSkeleton
            v-show="isLoadingStats && groups.length === 0"
            class="timeline-skeleton-overlay"
            :layout="skeletonLayout"
          />
        </Transition>
      </div>

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

    <div v-if="isCalculatingVisible" class="layout-indicator">
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

/* .is-jumping 跳转骨架（跨 TimelineView 根 + 子组件子元素，用全局样式） */

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

.timeline-content-stack {
  position: relative;
  min-height: 100%;
}

.timeline-skeleton-overlay {
  position: absolute;
  inset: 0;
  z-index: 8;
  pointer-events: none;
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

<style src="./timeline/timeline-jumping.css"></style>
