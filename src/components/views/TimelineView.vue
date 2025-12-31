<script setup lang="ts">
/**
 * Timeline View (Google Photos style)
 * 使用 Justified Layout + 虚拟滚动实现高性能图片浏览
 * 支持 10 万+ 图片流畅滚动
 */
import { ref, computed, onMounted, onUnmounted, watch, nextTick, shallowRef } from 'vue';
import { useHistoryViewState, type LinkFormat } from '../../composables/useHistoryViewState';
import { useVirtualTimeline, type PhotoGroup } from '../../composables/useVirtualTimeline';
import { useThumbCache } from '../../composables/useThumbCache';
import { useImageMetadataFixer } from '../../composables/useImageMetadataFixer';
import { useToast } from '../../composables/useToast';
import type { HistoryItem, ServiceType } from '../../config/types';
import TimelineSidebar, { type TimeGroup } from './timeline/TimelineSidebar.vue';
import HistoryLightbox from './history/HistoryLightbox.vue';
import FloatingActionBar from './history/FloatingActionBar.vue';
import Skeleton from 'primevue/skeleton';

// ==================== Props & Emits ====================

const props = defineProps<{
  filter?: ServiceType | 'all';
  searchTerm?: string;
}>();

const emit = defineEmits<{
  (e: 'update:totalCount', count: number): void;
  (e: 'update:selectedCount', count: number): void;
}>();

// ==================== Composables ====================

const toast = useToast();
const viewState = useHistoryViewState();
const thumbCache = useThumbCache();
const metadataFixer = useImageMetadataFixer();

// ==================== Refs ====================

// Scroll container ref
const scrollContainer = ref<HTMLElement | null>(null);

// Lightbox state
const lightboxVisible = ref(false);
const lightboxItem = ref<HistoryItem | null>(null);

// Sidebar visibility
const isSidebarVisible = ref(false);
let scrollTimeout: number | undefined;
const isHoveringSidebar = ref(false);

// 触发来源
type ShowSource = 'scroll' | 'hover';
let lastShowSource: ShowSource = 'scroll';

// 拖动状态
let isDragging = false;
let dragEndTimer: number | undefined;

// ==================== Grouping Logic ====================

/**
 * 按天分组图片数据
 */
