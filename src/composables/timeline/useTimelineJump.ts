/**
 * 时间轴跳转：图库刻度条点击或拖动，跳到某年某月（交接说明 8.2）
 *
 * 跳转中再来的请求只记最后一个，这次落地后接着跳过去：拖动刻度条时一路经过的每个月都会请求，
 * 要去的只是松手时停的那个月；中途经过的直接作废，不排队。
 */
import { ref, watch, nextTick, type Ref, type ComputedRef } from 'vue';
import { createLogger } from '@/utils/logger';
import type { PhotoGroup } from '@/composables/timeline/useVirtualTimeline';

const log = createLogger('TimelineJump');

/** ensureDaysLoaded 超时上限（毫秒）：慢 IO / DB 卡死时放弃等，跳转照常落地 */
const ENSURE_DAYS_TIMEOUT_MS = 2000;

/** 布局结果里跳转要用的部分（结构对齐 utils/justifiedLayout.ts TimelineGroupLayout 的子集） */
interface GroupLayoutInfo {
  groupId: string;
  headerY: number;
}

interface UseTimelineJumpOptions {
  scrollContainer: Ref<HTMLElement | null>;
  /** 分组数据 */
  groups: ComputedRef<PhotoGroup[]>;
  /** 布局是否正在计算中 */
  isCalculating: Ref<boolean>;
  /** 虚拟滚动总高度 */
  totalHeight: Ref<number>;
  /** 视口高度 */
  viewportHeight: Ref<number>;
  /** 布局结果（含 groupLayouts） */
  layoutResult: Ref<{ groupLayouts: GroupLayoutInfo[] } | null>;
  /** 时间段统计（新的在前） */
  timePeriodStats: ComputedRef<Array<{ year: number; month: number }>>;

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
  /** 全量 aspectRatios 是否已预取完成（true → 跳转可跳过 prefetch 等待直接落点） */
  isFullyPreloaded: Ref<boolean>;
  /** dayStats 是否已加载（false 时 handleJumpToPeriod 早退，避免在空 groups 上跳转） */
  hasLoadedStats: Ref<boolean>;
  /** 强制回到 normal 显示模式（跳转中压制 fast-mode，避免瞬间 scrollTop 大跳被 velocity 误判）。
   *  可选参数 syncScrollTop：调用方刚 set 的 DOM scrollTop，避免 velocity 用缓存旧值 clamp 误差 */
  forceNormalMode: (syncScrollTop?: number) => void;
  /** 跳转期间暂停视口锚点（避免 sync watch 在 spacer 未 flush 时抢写 scrollTop） */
  suspendScrollAnchor?: () => void;
  resumeScrollAnchor?: () => void;
}

/** 一次跳转请求：month 缺省 = 跳整年；day 缺省 = 该月最新一天 */
interface JumpTarget {
  year: number;
  month?: number;
  day?: number;
}

export function useTimelineJump(options: UseTimelineJumpOptions) {
  const {
    scrollContainer, groups, isCalculating,
    totalHeight, viewportHeight, layoutResult, timePeriodStats,
    scrollToProgress, scrollToItem,
    forceUpdateVisibleArea, jumpToMonth, ensureDaysLoaded, prefetchDayAspectRatios, loadedDayKeys,
    isFullyPreloaded, hasLoadedStats,
    forceNormalMode,
    suspendScrollAnchor, resumeScrollAnchor,
  } = options;

  /** 正在跳转（落地前不接新的跳转，新请求记进 pending） */
  const isJumping = ref(false);
  let pending: JumpTarget | null = null;

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

  /** ensureDaysLoaded 加超时兜底：慢 IO 时不要让跳转挂死，超时直接放弃等 */
  function ensureDaysWithTimeout(keys: string[]): Promise<void> {
    return Promise.race([
      ensureDaysLoaded(keys),
      new Promise<void>(resolve => setTimeout(resolve, ENSURE_DAYS_TIMEOUT_MS)),
    ]);
  }

  /** 跳转中来的请求只留最后一个；返回 true 表示已记下、这次不跳 */
  function deferIfJumping(target: JumpTarget): boolean {
    if (!isJumping.value) return false;
    pending = target;
    return true;
  }

  /** 这次落地后接着跳到最后请求的那个位置（与刚落地的相同就不再跳） */
  async function runPending(landed: JumpTarget): Promise<void> {
    const next = pending;
    pending = null;
    if (!next || (next.year === landed.year && next.month === landed.month && next.day === landed.day)) return;
    await (next.month === undefined ? handleJumpToYear(next.year) : handleJumpToPeriod(next.year, next.month, next.day));
  }

  /**
   * 跳转到指定年月日（day 为月内进度估算，精度"那附近"；未传则回退为月最新一天）
   * - isFullyPreloaded=true：layout 已是精准骨架，单次 scrollTop 直接落点，真图后台加载
   * - 否则：±2 月 prefetch → 等 layout settled → ensureDaysLoaded → 单次 scrollTo
   */
  async function handleJumpToPeriod(year: number, month: number, day?: number): Promise<void> {
    if (!hasLoadedStats.value) return;
    if (deferIfJumping({ year, month, day })) return;

    log.debug(`[jump] ${year}-${month}-${day ?? 'latest'} path=${isFullyPreloaded.value ? 'normal' : 'downgrade'}`);

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
        // ensureDaysWithTimeout 加 2s 超时兜底，慢 IO / DB 卡死不挂死跳转
        await ensureDaysWithTimeout(loadKeys);
      } else {
        const prefetchKeys = groups.value.filter(g => monthDelta(g.year, g.month) <= 2).map(g => g.id);
        const hitCache = monthGroups.every(g => loadedDayKeys.value.has(g.id));
        if (!hitCache) {
          await prefetchDayAspectRatios(prefetchKeys);
          await nextTick();
          await waitLayoutSettled();
        }

        await ensureDaysWithTimeout(loadKeys);
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
      forceNormalMode(scrollContainer.value?.scrollTop);
      resumeScrollAnchor?.();
      isJumping.value = false;
      // 放在 finally 里：目标月不存在、被筛选掉这些提前 return 的路径也要接着跳
      await runPending({ year, month, day });
    }
  }

  /** 跳转到指定年份：已加载的直接滚到该年最早一天，没加载的转给 handleJumpToPeriod */
  async function handleJumpToYear(year: number): Promise<void> {
    if (deferIfJumping({ year })) return;

    const yearGroups = groups.value.filter(g => g.year === year);

    if (yearGroups.length > 0) {
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
    } else {
      // 跨年跳转到未加载区域：走 handleJumpToPeriod
      const periods = timePeriodStats.value;
      const yearPeriods = periods.filter(p => p.year === year);
      if (yearPeriods.length > 0) {
        const earliestPeriod = yearPeriods[yearPeriods.length - 1];
        await handleJumpToPeriod(year, earliestPeriod.month);
      }
    }
  }

  return {
    isJumping,
    handleJumpToPeriod,
    handleJumpToYear,
  };
}
