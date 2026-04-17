<script setup lang="ts">
/** Timeline View — Google Photos 风格虚拟滚动图片浏览 */
import { ref, computed, onUnmounted, watch, nextTick } from 'vue';
import { useHistoryViewState } from '../../composables/useHistoryViewState';
import { useHistoryManager } from '../../composables/useHistory';
import { useLazyLoadOnVisible } from '../../composables/useLazyLoadOnVisible';
import { useVirtualTimeline } from '../../composables/useVirtualTimeline';
import { useConfigManager } from '../../composables/useConfig';
import { useImageMetadataFixer } from '../../composables/useImageMetadataFixer';
import { useImageLoadManager } from '../../composables/useImageLoadManager';
import { useTimelineSidebarControl } from '../../composables/useTimelineSidebarControl';
import { useScrollRestore } from '../../composables/timeline/useScrollRestore';
import { useImagePreload } from '../../composables/timeline/useImagePreload';
import { useTimelineLightbox } from '../../composables/timeline/useTimelineLightbox';
import { useTimelineDragAndSkeleton } from '../../composables/timeline/useTimelineDragAndSkeleton';
import { useTimelineData } from '../../composables/timeline/useTimelineData';
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
const metadataFixer = useImageMetadataFixer();
const configManager = useConfigManager();

// Scroll container ref
const scrollContainer = ref<HTMLElement | null>(null);

// Sidebar Control
const {
  isSidebarVisible,
  onScroll: onSidebarScroll,
  onSidebarEnter: handleSidebarEnter,
  onSidebarLeave: handleSidebarLeave,
  cleanup: cleanupSidebarControl,
} = useTimelineSidebarControl({
  scrollHideDelay: 1000,
  hoverHideDelay: 300,
});

// ==================== 核心数据 ====================

const {
  groups,
  getThumbnailUrl,
  selectedAvailableServices,
  handleToggleFavorite,
  hoverDetailsMap,
  handleImageHover,
} = useTimelineData({
  filteredMetas: computed(() => viewState.filteredMetas.value),
  favoriteSet: historyManager.favoriteSet,
  favoritesOnly: computed(() => props.favoritesOnly),
  selectedIdList: computed(() => viewState.selectedIdList.value),
  config: configManager.config,
  detailCache: viewState.detailCache,
  toggleFavorite: historyManager.toggleFavorite,
});

const {
  // 状态
  totalHeight,
  scrollTop: virtualScrollTop,
  scrollProgress,
  isCalculating,
  viewportHeight,

  // 三阶段渲染状态（仅用于控制图片加载行为）
  displayMode,
  scrollDirection,

  // 可见数据
  visibleItems,
  visibleHeaders,

  // 布局数据
  layoutResult,

  // 方法
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
} = useImageLoadManager(visibleItems, {
  maxCache: 500,
  destroyDelay: 2500,
  maxRetry: 1,
});

// 转换为 Set 供子组件使用
const loadedImagesSet = computed(() => new Set(loadedImages.value));
const failedImagesSet = computed(() => new Set(failedImages.value));
const selectedIdsSet = computed(() => new Set(viewState.selectedIdList.value));

// ==================== 滚动位置保存与恢复 ====================