const groups = computed<PhotoGroup[]>(() => {
  const items = viewState.filteredItems.value;
  const groupsMap = new Map<string, PhotoGroup>();

  items.forEach((item) => {
    const date = new Date(item.timestamp);
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    const id = `${year}-${month}-${day}`;

    if (!groupsMap.has(id)) {
      groupsMap.set(id, {
        id,
        label: `${year}年${month + 1}月${day}日`,
        year,
        month,
        day,
        date: new Date(year, month, day),
        items: [],
      });
    }
    groupsMap.get(id)?.items.push(item);
  });

  // 按日期降序排列（最新的在前）
  return Array.from(groupsMap.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
});

// ==================== Virtual Timeline ====================

const {
  // 状态
  totalHeight,
  scrollProgress,
  isCalculating,
  viewportHeight,
  scrollTop,

  // 三阶段渲染状态
  displayMode,
  fastModeItems,

  // 可见数据
  visibleItems,
  visibleHeaders,
  currentStickyHeader,

  // 布局数据
  layoutResult,

  // 方法
  scrollToItem,
  scrollToProgress,
  forceUpdateVisibleArea,
  handleScroll: virtualHandleScroll,
} = useVirtualTimeline(scrollContainer, groups, {
  targetRowHeight: 200,
  gap: 4,
  headerHeight: 48,
  groupGap: 24,
  overscan: 3,
});

// ==================== 三阶段渲染：图片加载状态 ====================

/** 已加载图片的 ID 集合 */
const loadedImages = shallowRef(new Set<string>());

/** 最大缓存加载状态的图片数量 */
const MAX_LOADED_CACHE = 500;

/**
 * 标记图片已加载
 */
function onImageLoad(id: string) {
  const newSet = new Set(loadedImages.value);
  newSet.add(id);

  // 防止内存无限增长：超过阈值时清理
  if (newSet.size > MAX_LOADED_CACHE) {
    // 只保留当前可见的图片 ID
    const visibleIds = new Set(visibleItems.value.map((v) => v.item.id));
    loadedImages.value = visibleIds;
  } else {
    loadedImages.value = newSet;
  }
}

/**
 * 检查图片是否已加载
 */
function isImageLoaded(id: string): boolean {
  return loadedImages.value.has(id);
}

// ==================== Sidebar Data ====================

const sidebarGroups = computed<TimeGroup[]>(() => {
  return groups.value.map((g) => ({
    id: g.id,
    label: g.month + 1 + '月',
    year: g.year,
    month: g.month,
    day: g.day,
    date: g.date,
    count: g.items.length,
  }));
});

// 每个分组的布局高度（用于时间轴准确定位）
const groupHeightMap = computed(() => {
  const map = new Map<string, number>();
  if (!layoutResult.value) return map;

  for (const group of layoutResult.value.groupLayouts) {
    // 高度 = 头部高度 + 内容高度
    const height = group.headerHeight + group.contentHeight;
    map.set(group.groupId, height);
  }
  return map;
});

// 当前月份标签
const currentMonthLabel = computed(() => {
  if (currentStickyHeader.value) {
    const group = groups.value.find((g) => g.id === currentStickyHeader.value?.groupId);
    if (group) {
      return `${group.month + 1}月`;
    }
  }
  if (groups.value.length === 0) return '';
  const index = Math.floor(scrollProgress.value * (groups.value.length - 1));
  const group = groups.value[Math.min(index, groups.value.length - 1)];
  return `${group.month + 1}月`;
});

// 可见比例
const visibleRatio = computed(() => {
  if (totalHeight.value <= viewportHeight.value) return 1;
  return viewportHeight.value / totalHeight.value;
});

// ==================== Sidebar Visibility ====================

const showSidebar = () => {
  isSidebarVisible.value = true;
};

const hideSidebarDebounced = () => {
  if (scrollTimeout) clearTimeout(scrollTimeout);
  const delay = lastShowSource === 'hover' ? 300 : 1000;
  scrollTimeout = window.setTimeout(() => {
    if (!isHoveringSidebar.value) {
      isSidebarVisible.value = false;
    }
  }, delay);
};

// ==================== Scroll Handling ====================

// 无限滚动阈值
const SCROLL_THRESHOLD = 500;

/**
 * 检测是否需要加载更多
 */
const checkLoadMore = () => {
  if (!viewState.hasMore.value || viewState.isLoadingMore.value) return;

  const distanceToBottom = totalHeight.value - scrollTop.value - viewportHeight.value;

  if (distanceToBottom < SCROLL_THRESHOLD) {
    viewState.loadMore();
  }
};

/**
 * 滚动事件处理
 */
const handleScroll = () => {
  // 始终执行虚拟滚动处理（确保可见区域更新）
  virtualHandleScroll();

  // 侧边栏显示逻辑（拖动期间跳过）
  if (!isDragging) {
    lastShowSource = 'scroll';
    showSidebar();
    hideSidebarDebounced();
  }

  // 无限滚动检测
  checkLoadMore();
};

// ==================== Sidebar Interactions ====================

const handleSidebarEnter = () => {
  lastShowSource = 'hover';
  isHoveringSidebar.value = true;
  showSidebar();
  if (scrollTimeout) clearTimeout(scrollTimeout);
};

const handleSidebarLeave = () => {
  isHoveringSidebar.value = false;
  hideSidebarDebounced();
};

const handleSidebarWheel = (e: WheelEvent) => {
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop += e.deltaY;
  }
};

const handleDragScroll = (progress: number) => {
  isDragging = true;

  if (dragEndTimer) clearTimeout(dragEndTimer);
  dragEndTimer = window.setTimeout(() => {
    isDragging = false;
    // 拖拽结束后强制更新可见区域，触发图片加载
    forceUpdateVisibleArea();
  }, 150);

  // 传递拖拽状态，让 scrollToProgress 强制使用 fast 模式
  scrollToProgress(progress, true);
};

// ==================== Lightbox ====================

const openLightbox = (item: HistoryItem) => {
  lightboxItem.value = item;
  lightboxVisible.value = true;
};

const handleLightboxDelete = async (item: HistoryItem) => {
  try {
    await viewState.deleteHistoryItem(item.id);
    lightboxVisible.value = false;
    toast.success('已删除');
  } catch (e) {
    toast.error('删除失败', String(e));
  }
};

/**
 * Lightbox 导航时同步滚动位置
 */
const handleLightboxNavigate = (item: HistoryItem) => {
  lightboxItem.value = item;
  // 滚动到该图片位置（确保关闭后可见）
  scrollToItem(item.id);
};

