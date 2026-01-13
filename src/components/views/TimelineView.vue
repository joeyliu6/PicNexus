<script setup lang="ts">
/**
 * Timeline View (Google Photos style)
 * 使用 Justified Layout + 虚拟滚动实现高性能图片浏览
 * 支持 10 万+ 图片流畅滚动
 */
import { ref, computed, onMounted, onUnmounted, watch, nextTick, shallowRef } from 'vue';
import { useHistoryViewState, type LinkFormat } from '../../composables/useHistoryViewState';
import { useHistoryManager } from '../../composables/useHistory';
import { useVirtualTimeline, type PhotoGroup } from '../../composables/useVirtualTimeline';
import { generateSkeletonLayout } from '../../utils/justifiedLayout';
import { useThumbCache, generateMediumThumbnailUrl } from '../../composables/useThumbCache';
import { useConfigManager } from '../../composables/useConfig';
import { useImageMetadataFixer } from '../../composables/useImageMetadataFixer';
import { useImageLoadManager } from '../../composables/useImageLoadManager';
import { useTimelineSidebarControl } from '../../composables/useTimelineSidebarControl';
import { useToast } from '../../composables/useToast';
import type { HistoryItem, ServiceType } from '../../config/types';
import type { ImageMeta } from '../../types/image-meta';
import { formatFileSize, formatUploadTime } from '../../utils/formatters';
import { getServiceDisplayName } from '../../constants/serviceNames';
import TimelineSidebar, { type TimeGroup } from './timeline/TimelineSidebar.vue';
import TimelineIndicator from './timeline/TimelineIndicator.vue';
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
const historyManager = useHistoryManager();
const thumbCache = useThumbCache();
const metadataFixer = useImageMetadataFixer();
const configManager = useConfigManager();

// ==================== Refs ====================

// Scroll container ref
const scrollContainer = ref<HTMLElement | null>(null);

// Lightbox state
const lightboxVisible = ref(false);
const lightboxItem = ref<HistoryItem | null>(null);

// 悬停详情缓存（用于显示悬停信息）
const hoverDetailsMap = shallowRef(new Map<string, HistoryItem>());

// Sidebar Control
const {
  isSidebarVisible,
  isHoveringSidebar,
  onScroll: onSidebarScroll,
  onSidebarEnter: handleSidebarEnter,
  onSidebarLeave: handleSidebarLeave,
  cleanup: cleanupSidebarControl,
} = useTimelineSidebarControl({
  scrollHideDelay: 1000,
  hoverHideDelay: 300,
});

// 拖动状态
let isDragging = false;
let dragEndTimer: number | undefined;

// ==================== Grouping Logic ====================

/**
 * 按天分组图片元数据
 */