const {
  trackScrollPosition,
  setLastStableProgress,
} = useScrollRestore({
  scrollContainer,
  virtualScrollTop,
  totalHeight,
  viewportHeight,
  visibleItems,
  isCalculating,
  isLoading: viewState.isLoading,
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

// ==================== 智能预加载 ====================

const { cleanup: cleanupPreload } = useImagePreload({
  visibleItems,
  allMetas: computed(() => viewState.filteredMetas.value),
  displayMode,
  scrollDirection,
  getThumbnailUrl,
  isImageLoaded,
  onImageLoad,
  onImageError,
});

// ==================== 灯箱 ====================

const {
  lightboxVisible,
  lightboxItem,
  lightboxHasPrev,
  lightboxHasNext,
  openLightbox,
  handleLightboxDelete,
  handleLightboxNavigate,
} = useTimelineLightbox({
  filteredMetas: computed(() => viewState.filteredMetas.value),
  detailCache: viewState.detailCache,
  config: configManager.config,
  deleteHistoryItem: viewState.deleteHistoryItem,
  scrollToItem,
  toast,
});

// ==================== 拖拽 + 骨架屏 ====================

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

/** 滚动事件处理 */
const handleScroll = () => {
  trackScrollPosition();
  virtualHandleScroll();

  if (!getIsDragging()) {
    onSidebarScroll();
  }
};


// 视图激活时才加载全量 metas（避免首屏被迫加载 3 万条 JSON.parse）
useLazyLoadOnVisible(() => props.visible, async () => {
  await Promise.all([
    viewState.loadHistory(),
    historyManager.loadTimePeriodStats(),
  ]);
  nextTick(() => {
    const metas = viewState.filteredMetas.value;
    const needsFix = metas.filter((meta) => !meta.aspectRatio || meta.aspectRatio <= 0);
    if (needsFix.length > 0) {
      metadataFixer.batchFixMissingMetadata(needsFix);
    }
  });
});

onUnmounted(() => {
  clearImageLoadState();
  cleanupSidebarControl();
  cleanupPreload();

  viewState.reset();
  metadataFixer.flushNow();

  cleanupDragAndSkeleton();
});

watch(
  () => props.filter,
  (val) => {
    if (val) viewState.setFilter(val);
  },
  { immediate: true }
);

watch(
  () => props.searchTerm,
  (val) => {
    if (val !== undefined) viewState.setSearchTerm(val);
  },
  { immediate: true }
);

watch(
  [() => viewState.filteredMetas.value.length, () => props.visible],
  ([c, isVisible]) => {
    if (isVisible !== false) emit('update:totalCount', c);
  },
  { immediate: true }
);

watch(
  () => viewState.selectedIdList.value.length,
  (c) => emit('update:selectedCount', c),
  { immediate: true }
);

function handleItemToggleSelect(id: string, event: MouseEvent): void {
  const orderedIds = viewState.filteredMetas.value.map(m => m.id);
  viewState.handleSelectClick(id, event, orderedIds);
}
</script>

<template>
  <div class="timeline-view">
    <!-- Empty State - 提升到视图层级，覆盖整个视口 -->
    <div v-if="groups.length === 0 && !viewState.isLoading.value && !showSkeleton" class="empty-state-wrapper">
      <EmptyState
        :icon="favoritesOnly ? 'pi pi-star' : 'pi pi-images'"
        :title="favoritesOnly ? '暂无收藏' : '暂无上传记录'"
        :description="favoritesOnly ? '点击图片右上角的 ★ 开始收藏' : '上传图片后，历史记录将在这里显示'"
      />
    </div>

    <!-- Main Scroll Area -->
    <div v-else ref="scrollContainer" class="timeline-scroll-area" @scroll="handleScroll">
      <!-- Loading State - 使用 Justified Layout 算法的骨架屏 -->
      <!-- 去掉 groups.length>0 约束：首次切到时间轴时数据才开始加载，groups 仍为空也需骨架屏 -->
      <TimelineSkeleton
        v-if="viewState.isLoading.value || showSkeleton"
        :layout="skeletonLayout"
      />

      <!-- Virtual Scroll Content -->
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
          共 {{ viewState.totalCount.value }} 张照片
        </template>
      </TimelinePhotoGrid>

      <!-- Bottom Spacing -->
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

    <!-- Floating Action Bar -->
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

    <!-- Layout Calculating Indicator -->
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

/* Sidebar */
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

/* Empty State */
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

/* Layout Indicator */
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

/* ========== 响应式适配 ========== */

/* 平板设备 (≤1024px) */
@media (width <= 1024px) {
  .timeline-scroll-area {
    /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 50px 为平板端时间轴右侧留白，无对应 spacing token */
    padding: 0 50px 0 var(--space-lg);
  }
}

/* 手机设备 (≤768px) */
@media (width <= 768px) {
  .timeline-scroll-area {
    padding: 0 var(--space-3xl) 0 var(--space-md);
  }

  .sidebar-wrapper {
    width: 52px;
  }
}

/* 小屏手机 (≤480px) */
@media (width <= 480px) {
  .timeline-scroll-area {
    padding: 0 var(--space-sm);
  }

  .sidebar-wrapper {
    display: none;
  }
}
</style>