// ==================== Batch Actions ====================

const handleBulkCopy = (fmt: LinkFormat) => viewState.bulkCopyFormatted(fmt);
const handleBulkExport = () => viewState.bulkExport();
const handleBulkDelete = () => viewState.bulkDelete();

// ==================== Lifecycle ====================

onMounted(async () => {
  console.log('[TimelineView] Mounted with Justified Layout');
  await viewState.loadHistory();

  // 初始加载后，检查并修复缺失元数据
  nextTick(() => {
    const items = viewState.filteredItems.value;
    const needsFix = items.filter((item) => !item.aspectRatio || item.aspectRatio <= 0);
    if (needsFix.length > 0) {
      console.log(`[TimelineView] 发现 ${needsFix.length} 张图片缺少宽高比，后台修复中...`);
      metadataFixer.batchFixMissingMetadata(needsFix);
    }
  });
});

onUnmounted(() => {
  viewState.reset();
  thumbCache.clearThumbCache();

  // 刷新待更新的元数据
  metadataFixer.flushNow();

  if (scrollTimeout) clearTimeout(scrollTimeout);
  if (dragEndTimer) clearTimeout(dragEndTimer);
});

// ==================== Watchers ====================

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
  () => viewState.totalCount.value,
  (c) => emit('update:totalCount', c),
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
      <!-- Loading State -->
      <div v-if="viewState.isLoading.value" class="loading-state">
        <Skeleton width="100%" height="200px" class="mb-4" />
        <Skeleton width="100%" height="400px" />
      </div>

      <!-- Empty State -->
      <div v-else-if="groups.length === 0" class="empty-state">
        <i class="pi pi-image" style="font-size: 3rem; opacity: 0.5"></i>
        <p>暂无图片</p>
      </div>

      <!-- Virtual Scroll Content -->
      <div v-else class="virtual-container" :style="{ height: `${totalHeight}px` }">
        <!-- Visible Group Headers -->
        <div
          v-for="header in visibleHeaders"
          :key="`header-${header.groupId}`"
          class="group-header"
          :style="{
            transform: `translate3d(0, ${header.y}px, 0)`,
            height: `${header.height}px`,
          }"
        >
          <span class="group-title">{{ header.label }}</span>
          <span class="group-subtitle">
            {{ groups.find((g) => g.id === header.groupId)?.items.length || 0 }} 张照片
          </span>
        </div>

        <!-- 阶段 1：快速滚动 - 正方形占位符 -->
        <template v-if="displayMode === 'fast'">
          <div
            v-for="(pos, index) in fastModeItems"
            :key="`fast-${index}`"
            class="photo-placeholder"
            :style="{
              transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
              width: `${pos.width}px`,
              height: `${pos.height}px`,
            }"
          >
            <Skeleton width="100%" height="100%" borderRadius="8px" />
          </div>
        </template>

        <!-- 阶段 2 & 3：正常滚动 - Justified Layout -->
        <template v-else>
          <div
            v-for="visible in visibleItems"
            :key="visible.item.id"
            class="photo-item"
            :class="{ selected: viewState.isSelected(visible.item.id) }"
            :style="{
              transform: `translate3d(${visible.x}px, ${visible.y}px, 0)`,
              width: `${visible.width}px`,
              height: `${visible.height}px`,
            }"
          >
            <div class="photo-wrapper" @click="openLightbox(visible.item)">
              <!-- 阶段 2：图片未加载 - Skeleton 占位 -->
              <Skeleton
                v-if="!isImageLoaded(visible.item.id)"
                width="100%"
                height="100%"
                borderRadius="8px"
                class="photo-skeleton"
              />

              <!-- 阶段 3：图片 - 始终渲染但初始隐藏，加载后显示 -->
              <img
                v-if="thumbCache.getThumbUrl(visible.item)"
                :src="thumbCache.getThumbUrl(visible.item)"
                class="photo-img"
                :class="{ loaded: isImageLoaded(visible.item.id) }"
                @load="onImageLoad(visible.item.id)"
                @error="(e: any) => (e.target.style.display = 'none')"
              />

              <!-- Selection Overlay -->
              <div class="selection-overlay"></div>

              <!-- Checkbox -->
              <div
                class="checkbox"
                :class="{ checked: viewState.isSelected(visible.item.id) }"
                @click.stop="viewState.toggleSelection(visible.item.id)"
              >
                <i v-if="viewState.isSelected(visible.item.id)" class="pi pi-check"></i>
              </div>
            </div>
          </div>
        </template>

        <!-- Loading More Indicator -->
        <div
          v-if="viewState.isLoadingMore.value"
          class="loading-more"
          :style="{ transform: `translate3d(0, ${totalHeight - 60}px, 0)` }"
        >
          <i class="pi pi-spin pi-spinner"></i>
          <span>加载中...</span>
        </div>

        <!-- All Loaded Indicator -->
        <div
          v-else-if="!viewState.hasMore.value && groups.length > 0"
          class="all-loaded"
          :style="{ transform: `translate3d(0, ${totalHeight - 40}px, 0)` }"
        >
          已加载全部 {{ viewState.totalCount.value }} 张照片
        </div>
      </div>

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
      <TimelineSidebar
        :groups="sidebarGroups"
        :scroll-progress="scrollProgress"
        :visible-ratio="visibleRatio"
        :current-month-label="currentMonthLabel"
        :group-heights="groupHeightMap"
        :total-layout-height="totalHeight"
        @drag-scroll="handleDragScroll"
      />
    </div>

    <!-- Lightbox -->
    <HistoryLightbox
      v-model:visible="lightboxVisible"
      :item="lightboxItem"
      @delete="handleLightboxDelete"
      @navigate="handleLightboxNavigate"
    />

    <!-- Floating Action Bar -->
    <FloatingActionBar
      :selected-count="viewState.selectedIdList.value.length"
      :visible="viewState.hasSelection.value"
      @copy="handleBulkCopy"
      @export="handleBulkExport"
      @delete="handleBulkDelete"
      @clear-selection="viewState.clearSelection"
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
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 70px 0 20px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.timeline-scroll-area::-webkit-scrollbar {
  display: none;
}

