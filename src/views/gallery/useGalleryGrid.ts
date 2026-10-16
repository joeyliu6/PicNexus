// 图库网格的数据与虚拟滚动（交接说明 8.2）：按天分组、等高行、按需加载可见天、刻度条拖动跳转、灯箱。
// 复用时间轴那组 composables，尺寸照 GalleryScreen.dc.html，筛选由页面整份传进来。

import { computed, onUnmounted, watch, type Ref } from 'vue';
import type { DayStatsFilter } from '@/services/database/types';
import type { ImageMeta } from '@/types/image-meta';
import { useHistoryViewState } from '@/composables/history/useHistoryViewState';
import { useHistoryManager } from '@/composables/history/useHistory';
import { useConfigManager } from '@/composables/useConfig';
import { useToast } from '@/composables/useToast';
import { useImageLoadManager } from '@/composables/image/useImageLoadManager';
import { useConfirmedHttpHosts } from '@/composables/image/useConfirmedHttpHosts';
import { getMetaThumbnailCandidates } from '@/composables/image/useThumbCache';
import { useTimelineSidebarControl } from '@/composables/timeline/useTimelineSidebarControl';
import { useScrollRestore } from '@/composables/timeline/useScrollRestore';
import { useImagePreload } from '@/composables/timeline/useImagePreload';
import { useTimelineLightbox } from '@/composables/timeline/useTimelineLightbox';
import { useTimelineJump } from '@/composables/timeline/useTimelineJump';
import { useTimelineDayPagination } from '@/composables/timeline/useTimelineDayPagination';
import { useVisibleDayBuffer } from '@/composables/timeline/useVisibleDayBuffer';
import { useScrollAnchor } from '@/composables/timeline/useScrollAnchor';
import { useVirtualTimeline } from '@/composables/timeline/useVirtualTimeline';
import { confirmedHttpHostsKey } from '@/security/networkPolicy';

/** GalleryScreen.dc.html：行高 150、格间距 6；日期标题 34 + 与首行间距 6；两天之间 18 + 6 */
export const GALLERY_GRID = { targetRowHeight: 150, gap: 6, headerHeight: 40, groupGap: 24, overscan: 3 } as const;

/** 刻度条：停止滚动 1.5 秒后淡出（交接说明 8.2） */
const SCRUBBER_HIDE_MS = 1500;

export interface MonthTick {
  year: number;
  month: number;
  count: number;
  minTimestamp: number;
  maxTimestamp: number;
}