const groups = computed<PhotoGroup[]>(() => {
  const metas = viewState.filteredMetas.value;
  const groupsMap = new Map<string, PhotoGroup>();

  metas.forEach((meta) => {
    const date = new Date(meta.timestamp);
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
    groupsMap.get(id)?.items.push(meta);
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

  // 三阶段渲染状态（仅用于控制图片加载行为）
  displayMode,
  scrollDirection,

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

// ==================== 图片加载状态管理 ====================

const {
  loadedImages,
  onImageLoad,
  onImageError,
  isImageLoaded,
  clearAll: clearImageLoadState,
} = useImageLoadManager(visibleItems, {
  maxCache: 500,
  destroyDelay: 2500,
  maxRetry: 1,
});

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

// 已加载的月份集合（用于新时间轴指示器）
const loadedMonthsSet = computed(() => {
  const set = new Set<string>();
  for (const group of groups.value) {
    set.add(`${group.year}-${group.month}`);
  }
  return set;
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

// 基于布局高度的月份位置映射（用于时间轴指示器精确定位）
const monthLayoutPositions = computed(() => {
  const map = new Map<string, { start: number; end: number }>();
  if (!layoutResult.value || totalHeight.value <= 0) return map;

  // 按月份聚合分组（同一个月可能有多天的分组）
  const monthGroups = new Map<string, { startY: number; endY: number }>();

  for (const group of layoutResult.value.groupLayouts) {
    const groupData = groups.value.find(g => g.id === group.groupId);
    if (!groupData) continue;

    const monthKey = `${groupData.year}-${groupData.month}`;
    const groupEnd = group.contentY + group.contentHeight;

    if (!monthGroups.has(monthKey)) {
      monthGroups.set(monthKey, { startY: group.headerY, endY: groupEnd });
    } else {
      const existing = monthGroups.get(monthKey)!;
      // 更新结束位置（取最大值）
      existing.endY = Math.max(existing.endY, groupEnd);
    }
  }

  // 转换为滚动进度比例 (0-1)
  const maxScroll = Math.max(1, totalHeight.value - viewportHeight.value);
  for (const [key, { startY, endY }] of monthGroups) {
    map.set(key, {
      start: Math.min(1, startY / maxScroll),
      end: Math.min(1, endY / maxScroll),
    });
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

// ==================== 骨架屏布局 ====================

/**
 * 骨架屏布局数据
 * 使用 Justified Layout 算法确保与实际内容布局一致
 */
const skeletonLayout = computed(() => {
  // 使用视口尺寸计算，如果还未获取则使用窗口尺寸作为降级
  const width = viewportHeight.value > 0
    ? (scrollContainer.value?.clientWidth || window.innerWidth - 90)
    : window.innerWidth - 90;
  const height = viewportHeight.value > 0 ? viewportHeight.value : window.innerHeight;

  return generateSkeletonLayout({
    containerWidth: width,
    viewportHeight: height,
    targetRowHeight: 200,
    gap: 4,
    headerHeight: 48,
    groupGap: 24,
  });
});

// ==================== Scroll Handling ====================

/**
 * 滚动事件处理
 */
const handleScroll = () => {
  // 始终执行虚拟滚动处理（确保可见区域更新）
  virtualHandleScroll();

  // 侧边栏显示逻辑（拖动期间跳过）
  if (!isDragging) {
    onSidebarScroll();
  }
};

// ==================== Sidebar Interactions ====================

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
    forceUpdateVisibleArea();
  }, PRELOAD_CONFIG.DRAG_END_DELAY_MS);

  // 传递拖拽状态，让 scrollToProgress 强制使用 fast 模式
  scrollToProgress(progress, true);
};

/**
 * 处理时间轴跳转到未加载的月份
 */
const handleJumpToPeriod = async (year: number, month: number) => {
  console.log(`[TimelineView] 跳转到 ${year}年${month + 1}月`);

  const success = await historyManager.jumpToMonth(year, month);

  if (success) {
    // 跳转成功，滚动到顶部显示该月份的数据
    await nextTick();
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop = 0;
    }
    // 强制更新可见区域
    forceUpdateVisibleArea();
    toast.success('已跳转', `${year}年${month + 1}月`);
  }
};

/**
 * 处理时间轴跳转到指定年份
 */
const handleJumpToYear = async (year: number) => {
  console.log(`[TimelineView] 跳转到 ${year}年`);

  // 找到该年份的分组
  const yearGroups = groups.value.filter(g => g.year === year);

  if (yearGroups.length > 0) {
    // 已加载，直接滚动到该年份最早的分组
    const firstGroup = yearGroups[yearGroups.length - 1]; // 最早的月份（降序排列）
    if (firstGroup.items.length > 0) {
      scrollToItem(firstGroup.items[0].id);
      toast.success('已跳转', `${year}年`);
    }
  } else {
    // 未加载，找到该年份的第一个月份并触发加载
    const periods = historyManager.timePeriodStats.value;
    const yearPeriods = periods.filter(p => p.year === year);
    if (yearPeriods.length > 0) {
      // 找最早的月份（periods 按时间降序，最后一个是最早的）
      const earliestPeriod = yearPeriods[yearPeriods.length - 1];
      await handleJumpToPeriod(year, earliestPeriod.month);
    }
  }
};

// ==================== Lightbox ====================

const openLightbox = async (meta: ImageMeta) => {
  try {
    // 从详情缓存加载完整数据
    const detail = await viewState.detailCache.getDetail(meta.id);
    lightboxItem.value = detail;
    lightboxVisible.value = true;
  } catch (e) {
    console.error('[Lightbox] 加载详情失败:', e);
    toast.error('加载失败', String(e));
  }
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

// ==================== 悬停信息辅助函数 ====================

/**
 * 获取成功上传的服务列表（从悬停详情缓存）
 */
function getSuccessfulServices(id: string): string[] {
  const detail = hoverDetailsMap.value.get(id);
  if (!detail) return [];
  return detail.results
    .filter(r => r.status === 'success')
    .map(r => r.serviceId);
}

/**
 * 悬停时加载详情
 */
async function handleImageHover(meta: ImageMeta) {
  if (hoverDetailsMap.value.has(meta.id)) return;

  try {
    const detail = await viewState.detailCache.getDetail(meta.id);
    const newMap = new Map(hoverDetailsMap.value);
    newMap.set(meta.id, detail);
    hoverDetailsMap.value = newMap;
  } catch (e) {
    console.warn('[TimelineView] 悬停加载详情失败:', meta.id, e);
  }
}

/**
 * 从 ImageMeta 生成缩略图 URL
 */
function getThumbnailUrl(meta: ImageMeta): string {
  return generateMediumThumbnailUrl(
    meta.primaryService,
    meta.primaryUrl,
    meta.primaryFileKey,
    configManager.config.value
  );
}

// ==================== 图片预加载 ====================

/** 预加载配置 */
const PRELOAD_CONFIG = {
  /** 预加载图片数量上限（约1屏） */
  MAX_COUNT: 20,
  /** 预加载延迟（毫秒） */
  DELAY_MS: 300,
  /** 拖拽结束延迟（毫秒） */
  DRAG_END_DELAY_MS: 50,
} as const;

/** 预加载定时器 */
let preloadTimer: number | undefined;

/**
 * 预加载下一屏图片（根据滚动方向）
 */
const preloadNextScreen = () => {
  // 快速滚动时不预加载
  if (displayMode.value === 'fast') return;

  const direction = scrollDirection?.value;
  if (!direction) return;

  const currentVisibleIds = new Set(visibleItems.value.map(v => v.meta.id));
  const allMetas = viewState.filteredMetas.value;

  // 找到当前可见区域的边界索引
  const visibleMetaIds = visibleItems.value.map(v => v.meta.id);
  const firstVisibleIndex = allMetas.findIndex(meta => meta.id === visibleMetaIds[0]);
  const lastVisibleIndex = allMetas.findIndex(meta => meta.id === visibleMetaIds[visibleMetaIds.length - 1]);

  if (firstVisibleIndex === -1 || lastVisibleIndex === -1) return;

  // 预加载数量（约 1 屏）
  const preloadCount = Math.min(PRELOAD_CONFIG.MAX_COUNT, visibleItems.value.length);

  // 根据滚动方向确定预加载范围
  const preloadStart = direction === 'down'
    ? lastVisibleIndex + 1
    : Math.max(0, firstVisibleIndex - preloadCount);
  const preloadEnd = direction === 'down'
    ? Math.min(allMetas.length, lastVisibleIndex + preloadCount + 1)
    : firstVisibleIndex;

  // 预加载图片
  for (let i = preloadStart; i < preloadEnd; i++) {
    const meta = allMetas[i];
    if (!meta || currentVisibleIds.has(meta.id) || isImageLoaded(meta.id)) continue;

    const url = getThumbnailUrl(meta);
    if (!url) continue;

    // 后台预加载
    const img = new Image();
    img.src = url;
    img.onload = () => onImageLoad(meta.id);
    img.onerror = (e) => onImageError(e, meta.id);
  }
};

// 在滚动停止后触发预加载（使用防抖）
watch(displayMode, (mode) => {
  if (mode === 'normal') {
    if (preloadTimer) clearTimeout(preloadTimer);
    preloadTimer = window.setTimeout(() => {
      preloadNextScreen();
    }, PRELOAD_CONFIG.DELAY_MS);
  }
});

// ==================== Lifecycle ====================

onMounted(async () => {
  console.log('[TimelineView] Mounted with Justified Layout');

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
      console.log(`[TimelineView] 发现 ${needsFix.length} 张图片缺少宽高比，后台修复中...`);
      metadataFixer.batchFixMissingMetadata(needsFix);
    }
  });
});

onUnmounted(() => {
  // 清理图片加载状态（由 useImageLoadManager 自动处理）
  clearImageLoadState();

  // 清理侧边栏控制（由 useTimelineSidebarControl 提供）
  cleanupSidebarControl();

  viewState.reset();
  thumbCache.clearThumbCache();

  // 刷新待更新的元数据
  metadataFixer.flushNow();

  if (dragEndTimer) clearTimeout(dragEndTimer);
  if (preloadTimer) clearTimeout(preloadTimer);
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
      <!-- Loading State - 使用 Justified Layout 算法的骨架屏 -->
      <div v-if="viewState.isLoading.value" class="skeleton-container" :style="{ height: `${skeletonLayout.totalHeight}px` }">
        <!-- 分组头部占位 -->
        <div
          v-for="group in skeletonLayout.groups"
          :key="`skeleton-header-${group.id}`"
          class="skeleton-header"
          :style="{ transform: `translate3d(0, ${group.headerY}px, 0)` }"
        >
          <Skeleton width="140px" height="24px" />
          <Skeleton width="70px" height="16px" />
        </div>

        <!-- 图片占位 -->
        <div
          v-for="(item, index) in skeletonLayout.items"
          :key="`skeleton-item-${index}`"
          class="skeleton-photo"
          :style="{
            transform: `translate3d(${item.x}px, ${item.y}px, 0)`,
            width: `${item.width}px`,
            height: `${item.height}px`,
          }"
        >
          <Skeleton width="100%" height="100%" borderRadius="8px" />
        </div>
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

        <!-- Justified Layout 图片列表（不再切换 DOM 结构） -->
        <div
          v-for="visible in visibleItems"
          :key="visible.meta.id"
          class="photo-item"
          :class="{ selected: viewState.isSelected(visible.meta.id) }"
          :style="{
            transform: `translate3d(${visible.x}px, ${visible.y}px, 0)`,
            width: `${visible.width}px`,
            height: `${visible.height}px`,
          }"
          @mouseenter="handleImageHover(visible.meta)"
        >
          <div class="photo-wrapper" @click="openLightbox(visible.meta)">
            <!-- 图片未加载时显示 Skeleton 占位 -->
            <Skeleton
              v-if="!isImageLoaded(visible.meta.id)"
              width="100%"
              height="100%"
              borderRadius="8px"
              class="photo-skeleton"
            />

            <!-- 图片 - 快速滚动时不加载新图片，但已加载的始终显示 -->
            <img
              v-if="getThumbnailUrl(visible.meta) && (isImageLoaded(visible.meta.id) || displayMode !== 'fast')"
              :src="getThumbnailUrl(visible.meta)"
              class="photo-img"
              :class="{ loaded: isImageLoaded(visible.meta.id) }"
              @load="onImageLoad(visible.meta.id)"
              @error="onImageError($event, visible.meta.id)"
            />

            <!-- Selection Overlay -->
            <div class="selection-overlay"></div>

            <!-- Checkbox -->
            <div
              class="checkbox"
              :class="{ checked: viewState.isSelected(visible.meta.id) }"
              @click.stop="viewState.toggleSelection(visible.meta.id)"
            >
              <i v-if="viewState.isSelected(visible.meta.id)" class="pi pi-check"></i>
            </div>

            <!-- 悬停信息层 -->
            <div class="hover-info" v-if="hoverDetailsMap.get(visible.meta.id)">
              <div class="hover-info-top">
                <span class="file-name" :title="hoverDetailsMap.get(visible.meta.id)!.localFileName">
                  {{ hoverDetailsMap.get(visible.meta.id)!.localFileName }}
                </span>
              </div>
              <div class="hover-info-bottom">
                <div class="info-row">
                  <i class="pi pi-file"></i>
                  <span class="file-size">{{ formatFileSize(hoverDetailsMap.get(visible.meta.id)!.fileSize) }}</span>
                </div>
                <div class="info-row">
                  <i class="pi pi-clock"></i>
                  <span class="upload-time">{{ formatUploadTime(visible.meta.timestamp) }}</span>
                </div>
                <div class="service-badges" v-if="getSuccessfulServices(visible.meta.id).length > 0">
                  <span
                    v-for="service in getSuccessfulServices(visible.meta.id)"
                    :key="service"
                    class="service-badge"
                    :title="`已上传到 ${getServiceDisplayName(service)}`"
                  >
                    {{ getServiceDisplayName(service) }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- All Loaded Indicator -->
        <div
          v-if="groups.length > 0"
          class="all-loaded"
          :style="{ transform: `translate3d(0, ${totalHeight - 40}px, 0)` }"
        >
          共 {{ viewState.totalCount.value }} 张照片
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

/* 悬停信息层 */
.hover-info {
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, transparent 30%, rgba(0, 0, 0, 0.85) 100%);
  opacity: 0;
  transition: opacity 0.2s ease;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 10px;
  pointer-events: none;
  color: white;
  border-radius: 8px;
}

.photo-wrapper:hover .hover-info {
  opacity: 1;
}

.hover-info-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.file-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.hover-info-bottom {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  opacity: 0.95;
}

.info-row i {
  font-size: 10px;
  opacity: 0.8;
}

.service-badges {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 2px;
}

.service-badge {
  padding: 3px 7px;
  background: rgba(59, 130, 246, 0.85);
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(4px);
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
.loading-state {
  padding: 20px 0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  height: 100%;
  color: var(--text-secondary);
}

/* 骨架屏 - Justified Layout 风格 */
.skeleton-container {
  position: relative;
  width: 100%;
}

.skeleton-header {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 10px 0;
  height: 48px;
}

.skeleton-photo {
  position: absolute;
  background: var(--bg-secondary);
  border-radius: 8px;
  overflow: hidden;
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

/* ========== 响应式适配 ========== */

/* 平板设备 (≤1024px) */
@media (max-width: 1024px) {
  .timeline-scroll-area {
    padding: 0 50px 0 16px;
  }

  .group-title {
    font-size: 16px; /* 缩小标题字体 */
  }

  .group-subtitle {
    font-size: 11px;
  }
}

/* 手机设备 (≤768px) */
@media (max-width: 768px) {
  .timeline-scroll-area {
    padding: 0 40px 0 12px;
  }

  .group-header {
    padding: 12px 0; /* 减少头部内边距 */
  }

  .group-title {
    font-size: 15px;
  }

  .group-subtitle {
    font-size: 10px;
  }

  /* 侧边栏在平板上缩小 */
  .sidebar-wrapper {
    width: 52px;
  }

  /* 悬停信息字体缩小 */
  .hover-info {
    padding: 8px;
  }

  .file-name {
    font-size: 12px;
  }

  .info-row {
    font-size: 10px;
  }

  .service-badge {
    font-size: 9px;
    padding: 2px 5px;
  }
}

/* 小屏手机 (≤480px) */
@media (max-width: 480px) {
  .timeline-scroll-area {
    padding: 0 8px;
  }

  .group-title {
    font-size: 14px;
  }

  .group-subtitle {
    display: none; /* 隐藏副标题节省空间 */
  }

  /* 完全隐藏侧边栏，使用底部导航 */
  .sidebar-wrapper {
    display: none;
  }

  /* 悬停信息简化 */
  .hover-info-bottom {
    gap: 4px;
  }

  .service-badges {
    display: none; /* 隐藏图床标识，节省空间 */
  }
}

/* 触摸设备优化 */
@media (hover: none) {
  /* 悬停信息在触摸设备上不显示（点击才显示） */
  .hover-info {
    display: none;
  }

  /* 增大选择框点击区域 */
  .checkbox {
    width: 32px;
    height: 32px;
  }
}
</style>