/* Virtual Container */
.virtual-container {
  position: relative;
  width: 100%;
}

/* Group Headers */
.group-header {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 10px 0;
  background: var(--bg-app);
  z-index: 5;
}

.group-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.group-subtitle {
  font-size: 12px;
  color: var(--text-secondary);
}

/* Photo Placeholder (快速滚动模式) */
.photo-placeholder {
  position: absolute;
  border-radius: 8px;
  overflow: hidden;
  will-change: transform;
}

/* Photo Items */
.photo-item {
  position: absolute;
  background: var(--bg-secondary);
  border-radius: 8px;
  overflow: hidden;
  will-change: transform;
}

.photo-wrapper {
  width: 100%;
  height: 100%;
  cursor: pointer;
  position: relative;
}

/* Skeleton 占位符 */
.photo-skeleton {
  position: absolute;
  inset: 0;
  z-index: 1;
}

/* 图片加载过渡 */
.photo-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.3s ease-in-out, transform 0.3s;
}

.photo-img.loaded {
  opacity: 1;
}

.photo-wrapper:hover .photo-img.loaded {
  transform: scale(1.03);
}

/* Selection */
.selection-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.1);
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
}

.photo-item.selected .selection-overlay {
  opacity: 1;
  background: rgba(59, 130, 246, 0.2);
  border: 2px solid var(--primary);
  border-radius: 8px;
}

.checkbox {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.8);
  background: rgba(0, 0, 0, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all 0.2s;
  z-index: 2;
}

.photo-wrapper:hover .checkbox,
.checkbox.checked {
  opacity: 1;
}

.checkbox:hover {
  background: rgba(0, 0, 0, 0.4);
}

.checkbox.checked {
  background: var(--primary);
  border-color: var(--primary);
}

.checkbox.checked i {
  font-size: 10px;
  color: white;
  font-weight: bold;
}

/* Sidebar */
.sidebar-wrapper {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 120px;
  z-index: 20;
  background: linear-gradient(to left, var(--bg-app) 40%, transparent 100%);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s ease;
  overflow: visible;
}

.sidebar-wrapper.visible {
  opacity: 1;
  pointer-events: auto;
}

.sidebar-wrapper > * {
  pointer-events: auto;
}

/* Loading/Empty States */
.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  height: 100%;
  color: var(--text-secondary);
}

.mb-4 {
  margin-bottom: 1rem;
}

/* Loading More */
.loading-more,
.all-loaded {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  color: var(--text-secondary);
  font-size: 14px;
}

.loading-more i {
  font-size: 16px;
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
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  z-index: 100;
}

.layout-indicator i {
  font-size: 18px;
  color: var(--primary);
}
</style>
