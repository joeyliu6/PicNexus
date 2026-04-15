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
  /** 跳转到月份（加载数据） */
  jumpToMonth: (year: number, month: number) => Promise<boolean>;
}

export function useTimelineDragAndSkeleton(options: UseTimelineDragAndSkeletonOptions) {
  const {
    scrollContainer, groups, isCalculating, visible,
    totalHeight, viewportHeight, layoutResult, timePeriodStats,
    setLastStableProgress, scrollToProgress, scrollToItem,
    forceUpdateVisibleArea, jumpToMonth,
  } = options;

  // ==================== 状态 ====================

  const showSkeleton = ref(false);
  let isDragging = false;
  let dragEndTimer: number | undefined;
  let skeletonMinDisplayTimeout: number | undefined;

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

  /** 跳转到未加载的月份 */
  async function handleJumpToPeriod(year: number, month: number): Promise<void> {
    const success = await jumpToMonth(year, month);
    if (success) {
      await nextTick();
      if (scrollContainer.value) {
        scrollContainer.value.scrollTop = 0;
      }
      forceUpdateVisibleArea();
    }
  }

  /** 跳转到指定年份 */
  async function handleJumpToYear(year: number): Promise<void> {
    const yearGroups = groups.value.filter(g => g.year === year);

    if (yearGroups.length > 0) {
      const firstGroup = yearGroups[yearGroups.length - 1];
      if (firstGroup.items.length > 0) {
        scrollToItem(firstGroup.items[0].id);
      }
    } else {
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
    if (skeletonMinDisplayTimeout) {
      clearTimeout(skeletonMinDisplayTimeout);
    }
    if (!showSkeleton.value) return;
    skeletonMinDisplayTimeout = window.setTimeout(() => {
      showSkeleton.value = false;
    }, SKELETON_MIN_DISPLAY_MS);
  }

  function showSkeletonWithCheck(): void {
    showSkeleton.value = true;
    nextTick(() => {
      if (!isCalculating.value) {
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
      if (!calculating && showSkeleton.value) {
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

  function handleDragScroll(progress: number): void {
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
