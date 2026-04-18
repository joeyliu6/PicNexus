/**
 * 拖拽滚动 + 骨架屏 + 时间轴指示器 Composable
 * 管理时间轴侧边栏拖拽滚动、视图切换骨架屏、指示器定位与跳转
 */
import { ref, computed, watch, nextTick, onUnmounted, type Ref, type ComputedRef } from 'vue';
import { generateSkeletonLayout } from '../../utils/justifiedLayout';
import { createLogger } from '../../utils/logger';
import type { PhotoGroup } from '../useVirtualTimeline';

const log = createLogger('TimelineJump');

/** 骨架屏最小显示时间（毫秒），避免闪烁 */
const SKELETON_MIN_DISPLAY_MS = 300;
/** 拖拽结束延迟（毫秒） */
const DRAG_END_DELAY_MS = 50;
/** 侧边栏宽度预估（px），用于骨架屏容器宽度计算 */
const SIDEBAR_WIDTH_PX = 90;

/** 布局结果中的分组布局信息 */
interface GroupLayoutInfo {
  groupId: string;
  headerY: number;
  contentY: number;
  contentHeight: number;
}

interface UseTimelineDragAndSkeletonOptions {
  scrollContainer: Ref<HTMLElement | null>;
  /** 分组数据 */
  groups: ComputedRef<PhotoGroup[]>;
  /** 布局是否正在计算中 */
  isCalculating: Ref<boolean>;
  /** 组件是否可见 */
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
  /** 强制回到 normal 显示模式（跳转中压制 fast-mode，避免瞬间 scrollTop 大跳被 velocity 误判） */
  forceNormalMode: () => void;
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

  const showSkeleton = ref(false);
  let isDragging = false;
  let dragEndTimer: number | undefined;
  let skeletonMinDisplayTimeout: number | undefined;
  // 跳转期间禁用 watch(isCalculating) 的自动 hideSkeleton，避免 layout flip 反复重置 300ms timer
  let isJumping = false;

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

  /**
   * 跳转到指定月份。
   * - isFullyPreloaded=true：layout 已是精准骨架，单次 scrollTop 直接落点，真图后台加载
   * - 否则：±2 月 prefetch → 等 layout settled → 早跳 → ensureDaysLoaded → 晚跳兜底
   */
  async function handleJumpToPeriod(year: number, month: number): Promise<void> {
    if (!hasLoadedStats.value) return;

    log.debug(`[jump] ${year}-${month} path=${isFullyPreloaded.value ? 'normal' : 'downgrade'}`);

    isJumping = true;
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
      const targetDayKey = monthGroups[0].id;

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
        // 延迟真图加载：避免缓存命中时骨架 < 100ms 即逝产生视觉撕裂
        setTimeout(() => void ensureDaysLoaded(loadKeys), SKELETON_MIN_DISPLAY_MS);
      } else {
        const prefetchKeys = groups.value.filter(g => monthDelta(g.year, g.month) <= 2).map(g => g.id);
        const hitCache = monthGroups.every(g => loadedDayKeys.value.has(g.id));
        if (!hitCache) {
          await prefetchDayAspectRatios(prefetchKeys);
          await nextTick();
          await waitLayoutSettled();
          await nextTick();
          await new Promise<void>(r => requestAnimationFrame(() => r()));
          await new Promise<void>(r => requestAnimationFrame(() => r()));

          if (scrollContainer.value) {
            const earlyLayout = layoutResult.value?.groupLayouts.find(gl => gl.groupId === targetDayKey);
            const slots = earlyLayout?.skeletonSlots;
            // slots[0].width ≈ slots[1].width 说明还是等宽骨架（路径 ③），跳了也对不准 → 等晚跳
            const looksJustified = !slots || slots.length < 2
              || Math.abs(slots[0].width - slots[1].width) > 0.5;
            if (earlyLayout && looksJustified) {
              scrollContainer.value.scrollTop = earlyLayout.headerY;
              forceNormalMode(scrollContainer.value.scrollTop);
              forceUpdateVisibleArea();
            } else if (earlyLayout) {
              log.warn(`早跳跳过（目标月 ${targetDayKey} skeletonSlots 仍为等宽）`);
            }
          }
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
      forceHideSkeleton();
      forceNormalMode(scrollContainer.value?.scrollTop);
      resumeScrollAnchor?.();
      isJumping = false;
    }
  }