export function useGalleryGrid(scrollContainer: Ref<HTMLElement | null>, filter: Ref<DayStatsFilter>, visible: Ref<boolean>) {
  const toast = useToast();
  const viewState = useHistoryViewState();
  const historyManager = useHistoryManager();
  const configManager = useConfigManager();
  const confirmedHttpHosts = useConfirmedHttpHosts(configManager.config);

  const scrubber = useTimelineSidebarControl({ scrollHideDelay: SCRUBBER_HIDE_MS, hoverHideDelay: 300 });

  const pagination = useTimelineDayPagination({ filter, visible });
  const { groups, dayStats, ensureDaysLoaded, prefetchDayAspectRatios, loadedDayKeys, isLoadingStats, hasLoadedStats, isFullyPreloaded } = pagination;

  /** 按月汇总（刻度条的年月刻度、拖动跳转都用它），新的在前 */
  const months = computed<MonthTick[]>(() => {
    const byMonth = new Map<string, MonthTick>();
    for (const day of dayStats.value) {
      const key = `${day.year}-${day.month}`;
      const existing = byMonth.get(key);
      if (existing) {
        existing.count += day.count;
        existing.minTimestamp = Math.min(existing.minTimestamp, day.minTimestamp);
        existing.maxTimestamp = Math.max(existing.maxTimestamp, day.maxTimestamp);
      } else {
        byMonth.set(key, { year: day.year, month: day.month, count: day.count, minTimestamp: day.minTimestamp, maxTimestamp: day.maxTimestamp });
      }
    }
    return [...byMonth.values()].sort((a, b) => b.year - a.year || b.month - a.month);
  });

  /** 已加载天的 metas（展平），给选择与灯箱用 */
  const allLoadedMetas = computed(() => groups.value.flatMap((g) => g.items));

  /** 缩略图候选链：主服务排第 0 位，加载失败时 <img> 自动换下一条 */
  const getThumbnailUrls = (meta: ImageMeta): string[] => getMetaThumbnailCandidates(meta, configManager.config.value);

  /** 切换收藏：失败时 useHistory 已回滚并提示，这里只接住异常，免得点击处理留下未处理的 rejection */
  async function toggleFavorite(id: string): Promise<void> {
    try {
      await historyManager.toggleFavorite(id);
    } catch {
      // 已提示
    }
  }

  const virtual = useVirtualTimeline(scrollContainer, groups, GALLERY_GRID);

  const imageLoad = useImageLoadManager(virtual.visibleItems, { maxCache: 500, destroyDelay: 2500, maxRetry: 1 });
  // 用户刚确认完明文 HTTP 域名：之前因此判失败的缩略图应该自己恢复（按名单内容比，见 confirmedHttpHostsKey）
  watch(() => confirmedHttpHostsKey(confirmedHttpHosts.value), () => imageLoad.clearFailed());
  const loadedImages = computed(() => new Set(imageLoad.loadedImages.value));
  const failedImages = computed(() => new Set(imageLoad.failedImages.value));

  const scrollRestore = useScrollRestore({
    scrollContainer,
    virtualScrollTop: virtual.scrollTop,
    totalHeight: virtual.totalHeight,
    viewportHeight: virtual.viewportHeight,
    visibleItems: virtual.visibleItems,
    isCalculating: virtual.isCalculating,
    isLoading: isLoadingStats,
    visible,
    activationTrigger: computed(() => 0),
    callbacks: {
      restoreScrollTop: virtual.restoreScrollTop,
      scrollToProgress: virtual.scrollToProgress,
      scrollToItem: virtual.scrollToItem,
      forceUpdateVisibleArea: virtual.forceUpdateVisibleArea,
      hasItem: (id: string) => virtual.layoutResult.value?.itemPositionMap.has(id) ?? false,
    },
  });

  const preload = useImagePreload({
    visibleItems: virtual.visibleItems,
    allMetas: allLoadedMetas,
    displayMode: virtual.displayMode,
    scrollDirection: virtual.scrollDirection,
    getThumbnailUrls,
    confirmedHttpHosts: () => confirmedHttpHosts.value,
    isImageLoaded: imageLoad.isImageLoaded,
    onImageLoad: imageLoad.onImageLoad,
  });

  const lightbox = useTimelineLightbox({
    dayMetaCache: pagination.dayMetaCache,
    loadedDayKeys,
    ensureDaysLoaded,
    findDayBefore: pagination.findDayBefore,
    findDayAfter: pagination.findDayAfter,
    detailCache: historyManager.detailCache,
    config: configManager.config,
    confirmedHttpHosts: () => confirmedHttpHosts.value,
    scrollToItem: virtual.scrollToItem,
    toast,
  });

  // layout 重算时保持视口锚点，消除高度估算偏差带来的跳动
  const anchor = useScrollAnchor(scrollContainer, virtual.layoutResult, virtual.isCalculating, virtual.visibleItems);

  const jump = useTimelineJump({
    scrollContainer,
    groups,
    isCalculating: virtual.isCalculating,
    totalHeight: virtual.totalHeight,
    viewportHeight: virtual.viewportHeight,
    layoutResult: virtual.layoutResult,
    timePeriodStats: months,
    scrollToProgress: virtual.scrollToProgress,
    scrollToItem: virtual.scrollToItem,
    forceUpdateVisibleArea: virtual.forceUpdateVisibleArea,
    jumpToMonth: historyManager.jumpToMonth,
    ensureDaysLoaded,
    prefetchDayAspectRatios,
    loadedDayKeys,
    isFullyPreloaded,
    hasLoadedStats,
    forceNormalMode: virtual.forceNormalMode,
    suspendScrollAnchor: anchor.suspend,
    resumeScrollAnchor: anchor.resume,
  });

  const visibleDayBuffer = useVisibleDayBuffer({ visibleDayKeys: virtual.visibleDayKeys, dayStats, ensureDaysLoaded });

  function onScroll(): void {
    scrollRestore.trackScrollPosition();
    virtual.handleScroll();
    scrubber.onScroll();
  }

  /** 选择框 / Ctrl·⌘ 单击 / Shift 连选，按页面上的顺序 */
  function toggleSelect(id: string, event: MouseEvent): void {
    viewState.handleSelectClick(id, event, allLoadedMetas.value.map((m) => m.id));
  }

  /** Ctrl·⌘ A：全选当前结果里已加载的图 */
  function selectAllLoaded(): void {
    for (const meta of allLoadedMetas.value) viewState.select(meta.id);
  }

  // 统计（年月刻度用）在页面第一次显示时加载；内部幂等
  watch(visible, (v) => { if (v) void historyManager.loadTimePeriodStats(); }, { immediate: true });

  onUnmounted(() => {
    visibleDayBuffer.cleanup();
    imageLoad.clearAll();
    scrubber.cleanup();
    preload.cleanup();
    viewState.clearSelection();
  });

  return {
    viewState,
    historyManager,
    config: configManager.config,
    confirmedHttpHosts,
    groups,
    months,
    totalCount: pagination.totalCount,
    isLoadingStats,
    hasLoadedStats,
    allLoadedMetas,
    getThumbnailUrls,
    toggleFavorite,
    loadedImages,
    failedImages,
    onImageLoad: imageLoad.onImageLoad,
    onImageError: imageLoad.onImageError,
    virtual,
    jump,
    scrubber,
    lightbox,
    onScroll,
    toggleSelect,
    selectAllLoaded,
  };
}

export type GalleryGridApi = ReturnType<typeof useGalleryGrid>;
