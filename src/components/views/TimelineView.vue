<script setup lang="ts">
/** Timeline View — Google Photos 风格虚拟滚动图片浏览 */
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useHistoryViewState } from '../../composables/useHistoryViewState';
import { useHistoryManager } from '../../composables/useHistory';
import { useVirtualTimeline } from '../../composables/useVirtualTimeline';
import { useThumbCache } from '../../composables/useThumbCache';
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
const thumbCache = useThumbCache();
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
  visible: computed(() => props.visible),
  activationTrigger: computed(() => props.activationTrigger),
  callbacks: {
    restoreScrollTop,
    scrollToProgress,
    scrollToItem,
    forceUpdateVisibleArea,
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


onMounted(async () => {
  // 并行加载历史记录和时间段统计
  await Promise.all([
    viewState.loadHistory(),
    historyManager.loadTimePeriodStats(),
  ]);

  // 初始加载后，检查并修复缺失元数据
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
  thumbCache.clearThumbCache();
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
</script>

<template>
  <div class="timeline-view">
    <!-- Main Scroll Area -->
    <div ref="scrollContainer" class="timeline-scroll-area" @scroll="handleScroll">
      <!-- Loading State - 使用 Justified Layout 算法的骨架屏 -->
      <TimelineSkeleton
        v-if="viewState.isLoading.value || showSkeleton"
        :layout="skeletonLayout"
      />

      <!-- Empty State -->
      <div v-else-if="groups.length === 0" class="empty-state">
        <i :class="favoritesOnly ? 'pi pi-star' : 'pi pi-image'" style="font-size: var(--text-5xl); opacity: 0.5"></i>
        <p>{{ favoritesOnly ? '暂无收藏' : '暂无图片' }}</p>
        <p v-if="favoritesOnly" class="empty-state-hint">点击图片上的星形图标即可收藏</p>
      </div>

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
        :loaded-images="loadedImagesSet"
        :failed-images="failedImagesSet"
        :hover-details-map="hoverDetailsMap"
        :get-thumbnail-url="getThumbnailUrl"
        @item-click="openLightbox"
        @item-toggle-select="viewState.toggleSelection"
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
  padding: 0 70px 0 20px;
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
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  height: 100%;
  color: var(--text-secondary);
}

.empty-state-hint {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
  margin-top: 4px;
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
    padding: 0 50px 0 16px;
  }
}

/* 手机设备 (≤768px) */
@media (width <= 768px) {
  .timeline-scroll-area {
    padding: 0 40px 0 12px;
  }

  .sidebar-wrapper {
    width: 52px;
  }
}

/* 小屏手机 (≤480px) */
@media (width <= 480px) {
  .timeline-scroll-area {
    padding: 0 8px;
  }

  .sidebar-wrapper {
    display: none;
  }
}
</style>
