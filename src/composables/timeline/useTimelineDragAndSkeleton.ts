/**
 * 拖拽滚动 + 骨架屏 + 时间轴指示器 Composable
 * 管理时间轴侧边栏拖拽滚动、视图切换骨架屏、指示器定位与跳转
 */
import { ref, computed, watch, nextTick, onUnmounted, type Ref, type ComputedRef } from 'vue';
import { generateSkeletonLayout } from '../../utils/justifiedLayout';
import type { PhotoGroup } from '../useVirtualTimeline';

/** 骨架屏最小显示时间（毫秒），避免闪烁 */
const SKELETON_MIN_DISPLAY_MS = 300;
/** 拖拽结束延迟（毫秒） */
const DRAG_END_DELAY_MS = 50;
/** 进度跳变阈值（0-1），超过该值认为是“快速跳转”，展示短时骨架过渡 */
const QUICK_JUMP_SKELETON_THRESHOLD = 0.06;
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
  /** 跳转期间暂停视口锚点（避免 sync watch 在 spacer 未 flush 时抢写 scrollTop） */
  suspendScrollAnchor?: () => void;
  resumeScrollAnchor?: () => void;
}

export function useTimelineDragAndSkeleton(options: UseTimelineDragAndSkeletonOptions) {
  const {
    scrollContainer, groups, isCalculating, visible,
    totalHeight, scrollProgress, viewportHeight, layoutResult, timePeriodStats,
    setLastStableProgress, scrollToProgress, scrollToItem,
    forceUpdateVisibleArea, jumpToMonth, ensureDaysLoaded,
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

  /** 已加载的月份集合 */
  const loadedMonthsSet = computed(() => {
    const set = new Set<string>();
    for (const group of groups.value) {
      set.add(`${group.year}-${group.month}`);
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

  function waitForPaint(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  async function ensureSkeletonVisible(): Promise<void> {
    showSkeletonWithCheck();
    await nextTick();
    await waitForPaint();
  }

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
   * 跳转到指定月份：
   * 1. 显示骨架屏
   * 2. 校验月份存在性
   * 3. 在 groups 中找该月最上方的天（降序排列时的第一个），拉取其真实数据
   * 4. 等 layout 重算完成（避免用 skeleton 估算高度定位）
   * 5. 以该天的 headerY 作为 scrollTop，精确落点
   *
   * 旧实现直接 scrollTop=0 滚到最新天，完全不对；且未等 layout 重算，
   * 会出现"先看到骨架屏→数据回来位置突变"的抖动。
   */
  async function handleJumpToPeriod(year: number, month: number): Promise<void> {
    isJumping = true;
    await ensureSkeletonVisible();
    // 跳转期间禁用视口锚点：我们要主动把 scrollTop 设到目标月，
    // 锚点的 sync watch 会在 layout 重算瞬间把 scrollTop 锁回旧视口位置，形成抢写
    suspendScrollAnchor?.();
    try {
      if (!(await jumpToMonth(year, month))) return;

      // 在当前 groups 中找该月最上方的天（dayStats 降序 → 同月 day 最大那条排在最前）
      const monthGroups = groups.value.filter(g => g.year === year && g.month === month);
      if (monthGroups.length === 0) {
        // 月份在 dayStats 中不存在（可能 filter 下该月全被过滤），降级为滚到顶部
        if (scrollContainer.value) scrollContainer.value.scrollTop = 0;
        return;
      }
      const targetDayKey = monthGroups[0].id;

      // 一次加载"目标月整月 + 前后 1 个月"，避免"先 1 天 → 再 ±5 天缓冲"的多阶段重算
      const prevMonth = month === 0 ? 11 : month - 1;
      const prevYear = month === 0 ? year - 1 : year;
      const nextMonth = month === 11 ? 0 : month + 1;
      const nextYear = month === 11 ? year + 1 : year;
      const keysToLoad = groups.value
        .filter(g =>
          (g.year === year && g.month === month) ||
          (g.year === prevYear && g.month === prevMonth) ||
          (g.year === nextYear && g.month === nextMonth),
        )
        .map(g => g.id);
      await ensureDaysLoaded(keysToLoad);

      // 顺序至关重要：watch(groups) 是 flush:'pre'，必须先等 nextTick 让它 fire（启动 recalculateLayoutAsync），
      // 再 waitLayoutSettled 等 rIC 跑完拿到新 layoutResult，最后再 nextTick 等 spacer DOM 高度同步。
      // 否则 layoutResult 仍是 OLD（skeleton 估算），scrollTop 会落到错误位置。
      await nextTick();
      await waitLayoutSettled();
      await nextTick();

      if (scrollContainer.value) {
        const targetLayout = layoutResult.value?.groupLayouts.find(gl => gl.groupId === targetDayKey);
        const targetTop = targetLayout ? targetLayout.headerY : 0;
        scrollContainer.value.scrollTop = targetTop;
        // 二次兜底：若上一步被 clamp（极少数情况 spacer 仍未到位），读回实际值后重试一次
        if (Math.abs(scrollContainer.value.scrollTop - targetTop) > 1) {
          await nextTick();
          if (scrollContainer.value) scrollContainer.value.scrollTop = targetTop;
        }
      }
    } finally {
      forceUpdateVisibleArea();
      forceHideSkeleton();
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

  async function handleDragScroll(progress: number, source: 'click' | 'drag' | 'wheel' = 'drag'): Promise<void> {
    const wasDragging = isDragging;
    const jumpDistance = Math.abs(progress - scrollProgress.value);

    // 仅在“点击跳转”时提供短时骨架过渡；拖拽/滚轮保持实时跟手，不额外闪烁。
    if (source === 'click' && !wasDragging && jumpDistance >= QUICK_JUMP_SKELETON_THRESHOLD) {
      await ensureSkeletonVisible();
    }

    isDragging = true;
    setLastStableProgress(progress);

    if (dragEndTimer) clearTimeout(dragEndTimer);
    dragEndTimer = window.setTimeout(() => {
      isDragging = false;
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