  /** 跳转到指定年份 */
  async function handleJumpToYear(year: number): Promise<void> {
    const yearGroups = groups.value.filter(g => g.year === year);

    if (yearGroups.length > 0) {
      // 年内跳转：本地滚动，快速加载不需要骨架屏
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
      // 跨年跳转到未加载区域：走 handleJumpToPeriod（已带骨架屏）
      const periods = timePeriodStats.value;
      const yearPeriods = periods.filter(p => p.year === year);
      if (yearPeriods.length > 0) {
        const earliestPeriod = yearPeriods[yearPeriods.length - 1];
        await handleJumpToPeriod(year, earliestPeriod.month);
      }
    }
  }

  // ==================== 骨架屏控制 ====================

  function hideSkeleton(): void {
    if (!showSkeleton.value) return;
    // 已在倒计时则不重置：避免 watch(isCalculating) 反复重置 300ms timer 导致 skeleton 永不消失
    if (skeletonMinDisplayTimeout) return;
    skeletonMinDisplayTimeout = window.setTimeout(() => {
      showSkeleton.value = false;
      skeletonMinDisplayTimeout = undefined;
    }, SKELETON_MIN_DISPLAY_MS);
  }

  /** 跳转完成时使用：立即 hide 骨架屏，不走 300ms 延迟 */
  function forceHideSkeleton(): void {
    if (skeletonMinDisplayTimeout) {
      clearTimeout(skeletonMinDisplayTimeout);
      skeletonMinDisplayTimeout = undefined;
    }
    showSkeleton.value = false;
  }

  function showSkeletonWithCheck(): void {
    if (skeletonMinDisplayTimeout) {
      clearTimeout(skeletonMinDisplayTimeout);
      skeletonMinDisplayTimeout = undefined;
    }
    showSkeleton.value = true;
    nextTick(() => {
      // 跳转期间由 handleJumpToPeriod 末尾统一 hideSkeleton，nextTick 不能抢先启动 timer
      if (!isCalculating.value && !isJumping) {
        hideSkeleton();
      }
    });
  }

  watch(
    () => visible.value,
    (isVisible, wasVisible) => {
      if (!isVisible || wasVisible) return;
      // 只有在有数据时才显示骨架屏，避免空状态闪烁
      if (groups.value.length > 0) {
        showSkeletonWithCheck();
      }
    }
  );

  watch(
    () => isCalculating.value,
    (calculating) => {
      // 跳转期间不让 layout flip 反复重置 hideSkeleton 的 300ms timer，由 handleJumpToPeriod 自管理
      if (!calculating && showSkeleton.value && !isJumping) {
        hideSkeleton();
      }
    }
  );

  // ==================== 拖拽滚动 ====================

  function handleSidebarWheel(e: WheelEvent): void {
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop += e.deltaY;
    }
  }

  async function handleDragScroll(progress: number, _source: 'click' | 'drag' | 'wheel' = 'drag'): Promise<void> {
    // _source 仅为保持调用方签名兼容，函数内部不再区分来源（已加载月 click 不显 overlay）
    isDragging = true;
    setLastStableProgress(progress);

    if (dragEndTimer) clearTimeout(dragEndTimer);
    dragEndTimer = window.setTimeout(() => {
      isDragging = false;
      // 数据由 ±5 天 visibleDayKeys 缓冲 watch 补齐，骨架由 watch(isCalculating) 在 layout 重算完成后自然淡出
      forceUpdateVisibleArea();
    }, DRAG_END_DELAY_MS);

    scrollToProgress(progress, true);
  }

  function getIsDragging(): boolean {
    return isDragging;
  }

  function cleanup(): void {
    if (dragEndTimer) clearTimeout(dragEndTimer);
    if (skeletonMinDisplayTimeout) clearTimeout(skeletonMinDisplayTimeout);
  }

  // 防御性清理：即使调用方忘记手动 cleanup，也能保证定时器释放
  onUnmounted(cleanup);

  return {
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
    cleanup,
  };
}
