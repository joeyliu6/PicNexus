/**
 * 拖拽滚动 + 跳转骨架 + 时间轴指示器 Composable
 * 管理时间轴侧边栏拖拽滚动、跳转期间 photo-item 灰底/shimmer、指示器定位与跳转
 */
import { ref, computed, watch, nextTick, onUnmounted, type Ref, type ComputedRef } from 'vue';
import { generateSkeletonLayout } from '../../utils/justifiedLayout';
import { createLogger } from '../../utils/logger';
import type { PhotoGroup } from '../useVirtualTimeline';

const log = createLogger('TimelineJump');

/** 跳转期间 photo-item 灰底最小显示时间（毫秒），保证眼睛缓冲窗口 */
const SKELETON_MIN_DISPLAY_MS = 400;
/** 首次加载专用 min-display（毫秒）：比跳转更长，给网络下载多留时间 → 撤 class 时更多图片已就绪，一起淡入更稳 */
const FIRST_LOAD_MIN_DISPLAY_MS = 700;
/** 拖拽结束延迟（毫秒） */
const DRAG_END_DELAY_MS = 50;
/** 侧边栏宽度预估（px），用于骨架屏容器宽度计算 */
const SIDEBAR_WIDTH_PX = 90;

/** 布局结果中的分组布局信息（结构对齐 utils/justifiedLayout.ts TimelineGroupLayout 的子集） */
interface GroupLayoutInfo {
  groupId: string;
  headerY: number;
  contentY: number;
  contentHeight: number;
  /** 骨架占位矩形（skeleton 天存在，跳转早跳判定是否等宽时读） */
  skeletonSlots?: Array<{ x: number; y: number; width: number; height: number }>;
}

interface UseTimelineDragAndSkeletonOptions {
  scrollContainer: Ref<HTMLElement | null>;
  /** 分组数据 */
  groups: ComputedRef<PhotoGroup[]>;
  /** 布局是否正在计算中 */
  isCalculating: Ref<boolean>;
  /** 视图是否可见（首次可见 + 已有数据时补触发 first-load skeleton，避免数据幕后加载时错过骨架期） */
  visible: ComputedRef<boolean | undefined>;
  /** 虚拟滚动总高度 */
  totalHeight: Ref<number>;
  /** 当前滚动进度（0-1） */
  scrollProgress: Ref<number>;
  /** 视口高度 */
  viewportHeight: Ref<number>;
  /** 布局结果（含 groupLayouts） */
  layoutResult: Ref<{ groupLayouts: GroupLayoutInfo[] } | null>;
  /** 时间段统计 */
  timePeriodStats: ComputedRef<Array<{ year: number; month: number }>>;

  /** 设置最后稳定进度 */
  setLastStableProgress: (progress: number) => void;
  /** 按进度滚动 */
  scrollToProgress: (progress: number, force?: boolean) => void;
  /** 按元素 ID 滚动 */
  scrollToItem: (id: string, behavior?: ScrollBehavior) => void;
  /** 强制刷新可见区域 */
  forceUpdateVisibleArea: () => void;
  /** 跳转到月份（仅做存在性校验） */
  jumpToMonth: (year: number, month: number) => Promise<boolean>;
  /** 按需加载指定天的图片数据（跳转时拉齐目标月第一天） */
  ensureDaysLoaded: (dayKeys: string[]) => Promise<void>;
  /** 预取 aspectRatios 到 LRU cache（降级模式或 isFullyPreloaded=false 时使用） */
  prefetchDayAspectRatios: (dayKeys: string[]) => Promise<void>;
  /** 已加载的 dayKey 集合（用于跳转时判定缓存命中） */
  loadedDayKeys: Ref<Set<string>>;
  /** v7：全量 aspectRatios 是否已预取完成（true → 跳转可跳过 prefetch 等待直接落点） */
  isFullyPreloaded: Ref<boolean>;
  /** dayStats 是否已加载（false 时 handleJumpToPeriod 早退,避免在空 groups 上跳转） */
  hasLoadedStats: Ref<boolean>;
  /** 强制回到 normal 显示模式（跳转中压制 fast-mode，避免瞬间 scrollTop 大跳被 velocity 误判）。
   *  可选参数 syncScrollTop：调用方刚 set 的 DOM scrollTop，避免 velocity 用缓存旧值 clamp 误差 */
  forceNormalMode: (syncScrollTop?: number) => void;
  /** 跳转期间暂停视口锚点（避免 sync watch 在 spacer 未 flush 时抢写 scrollTop） */
  suspendScrollAnchor?: () => void;
  resumeScrollAnchor?: () => void;
}

