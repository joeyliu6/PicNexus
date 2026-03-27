<script setup lang="ts">
/**
 * Timeline View (Google Photos style)
 * 使用 Justified Layout + 虚拟滚动实现高性能图片浏览
 * 支持 10 万+ 图片流畅滚动
 */
import { ref, computed, onMounted, onUnmounted, onActivated, onDeactivated, watch, nextTick, shallowRef } from 'vue';
import { useHistoryViewState } from '../../composables/useHistoryViewState';
import { useHistoryManager } from '../../composables/useHistory';
import { useVirtualTimeline, type PhotoGroup } from '../../composables/useVirtualTimeline';
import { generateSkeletonLayout } from '../../utils/justifiedLayout';
import { useThumbCache, generateMediumThumbnailUrl } from '../../composables/useThumbCache';
import { useConfigManager } from '../../composables/useConfig';
import { useImageMetadataFixer } from '../../composables/useImageMetadataFixer';
import { useImageLoadManager } from '../../composables/useImageLoadManager';
import { useTimelineSidebarControl } from '../../composables/useTimelineSidebarControl';
import { useToast } from '../../composables/useToast';
import { type HistoryItem, type ServiceType } from '../../config/types';
import { getPrimaryImageUrl } from '../../utils/imageUrl';
import type { ImageMeta } from '../../types/image-meta';
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

// Lightbox state
const lightboxVisible = ref(false);
const lightboxItem = ref<HistoryItem | null>(null);

// 切换时的骨架屏状态
const showSkeleton = ref(false);
let skeletonMinDisplayTimeout: number | undefined;

// 悬停详情缓存（用于显示悬停信息）
const hoverDetailsMap = shallowRef(new Map<string, HistoryItem>());

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

// 拖动状态
let isDragging = false;
let dragEndTimer: number | undefined;


/**
 * 按天分组图片元数据
 */
