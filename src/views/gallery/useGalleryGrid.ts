// 图库网格的数据与虚拟滚动（交接说明 8.2）：按天分组、等高行、按需加载可见天、刻度条拖动跳转、灯箱。
// 「状态」只勾了「失效」时改按有没有可用备份分两组（useDeadSections），不按天、没有刻度条。
// 复用时间轴那组 composables，尺寸照 GalleryScreen.dc.html，筛选由页面整份传进来。
// 换筛选（LoadingRules ①「切换直接显示内容」）：新结果连同第一屏的图读好之前屏幕上留着旧的，
// 读好后一次换上、从最上面看起；不出现只有日期标题的空网格，也不出现整屏灰色占位块。

import { computed, onUnmounted, watch, type Ref } from 'vue';
import type { DayStatsFilter } from '@/services/database/types';
import type { PhotoGroup } from '@/composables/timeline/types';
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
import { firstScreenDayKeys } from '@/composables/timeline/useTimelineLayout';
import { useVisibleDayBuffer } from '@/composables/timeline/useVisibleDayBuffer';
import { useScrollAnchor } from '@/composables/timeline/useScrollAnchor';
import { useVirtualTimeline } from '@/composables/timeline/useVirtualTimeline';
import { confirmedHttpHostsKey } from '@/security/networkPolicy';
import { historyDB } from '@/services/database';
import { isDeadOnly, useDeadSections } from './useDeadSections';
import { useListLightbox } from './useListLightbox';

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

  /** 第一屏按多大估：滚动区量得到就按它；还没显示出来（列表视图、空状态）按窗口估，只多不少 */
  function firstScreenViewport(): { width: number; height: number } {
    const el = scrollContainer.value;
    return { width: el?.clientWidth || window.innerWidth, height: el?.clientHeight || window.innerHeight };
  }

  const pagination = useTimelineDayPagination({
    filter,
    visible,
    // 网格没在显示（列表视图）：不必先读，按天汇总一到就换上（列表的总数跟着它），屏幕附近的天随后照常补读
    firstScreenDays: (stats) => (visible.value ? firstScreenDayKeys(stats, firstScreenViewport(), GALLERY_GRID) : []),
  });
  const { dayStats, ensureDaysLoaded, prefetchDayAspectRatios, loadedDayKeys, isLoadingStats, isFullyPreloaded } = pagination;

  /** 「状态」只勾了「失效」：按有没有可用备份分两组（G06 / G07） */
  const wantSectioned = computed(() => isDeadOnly(filter.value));
  const sections = useDeadSections(filter, wantSectioned);

  /**
   * 屏幕上的这份结果：要换的那一份（按天的或两组的）按眼前的筛选读好之前，一直是上一份；
   * key = 它是按哪份筛选读的，变了就是换了一份结果
   */
  const filterKey = computed(() => JSON.stringify(filter.value));
  const shown = computed<{ sectioned: boolean; groups: PhotoGroup[]; key: string }>((previous) => {
    const sectionedNext = wantSectioned.value;
    const ready = sectionedNext ? sections.isReady.value : !pagination.isSwitching.value;
    if (previous && !ready) return previous;
    return { sectioned: sectionedNext, groups: sectionedNext ? sections.groups.value : pagination.groups.value, key: filterKey.value };
  });
  /** 按有没有可用备份分两组（G06 / G07）的那种排法（屏幕上的） */
  const sectioned = computed(() => shown.value.sectioned);
  const groups = computed(() => shown.value.groups);
  /** 屏幕上还是上一份筛选的结果，新的在读 */
  const isSwitching = computed(() => shown.value.key !== filterKey.value);

  /** 按月汇总（刻度条的年月刻度、拖动跳转都用它），新的在前；分两组时没有刻度条 */
  const months = computed<MonthTick[]>(() => {
    if (sectioned.value) return [];
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

  const imageLoad = useImageLoadManager(virtual.visibleItems, { maxCache: 500, maxRetry: 1 });
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

  /** 分两组时灯箱按两组眼前的顺序翻（一次读全，「3 / 21」是第几张） */
  const sectionLightbox = useListLightbox({
    list: { ensure: async () => {}, rowAt: (i: number) => sections.items.value[i] ?? null },
    total: sections.total,
    detailCache: historyManager.detailCache,
    config: configManager.config,
    confirmedHttpHosts: () => confirmedHttpHosts.value,
    toast,
  });

  // layout 重算时保持视口锚点，消除高度估算偏差带来的跳动
  const anchor = useScrollAnchor(scrollContainer, virtual.layoutResult, virtual.isCalculating, virtual.visibleItems);

  const jump = useTimelineJump({
    scrollContainer,
    groups,
    isCalculating: virtual.isCalculating,
    layoutResult: virtual.layoutResult,
    timePeriodStats: months,
    forceUpdateVisibleArea: virtual.forceUpdateVisibleArea,
    jumpToMonth: historyManager.jumpToMonth,
    ensureDaysLoaded,
    prefetchDayAspectRatios,
    loadedDayKeys,
    isFullyPreloaded,
    hasLoadedStats: pagination.hasLoadedStats,
    forceNormalMode: virtual.forceNormalMode,
    suspendScrollAnchor: anchor.suspend,
    resumeScrollAnchor: anchor.resume,
  });

  const visibleDayBuffer = useVisibleDayBuffer({ visibleDayKeys: virtual.visibleDayKeys, dayStats, ensureDaysLoaded });

  // 换了一份结果：立刻按新分组排好、从最上面看起（与新内容同一帧），之前记下的滚动位置作废。
  // 视口锚点只管同一份结果里的重排，这一次先停掉，免得把位置拉回旧内容那里
  watch(() => shown.value.key, () => {
    anchor.suspend();
    virtual.showFromTop();
    scrollRestore.resetToTop();
    anchor.resume();
  });

  function onScroll(): void {
    scrollRestore.trackScrollPosition();
    virtual.handleScroll();
    scrubber.onScroll();
  }

  /** 选择框 / Ctrl·⌘ 单击 / Shift 连选，按页面上的顺序 */
  function toggleSelect(id: string, event: MouseEvent): void {
    viewState.handleSelectClick(id, event, allLoadedMetas.value.map((m) => m.id));
  }

  /** Ctrl·⌘ A：全选当前结果（按当前筛选查出全部，不只是已经加载出来的几天；列表视图同一份结果） */
  async function selectAll(): Promise<void> {
    viewState.selectMany(await historyDB.getIdsByFilter(filter.value));
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
    sectioned,
    sectionItems: sections.items,
    sectionLightbox,
    /** 屏幕上这份结果的张数 */
    totalCount: computed(() => groups.value.reduce((sum, group) => sum + (group.expectedCount ?? group.items.length), 0)),
    isSwitching,
    /** 换筛选的新结果还没换上，或屏幕上这份还在读（按天的还在预取宽高比） */
    isLoadingStats: computed(() => isSwitching.value || (sectioned.value ? sections.isLoading.value : isLoadingStats.value)),
    /** 读出过结果（冷启动骨架只在这之前出现） */
    hasLoadedStats: computed(() => pagination.hasLoadedStats.value || sections.hasLoaded.value),
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
    selectAll,
  };
}

export type GalleryGridApi = ReturnType<typeof useGalleryGrid>;