export function useTimelineDragAndSkeleton(options: UseTimelineDragAndSkeletonOptions) {
  const {
    scrollContainer, groups, isCalculating, visible,
    totalHeight, viewportHeight, layoutResult, timePeriodStats,
    setLastStableProgress, scrollToProgress, scrollToItem,
    forceUpdateVisibleArea, jumpToMonth, ensureDaysLoaded, prefetchDayAspectRatios, loadedDayKeys,
    isFullyPreloaded, hasLoadedStats,
    forceNormalMode,
    suspendScrollAnchor, resumeScrollAnchor,
  } = options;

  // ==================== 状态 ====================

  let isDragging = false;
  let dragEndTimer: number | undefined;
  let firstLoadTimer: number | undefined;
  // 跳转期间：驱动 .timeline-view.is-jumping → .photo-img opacity 0 + photo-item shimmer（露出按真图位置对齐的灰底骨架）
  const isJumping = ref(false);
  // 首次可见 + 有数据 时触发：复用 .is-jumping class 让首屏也有 FIRST_LOAD_MIN_DISPLAY_MS 的骨架期
  const isFirstLoadSkeleton = ref(false);
  let hasTriggeredFirstLoad = false;

  function triggerFirstLoadSkeleton(): void {
    isFirstLoadSkeleton.value = true;
    if (firstLoadTimer) clearTimeout(firstLoadTimer);
    firstLoadTimer = window.setTimeout(() => {
      isFirstLoadSkeleton.value = false;
      firstLoadTimer = undefined;
    }, FIRST_LOAD_MIN_DISPLAY_MS);
  }

  // A：groups 0→N 时触发（用户正在看：场景=快速切到时间轴、filter 切换）
  watch(() => groups.value.length, (newLen, oldLen) => {
    if ((oldLen ?? 0) === 0 && newLen > 0 && visible.value) {
      hasTriggeredFirstLoad = true;
      triggerFirstLoadSkeleton();
    }
  });

  // B：visible false→true 且尚未触发过、数据已齐时补触发（场景=数据幕后已加载完成，用户再切过来）
  watch(() => visible.value, (v) => {
    if (v && !hasTriggeredFirstLoad && groups.value.length > 0) {
      hasTriggeredFirstLoad = true;
      triggerFirstLoadSkeleton();
    }
  });

  // ==================== 时间轴指示器 computed ====================

  /** 已加载的月份集合：该月所有天的 items 都已加载才算；否则视为未加载（未加载月点击走 jump-to-period 预取路径） */
  const loadedMonthsSet = computed(() => {
    const set = new Set<string>();
    const loaded = loadedDayKeys.value;
    const perMonth = new Map<string, { total: number; loaded: number }>();
    for (const group of groups.value) {
      const key = `${group.year}-${group.month}`;
      const c = perMonth.get(key);
      const isLoaded = loaded.has(group.id);
      if (c) {
        c.total++;
        if (isLoaded) c.loaded++;
      } else {
        perMonth.set(key, { total: 1, loaded: isLoaded ? 1 : 0 });
      }
    }
    for (const [key, { total, loaded }] of perMonth) {
      if (total > 0 && loaded === total) set.add(key);
    }
    return set;
  });

  /** 基于布局高度的月份位置映射（用于指示器精确定位） */
  const monthLayoutPositions = computed(() => {
    const map = new Map<string, { start: number; end: number }>();
    if (!layoutResult.value || totalHeight.value <= 0) return map;

    const monthGroups = new Map<string, { startY: number; endY: number }>();

    // 预建索引避免 O(N²) 查找
    const groupById = new Map(groups.value.map(g => [g.id, g]));

    for (const group of layoutResult.value.groupLayouts) {
      const groupData = groupById.get(group.groupId);
      if (!groupData) continue;

      const monthKey = `${groupData.year}-${groupData.month}`;
      const groupEnd = group.contentY + group.contentHeight;

      if (!monthGroups.has(monthKey)) {
        monthGroups.set(monthKey, { startY: group.headerY, endY: groupEnd });
      } else {
        const existing = monthGroups.get(monthKey)!;
        existing.endY = Math.max(existing.endY, groupEnd);
      }
    }

    const maxScroll = Math.max(1, totalHeight.value - viewportHeight.value);
    for (const [key, { startY, endY }] of monthGroups) {
      map.set(key, {
        start: Math.min(1, startY / maxScroll),
        end: Math.min(1, endY / maxScroll),
      });
    }

    return map;
  });

  /** 视口可见比例（0-1） */
  const visibleRatio = computed(() => {
    if (totalHeight.value <= viewportHeight.value) return 1;
    return viewportHeight.value / totalHeight.value;
  });

  /** 骨架屏布局数据 */
  const skeletonLayout = computed(() => {
    let width: number;
    if (viewportHeight.value > 0 && scrollContainer.value) {
      const style = getComputedStyle(scrollContainer.value);
      width = scrollContainer.value.clientWidth
        - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    } else {
      width = window.innerWidth - SIDEBAR_WIDTH_PX;
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

  // ==================== 跳转 ====================

  /** 等待 isCalculating 降为 false（layout 异步重算完成），最多等 timeoutMs */
  function waitLayoutSettled(timeoutMs = 500): Promise<void> {
    if (!isCalculating.value) return Promise.resolve();
    return new Promise((resolve) => {
      const stop = watch(isCalculating, (v) => {
        if (!v) { stop(); clearTimeout(timer); resolve(); }
      });
      const timer = setTimeout(() => { stop(); resolve(); }, timeoutMs);
    });
  }

  /** 补齐 SKELETON_MIN_DISPLAY_MS 最小显示窗口：已到期即刻返回，否则 sleep 剩余量 */
  function waitMinDisplay(startTime: number): Promise<void> {
    const remaining = SKELETON_MIN_DISPLAY_MS - (Date.now() - startTime);
    return remaining > 0 ? new Promise(r => setTimeout(r, remaining)) : Promise.resolve();
  }

  /**
   * 跳转到指定年月日（day 为月内进度估算，精度"那附近"；未传则回退为月最新一天）
   * - isFullyPreloaded=true：layout 已是精准骨架，单次 scrollTop 直接落点，真图后台加载
   * - 否则：±2 月 prefetch → 等 layout settled → ensureDaysLoaded → 单次 scrollTo
   *   （骨架期全程盖住，无中间"日期闪跳"现象，所以砍掉旧版的"早跳"）
   */
  async function handleJumpToPeriod(year: number, month: number, day?: number): Promise<void> {
    if (!hasLoadedStats.value) return;
    // 重入守卫：并发 click 直接忽略第二次，防止 isJumping 状态互相踩脚
    if (isJumping.value) return;

    log.debug(`[jump] ${year}-${month}-${day ?? 'latest'} path=${isFullyPreloaded.value ? 'normal' : 'downgrade'}`);

    const jumpStartTime = Date.now();
    // 置位 → 触发 .timeline-view.is-jumping → 所有 .photo-img opacity 0 + header 文字 opacity 0（骨架期盖住一切视觉）
    isJumping.value = true;
    // 锚点的 sync watch 会在 layout 重算时把 scrollTop 锁回旧视口位置，必须先关
    suspendScrollAnchor?.();
    // 跳转瞬间 scrollTop 会跨数万 px，useScrollVelocity 会误判为极高速 → fast 模式灰色网格
    forceNormalMode();
    try {
      if (!(await jumpToMonth(year, month))) return;

      const monthGroups = groups.value.filter(g => g.year === year && g.month === month);
      if (monthGroups.length === 0) {
        // filter 下目标月被过滤 → 滚到顶
        if (scrollContainer.value) scrollContainer.value.scrollTop = 0;
        return;
      }
      // groups 按时间降序；未传 day → 跳月最新一天（monthGroups[0]）；传 day → 选 |g.day - day| 最小者
      const targetGroup = day === undefined
        ? monthGroups[0]
        : monthGroups.reduce((best, g) => Math.abs(g.day - day) < Math.abs(best.day - day) ? g : best);
      const targetDayKey = targetGroup.id;

      const monthDelta = (gy: number, gm: number) => Math.abs((gy * 12 + gm) - (year * 12 + month));
      const loadKeys = groups.value.filter(g => monthDelta(g.year, g.month) <= 1).map(g => g.id);

      if (isFullyPreloaded.value) {
        if (scrollContainer.value) {
          const target = layoutResult.value?.groupLayouts.find(gl => gl.groupId === targetDayKey);
          if (target) {
            scrollContainer.value.scrollTop = target.headerY;
            forceNormalMode(scrollContainer.value.scrollTop);
            forceUpdateVisibleArea();
          }
        }
        // await 真 items 加载完再撤 is-jumping：原 setTimeout 400ms 后撤 class 但 items 还没到，会露出底层
        // photo-slot-skeleton 静态灰块与 shimmer 骨架断裂。waitMinDisplay 在 finally 兜底 400ms，缓存命中不会闪。
        await ensureDaysLoaded(loadKeys);
      } else {
        const prefetchKeys = groups.value.filter(g => monthDelta(g.year, g.month) <= 2).map(g => g.id);
        const hitCache = monthGroups.every(g => loadedDayKeys.value.has(g.id));
        if (!hitCache) {
          await prefetchDayAspectRatios(prefetchKeys);
          await nextTick();
          await waitLayoutSettled();
        }

        await ensureDaysLoaded(loadKeys);
        await nextTick();
        await waitLayoutSettled();
        await nextTick();

        if (scrollContainer.value) {
          const targetLayout = layoutResult.value?.groupLayouts.find(gl => gl.groupId === targetDayKey);
          const targetTop = targetLayout ? targetLayout.headerY : 0;
          scrollContainer.value.scrollTop = targetTop;
          if (Math.abs(scrollContainer.value.scrollTop - targetTop) > 1) {
            await nextTick();
            if (scrollContainer.value) scrollContainer.value.scrollTop = targetTop;
          }
          forceNormalMode(scrollContainer.value.scrollTop);
        }
      }
    } finally {
      forceUpdateVisibleArea();
      // 保证图片隐藏期至少 SKELETON_MIN_DISPLAY_MS，让眼睛有缓冲窗口（缓存命中时 ensureDays 瞬间跑完）
      await waitMinDisplay(jumpStartTime);
      forceNormalMode(scrollContainer.value?.scrollTop);
      resumeScrollAnchor?.();
      // 复位：.photo-img opacity 0→1 走 --duration-medium 淡入，照片自然显露
      isJumping.value = false;
    }
  }

  /** 跳转到指定年份 */
  async function handleJumpToYear(year: number): Promise<void> {
    // 重入守卫：与 handleJumpToPeriod 共用 isJumping 防打架
    if (isJumping.value) return;

    const yearGroups = groups.value.filter(g => g.year === year);

    if (yearGroups.length > 0) {
      // 年内跳转：本地滚动路径也要缓冲（缓存命中同样刺眼）
      const yearJumpStart = Date.now();
      isJumping.value = true;
      try {
        const firstGroup = yearGroups[yearGroups.length - 1];
        if (firstGroup.items.length > 0) {
          scrollToItem(firstGroup.items[0].id);
        } else if (layoutResult.value) {
          // skeleton 天：直接定位到该分组的布局位置
          const groupLayout = layoutResult.value.groupLayouts.find(gl => gl.groupId === firstGroup.id);
          if (groupLayout && totalHeight.value > viewportHeight.value) {
            const maxScroll = totalHeight.value - viewportHeight.value;
            scrollToProgress(groupLayout.headerY / maxScroll, true);
          }
        }
      } finally {
        await waitMinDisplay(yearJumpStart);
        isJumping.value = false;
      }
    } else {
      // 跨年跳转到未加载区域：走 handleJumpToPeriod（它自己会盖纱帘）
      const periods = timePeriodStats.value;
      const yearPeriods = periods.filter(p => p.year === year);
      if (yearPeriods.length > 0) {
        const earliestPeriod = yearPeriods[yearPeriods.length - 1];
        await handleJumpToPeriod(year, earliestPeriod.month);
      }
    }
  }

  // ==================== 拖拽滚动 ====================

  function handleSidebarWheel(e: WheelEvent): void {
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop += e.deltaY;
    }
  }

  async function handleDragScroll(progress: number, _source: 'click' | 'drag' | 'wheel' = 'drag'): Promise<void> {
    // _source 仅为保持调用方签名兼容，函数内部不再区分来源（click 路径已统一改走 handleJumpToPeriod）
    isDragging = true;
    setLastStableProgress(progress);

    if (dragEndTimer) clearTimeout(dragEndTimer);
    dragEndTimer = window.setTimeout(() => {
      isDragging = false;
      // 数据由 ±5 天 visibleDayKeys 缓冲 watch 补齐
      forceUpdateVisibleArea();
    }, DRAG_END_DELAY_MS);

    scrollToProgress(progress, true);
  }

  function getIsDragging(): boolean {
    return isDragging;
  }

  function cleanup(): void {
    if (dragEndTimer) clearTimeout(dragEndTimer);
    if (firstLoadTimer) clearTimeout(firstLoadTimer);
  }

  // 防御性清理：即使调用方忘记手动 cleanup，也能保证定时器释放
  onUnmounted(cleanup);

  return {
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
    cleanup,
  };
}