const groups = computed<PhotoGroup[]>(() => {
  let metas = viewState.filteredMetas.value;

  // 收藏模式：只显示已收藏的图片（使用独立 favoriteSet）
  if (props.favoritesOnly) {
    const favSet = historyManager.favoriteSet.value;
    metas = metas.filter(m => favSet.has(m.id));
  }

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


// 已加载的月份集合（用于新时间轴指示器）
const loadedMonthsSet = computed(() => {
  const set = new Set<string>();
  for (const group of groups.value) {
    set.add(`${group.year}-${group.month}`);
  }
  return set;
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

// 可见比例
const visibleRatio = computed(() => {
  if (totalHeight.value <= viewportHeight.value) return 1;
  return viewportHeight.value / totalHeight.value;
});


/**
 * 骨架屏布局数据
 * 使用 Justified Layout 算法确保与实际内容布局一致
 */
const skeletonLayout = computed(() => {
  // 使用内容区域宽度（减去 padding），与实际布局保持一致
  let width: number;
  if (viewportHeight.value > 0 && scrollContainer.value) {
    const style = getComputedStyle(scrollContainer.value);
    width = scrollContainer.value.clientWidth
      - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  } else {
    width = window.innerWidth - 90;
  }
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


/**
 * 滚动事件处理
 */
// 持续追踪滚动位置（同步更新，避免 deactivate/v-show 时读 DOM 返回 0）
let lastKnownScrollTop = 0;

let lastStableScrollTop = 0;
let lastStableProgress = 0;
let lastStableAnchorId: string | null = null;

function saveStablePosition(scrollTop?: number) {
  const domTop = scrollContainer.value?.scrollTop ?? 0;
  let resolvedTop = typeof scrollTop === 'number' ? scrollTop : domTop;
  const isInvalidTop = !Number.isFinite(resolvedTop) || resolvedTop < 0;
  const isLikelyCollapsedReset = resolvedTop === 0
    && lastKnownScrollTop > 0
    && !!scrollContainer.value
    && (scrollContainer.value.clientHeight === 0 || scrollContainer.value.clientWidth === 0);
  if (isInvalidTop || isLikelyCollapsedReset) {
    resolvedTop = Math.max(0, virtualScrollTop.value, lastKnownScrollTop);
  }
  resolvedTop = Math.max(0, resolvedTop);
  const currentProgress = Math.min(1, Math.max(0, scrollProgress.value));
  const anchorId = visibleItems.value[0]?.meta.id ?? lastStableAnchorId;

  lastKnownScrollTop = resolvedTop;
  lastStableScrollTop = resolvedTop;
  lastStableProgress = currentProgress;
  lastStableAnchorId = anchorId ?? null;
}

const handleScroll = () => {
  if (scrollContainer.value) {
    const nextTop = scrollContainer.value.scrollTop;
    // KeepAlive/v-show 切换时容器可能瞬时上报 0，避免覆盖真实滚动位置
    const isTransientReset = nextTop === 0
      && lastStableScrollTop > 0
      && (scrollContainer.value.clientHeight === 0 || scrollContainer.value.clientWidth === 0);
    if (!isTransientReset) {
      saveStablePosition(nextTop);
    }
  }

  virtualHandleScroll();

  if (!isDragging) {
    onSidebarScroll();
  }
};


const handleSidebarWheel = (e: WheelEvent) => {
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop += e.deltaY;
  }
};

const handleDragScroll = (progress: number) => {
  isDragging = true;
  lastStableProgress = Math.min(1, Math.max(0, progress));

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
    // 跳转本身就是视觉反馈，无需 toast 通知
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
      // 跳转本身就是视觉反馈，无需 toast 通知
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


// 当前灯箱图片在 filteredMetas 中的索引
const lightboxIndex = computed(() => {
  if (!lightboxItem.value) return -1;
  return viewState.filteredMetas.value.findIndex(m => m.id === lightboxItem.value!.id);
});

const lightboxHasPrev = computed(() => lightboxIndex.value > 0);
const lightboxHasNext = computed(() =>
  lightboxIndex.value >= 0 && lightboxIndex.value < viewState.filteredMetas.value.length - 1
);

const openLightbox = async (meta: ImageMeta) => {
  try {
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

async function handleToggleFavorite(idOrItem: string | HistoryItem): Promise<void> {
  const id = typeof idOrItem === 'string' ? idOrItem : idOrItem.id;
  try {
    await historyManager.toggleFavorite(id);
  } catch {
    // useHistory 内部已处理 toast 通知
  }
}

async function preloadAdjacentInTimeline(currentIdx: number, direction: 'prev' | 'next'): Promise<void> {
  const metas = viewState.filteredMetas.value;
  const preloadIdx = direction === 'prev' ? currentIdx - 1 : currentIdx + 1;
  if (preloadIdx < 0 || preloadIdx >= metas.length) return;
  try {
    const detail = await viewState.detailCache.getDetail(metas[preloadIdx].id);
    const url = getPrimaryImageUrl(detail, configManager.config.value);
    if (url) new Image().src = url;
  } catch { /* 预加载失败不影响用户体验 */ }
}

const handleLightboxNavigate = async (direction: 'prev' | 'next') => {
  const metas = viewState.filteredMetas.value;
  const idx = lightboxIndex.value;
  const nextIdx = direction === 'prev' ? idx - 1 : idx + 1;
  if (nextIdx < 0 || nextIdx >= metas.length) return;

  try {
    const nextMeta = metas[nextIdx];
    const detail = await viewState.detailCache.getDetail(nextMeta.id);
    lightboxItem.value = detail;
    scrollToItem(nextMeta.id);
    preloadAdjacentInTimeline(nextIdx, direction);
  } catch (e) {
    console.error('[Lightbox] 导航加载失败:', e);
  }
};


// 从选中的 ImageMeta 中提取可用图床（轻量视图只知道主服务）
const selectedAvailableServices = computed<ServiceType[]>(() => {
  const ids = viewState.selectedIdList.value;
  if (ids.length === 0) return [];
  const serviceSet = new Set<ServiceType>();
  for (const meta of viewState.filteredMetas.value) {
    if (ids.includes(meta.id)) serviceSet.add(meta.primaryService);
  }
  return Array.from(serviceSet);
});



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


/** 预加载配置 */
const PRELOAD_CONFIG = {
  /** 预加载图片数量上限（约1屏） */
  MAX_COUNT: 20,
  /** 预加载延迟（毫秒） */
  DELAY_MS: 300,
  /** 拖拽结束延迟（毫秒） */
  DRAG_END_DELAY_MS: 50,
  /** 骨架屏最小显示时间（毫秒），避免闪烁 */
  SKELETON_MIN_DISPLAY_MS: 300,
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
    img.onerror = (e) => onImageError(e as Event, meta.id);
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
  if (skeletonMinDisplayTimeout) clearTimeout(skeletonMinDisplayTimeout);
});

// 滚动位置保存/恢复（统一管理 KeepAlive 和 Tab 切换两种场景）
let savedPosition = 0;
let savedTabPosition = 0;
let pendingRestore: 'keepalive' | 'tab' | null = null;

function doRestore() {
  if (!pendingRestore || !scrollContainer.value) return;
  const savedTarget = pendingRestore === 'keepalive' ? savedPosition : savedTabPosition;
  const restoreType = pendingRestore;
  pendingRestore = null;
  if (!isCalculating.value) {
    const target = savedTarget > 0 ? savedTarget : lastStableScrollTop;
    if (target > 0) {
      restoreScrollTop(target);
      saveStablePosition(target);
      return;
    }

    if (lastStableProgress > 0) {
      scrollToProgress(lastStableProgress, true);
      saveStablePosition();
      return;
    }

    if (lastStableAnchorId) {
      scrollToItem(lastStableAnchorId, 'auto');
      saveStablePosition();
      return;
    }

    forceUpdateVisibleArea();
    saveStablePosition(0);
  } else {
    pendingRestore = restoreType;
  }
}

onDeactivated(() => {
  saveStablePosition();
  savedPosition = lastStableScrollTop;
});

onActivated(async () => {
  if (savedPosition > 0 || lastStableScrollTop > 0 || lastStableProgress > 0 || !!lastStableAnchorId) {
    pendingRestore = 'keepalive';
  }
  await new Promise<void>(r => requestAnimationFrame(() => r()));
  doRestore();
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
  [() => viewState.totalCount.value, () => props.visible],
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

function hideSkeleton() {
  if (skeletonMinDisplayTimeout) {
    clearTimeout(skeletonMinDisplayTimeout);
  }
  if (!showSkeleton.value) return;
  skeletonMinDisplayTimeout = window.setTimeout(() => {
    showSkeleton.value = false;
  }, PRELOAD_CONFIG.SKELETON_MIN_DISPLAY_MS);
}

function showSkeletonWithCheck() {
  showSkeleton.value = true;
  nextTick(() => {
    if (!isCalculating.value) {
      hideSkeleton();
    }
  });
}

watch(
  () => props.visible,
  async (isVisible, wasVisible) => {
    if (!isVisible) {
      saveStablePosition();
      savedTabPosition = lastStableScrollTop;
      return;
    }
    if (wasVisible) return;

    if (groups.value.length === 0) {
      showSkeletonWithCheck();
    }

    await new Promise<void>(r => requestAnimationFrame(() => r()));

    if (savedTabPosition > 0 || lastStableScrollTop > 0 || lastStableProgress > 0 || !!lastStableAnchorId) {
      pendingRestore = 'tab';
    }
    doRestore();
  }
);

watch(
  visibleItems,
  (items) => {
    const firstId = items[0]?.meta.id;
    if (firstId) {
      lastStableAnchorId = firstId;
    }
  },
  { deep: false }
);

watch(
  () => props.activationTrigger,
  async (_, oldVal) => {
    if (!props.visible || oldVal === undefined) return;
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    if (!pendingRestore) {
      forceUpdateVisibleArea();
    }
  }
);

watch(
  () => isCalculating.value,
  (calculating) => {
    if (!calculating && showSkeleton.value) {
      hideSkeleton();
    }
    if (!calculating && pendingRestore) {
      nextTick(() => doRestore());
    }
  }
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
        <i :class="favoritesOnly ? 'pi pi-star' : 'pi pi-image'" style="font-size: 3rem; opacity: 0.5"></i>
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
  overflow-y: auto;
  overflow-x: hidden;
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
  font-size: 13px;
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
}

/* 手机设备 (≤768px) */
@media (max-width: 768px) {
  .timeline-scroll-area {
    padding: 0 40px 0 12px;
  }

  .sidebar-wrapper {
    width: 52px;
  }
}

/* 小屏手机 (≤480px) */
@media (max-width: 480px) {
  .timeline-scroll-area {
    padding: 0 8px;
  }

  .sidebar-wrapper {
    display: none;
  }
}
</style>
