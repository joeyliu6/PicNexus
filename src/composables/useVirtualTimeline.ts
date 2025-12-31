/**
 * 虚拟时间轴 Composable
 * 管理 Justified Layout 的虚拟滚动，支持大量图片流畅浏览
 */

import { ref, computed, watch, shallowRef, onMounted, onUnmounted, type Ref } from 'vue';
import {
  calculateTimelineLayout,
  getVisibleRowRange,
  getCurrentStickyHeader,
  findGroupScrollPosition,
  updateGroupLayout,
  type LayoutItem,
  type TimelineLayoutResult,
  type TimelineLayoutOptions,
  type LayoutRow,
  type TimelineGroupLayout,
} from '../utils/justifiedLayout';
import type { HistoryItem } from '../config/types';

// ==================== 类型定义 ====================

/** 图片分组 */
export interface PhotoGroup {
  /** 分组 ID（如 '2024-5-15'） */
  id: string;
  /** 分组标签（如 '2024年5月15日'） */
  label: string;
  /** 年份 */
  year: number;
  /** 月份 (0-11) */
  month: number;
  /** 日期 */
  day: number;
  /** 日期对象 */
  date: Date;
  /** 该分组的图片 */
  items: HistoryItem[];
}

/** 可见图片项（用于渲染） */
export interface VisibleItem {
  /** 图片数据 */
  item: HistoryItem;
  /** x 坐标 */
  x: number;
  /** y 坐标 */
  y: number;
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
  /** 所属分组 ID */
  groupId: string;
}

/** 可见分组头部 */
export interface VisibleHeader {
  /** 分组 ID */
  groupId: string;
  /** 分组标签 */
  label: string;
  /** y 坐标 */
  y: number;
  /** 高度 */
  height: number;
}

/** 虚拟时间轴配置 */
export interface VirtualTimelineOptions {
  /** 目标行高 */
  targetRowHeight?: number;
  /** 图片间距 */
  gap?: number;
  /** 分组头部高度 */
  headerHeight?: number;
  /** 分组间距 */
  groupGap?: number;
  /** 最大行高 */
  maxRowHeight?: number;
  /** 可视区域上下额外渲染的行数 */
  overscan?: number;
}

// ==================== 默认配置 ====================

const DEFAULT_OPTIONS: Required<VirtualTimelineOptions> = {
  targetRowHeight: 200,
  gap: 4,
  headerHeight: 48,
  groupGap: 24,
  maxRowHeight: 300,
  overscan: 3,
};

// ==================== 主 Composable ====================

/**
 * 虚拟时间轴 Composable
 *
 * @param containerRef 滚动容器的 ref
 * @param groups 图片分组数据
 * @param options 配置选项
 */
export function useVirtualTimeline(
  containerRef: Ref<HTMLElement | null>,
  groups: Ref<PhotoGroup[]>,
  options: VirtualTimelineOptions = {}
) {
  // 合并配置
  const config = { ...DEFAULT_OPTIONS, ...options };

  // ==================== 响应式状态 ====================

  /** 容器宽度 */
  const containerWidth = ref(0);

  /** 滚动位置 */
  const scrollTop = ref(0);

  /** 视口高度 */
  const viewportHeight = ref(0);

  /** 布局结果缓存 */
  const layoutResult = shallowRef<TimelineLayoutResult | null>(null);

  /** 布局计算中标志 */
  const isCalculating = ref(false);

  /** 布局暂停标志（用于批量更新） */
  const isLayoutSuspended = ref(false);

  /** 需要重算的脏标志 */
  const layoutDirty = ref(false);

  // ==================== 滚动速度检测（三阶段渲染） ====================

  /** 滚动速度（像素/毫秒） */
  const scrollVelocity = ref(0);

  /** 上次滚动位置 */
  let lastScrollTopForVelocity = 0;

  /** 上次滚动时间 */
  let lastScrollTime = 0;

  /** 快速滚动阈值（像素/毫秒） */
  const FAST_SCROLL_THRESHOLD = 2;

  /** 显示模式：fast=快速滚动正方形网格，normal=Justified Layout */
  const displayMode = ref<'fast' | 'normal'>('normal');

  /** 模式恢复定时器 */
  let modeRecoveryTimer: number | null = null;

  // ==================== 布局计算 ====================

  /**
   * 将 HistoryItem 转换为 LayoutItem
   */
  function toLayoutItems(items: HistoryItem[]): LayoutItem[] {
    return items.map((item) => ({
      id: item.id,
      // 如果没有宽高比，默认为 1（正方形）
      aspectRatio: item.aspectRatio && item.aspectRatio > 0 ? item.aspectRatio : 1,
    }));
  }

  /**
   * 计算完整布局
   */
  function calculateFullLayout(): TimelineLayoutResult | null {
    if (containerWidth.value <= 0 || groups.value.length === 0) {
      return null;
    }

    const layoutOptions: TimelineLayoutOptions = {
      containerWidth: containerWidth.value,
      targetRowHeight: config.targetRowHeight,
      gap: config.gap,
      headerHeight: config.headerHeight,
      groupGap: config.groupGap,
      maxRowHeight: config.maxRowHeight,
      lastRowBehavior: 'left',
    };

    const groupData = groups.value.map((group) => ({
      id: group.id,
      label: group.label,
      items: toLayoutItems(group.items),
    }));

    return calculateTimelineLayout(groupData, layoutOptions);
  }

  /**
   * 异步重算布局（使用 requestIdleCallback 避免阻塞 UI）
   */
  function recalculateLayoutAsync() {
    if (isLayoutSuspended.value) {
      layoutDirty.value = true;
      return;
    }

    isCalculating.value = true;

    // 使用 requestIdleCallback 在空闲时计算，降低 UI 阻塞
    const callback = () => {
      const result = calculateFullLayout();
      layoutResult.value = result;
      isCalculating.value = false;
      layoutDirty.value = false;
    };

    if ('requestIdleCallback' in window) {
      requestIdleCallback(callback, { timeout: 100 });
    } else {
      // 降级方案
      setTimeout(callback, 0);
    }
  }

  /**
   * 暂停布局更新（用于批量操作）
   */
  function suspendLayout() {
    isLayoutSuspended.value = true;
  }

  /**
   * 恢复布局更新
   */
  function resumeLayout() {
    isLayoutSuspended.value = false;
    if (layoutDirty.value) {
      recalculateLayoutAsync();
    }
  }

  // ==================== 可见区域计算 ====================

  /** 可见行范围 */
  const visibleRowRange = computed<[number, number]>(() => {
    if (!layoutResult.value || layoutResult.value.allRows.length === 0) {
      return [0, 0];
    }

    return getVisibleRowRange(
      layoutResult.value.allRows,
      scrollTop.value,
      viewportHeight.value,
      config.overscan
    );
  });

  /** 可见的图片列表 */
  const visibleItems = computed<VisibleItem[]>(() => {
    if (!layoutResult.value) return [];

    const [startIndex, endIndex] = visibleRowRange.value;
    const result: VisibleItem[] = [];

    // 构建 id -> HistoryItem 的映射，用于快速查找
    const itemMap = new Map<string, HistoryItem>();
    for (const group of groups.value) {
      for (const item of group.items) {
        itemMap.set(item.id, item);
      }
    }

    // 收集可见行的所有图片
    for (let i = startIndex; i < endIndex; i++) {
      const rowData = layoutResult.value.allRows[i];
      if (!rowData) continue;

      for (const layoutItem of rowData.row.items) {
        const historyItem = itemMap.get(layoutItem.id);
        if (historyItem) {
          result.push({
            item: historyItem,
            x: layoutItem.x,
            y: layoutItem.y,
            width: layoutItem.width,
            height: layoutItem.height,
            groupId: rowData.groupId,
          });
        }
      }
    }

    return result;
  });

  /** 可见的分组头部 */
  const visibleHeaders = computed<VisibleHeader[]>(() => {
    if (!layoutResult.value) return [];

    const viewTop = scrollTop.value - config.headerHeight; // 提前一个头部高度开始
    const viewBottom = scrollTop.value + viewportHeight.value + config.headerHeight;

    const result: VisibleHeader[] = [];

    for (const group of layoutResult.value.groupLayouts) {
      // 头部在可见范围内
      if (group.headerY < viewBottom && group.headerY + group.headerHeight > viewTop) {
        result.push({
          groupId: group.groupId,
          label: group.label,
          y: group.headerY,
          height: group.headerHeight,
        });
      }

      // 内容区域在可见范围内（确保头部也显示）
      const contentEnd = group.contentY + group.contentHeight;
      if (group.contentY < viewBottom && contentEnd > viewTop) {
        // 头部可能已添加，检查是否重复
        if (!result.find((h) => h.groupId === group.groupId)) {
          result.push({
            groupId: group.groupId,
            label: group.label,
            y: group.headerY,
            height: group.headerHeight,
          });
        }
      }
    }

    return result;
  });

  /** 当前粘性头部 */
  const currentStickyHeader = computed(() => {
    if (!layoutResult.value) return null;
    return getCurrentStickyHeader(layoutResult.value.groupLayouts, scrollTop.value);
  });

  /** 总高度（用于滚动容器） */
  const totalHeight = computed(() => layoutResult.value?.totalHeight || 0);

  /** 滚动进度 (0-1) */
  const scrollProgress = computed(() => {
    if (!containerRef.value || totalHeight.value <= viewportHeight.value) {
      return 0;
    }
    const maxScroll = totalHeight.value - viewportHeight.value;
    return Math.min(1, Math.max(0, scrollTop.value / maxScroll));
  });

  // ==================== 快速模式布局（三阶段渲染） ====================

  /** 快速模式的占位符尺寸 */
  const FAST_MODE_ITEM_SIZE = 160;

  /**
   * 快速模式下的可见占位符
   * 基于实际 Justified Layout 结果生成，确保占位符位置与真实图片一致
   */
  const fastModeItems = computed(() => {
    if (displayMode.value !== 'fast') return [];

    // 如果有布局结果，使用实际布局位置（更精确）
    if (layoutResult.value && layoutResult.value.allRows.length > 0) {
      const [startIndex, endIndex] = visibleRowRange.value;
      const result: Array<{ x: number; y: number; width: number; height: number }> = [];

      for (let i = startIndex; i < endIndex; i++) {
        const rowData = layoutResult.value.allRows[i];
        if (!rowData) continue;

        for (const item of rowData.row.items) {
          result.push({
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
          });
        }
      }

      return result;
    }

    // 降级方案：如果没有布局结果，使用简单网格
    const itemSize = FAST_MODE_ITEM_SIZE;
    const gap = config.gap;
    const columns = Math.floor((containerWidth.value + gap) / (itemSize + gap));
    if (columns <= 0) return [];

    const totalItems = groups.value.reduce((sum, g) => sum + g.items.length, 0);
    if (totalItems === 0) return [];

    const rowHeight = itemSize + gap;
    const startRow = Math.floor(scrollTop.value / rowHeight);
    const endRow = Math.ceil((scrollTop.value + viewportHeight.value) / rowHeight);

    const overscan = config.overscan;
    const safeStartRow = Math.max(0, startRow - overscan);
    const totalRows = Math.ceil(totalItems / columns);
    const safeEndRow = Math.min(totalRows, endRow + overscan);

    const result: Array<{ x: number; y: number; width: number; height: number }> = [];

    for (let row = safeStartRow; row < safeEndRow; row++) {
      for (let col = 0; col < columns; col++) {
        const index = row * columns + col;
        if (index >= totalItems) break;

        result.push({
          x: col * (itemSize + gap),
          y: row * rowHeight,
          width: itemSize,
          height: itemSize,
        });
      }
    }

    return result;
  });

  /**
   * 启动模式恢复（从 fast 切换回 normal）
   */
  function startModeRecovery() {
    if (displayMode.value === 'fast') {
      if (modeRecoveryTimer) {
        clearTimeout(modeRecoveryTimer);
      }
      modeRecoveryTimer = window.setTimeout(() => {
        displayMode.value = 'normal';
        modeRecoveryTimer = null;
      }, 200);
    }
  }

  /**
   * 更新滚动速度并切换显示模式
   */
  function updateScrollVelocity() {
    const now = performance.now();
    const deltaTime = now - lastScrollTime;
    const deltaScroll = Math.abs(scrollTop.value - lastScrollTopForVelocity);

    // 计算速度（像素/毫秒）
    scrollVelocity.value = deltaTime > 0 ? deltaScroll / deltaTime : 0;

    lastScrollTopForVelocity = scrollTop.value;
    lastScrollTime = now;

    // 更新显示模式
    if (scrollVelocity.value > FAST_SCROLL_THRESHOLD) {
      displayMode.value = 'fast';
      // 清除恢复定时器
      if (modeRecoveryTimer) {
        clearTimeout(modeRecoveryTimer);
        modeRecoveryTimer = null;
      }
    } else if (displayMode.value === 'fast') {
      // 延迟恢复到正常模式
      startModeRecovery();
    }
  }

  // ==================== 滚动处理 ====================

  let rafId: number | null = null;

  /**
   * 滚动事件处理（使用 RAF 节流）
   */
  function handleScroll() {
    if (rafId !== null) return;

    rafId = requestAnimationFrame(() => {
      rafId = null;

      if (!containerRef.value) return;

      scrollTop.value = containerRef.value.scrollTop;
      viewportHeight.value = containerRef.value.clientHeight;

      // 更新滚动速度，用于三阶段渲染模式切换
      updateScrollVelocity();
    });
  }

  /**
   * 滚动到指定位置
   */
  function scrollTo(y: number, behavior: ScrollBehavior = 'auto') {
    if (!containerRef.value) return;
    containerRef.value.scrollTo({ top: y, behavior });
  }

  /**
   * 滚动到指定分组
   */
  function scrollToGroup(groupId: string, behavior: ScrollBehavior = 'smooth') {
    if (!layoutResult.value) return;

    const y = findGroupScrollPosition(layoutResult.value.groupLayouts, groupId);
    if (y !== null) {
      scrollTo(y, behavior);
    }
  }

  /**
   * 滚动到指定图片
   */
  function scrollToItem(itemId: string, behavior: ScrollBehavior = 'smooth') {
    if (!layoutResult.value) return;

    const position = layoutResult.value.itemPositionMap.get(itemId);
    if (position) {
      // 滚动到图片位置，居中显示
      const targetY = position.y - viewportHeight.value / 2 + position.height / 2;
      scrollTo(Math.max(0, targetY), behavior);
    }
  }

  /**
   * 根据进度滚动（用于时间轴拖拽）
   * @param progress 滚动进度 0-1
   * @param isDragging 是否正在拖拽（用于决定显示模式）
   */
  function scrollToProgress(progress: number, isDragging: boolean = false) {
    if (!containerRef.value) return;

    const maxScroll = totalHeight.value - viewportHeight.value;
    const targetY = maxScroll * Math.min(1, Math.max(0, progress));
    containerRef.value.scrollTop = targetY;
    scrollTop.value = targetY;

    // 拖拽期间强制使用 fast 模式
    if (isDragging) {
      displayMode.value = 'fast';
      // 清除恢复定时器
      if (modeRecoveryTimer) {
        clearTimeout(modeRecoveryTimer);
        modeRecoveryTimer = null;
      }
    } else {
      // 非拖拽（拖拽结束），延迟恢复到 normal 模式
      startModeRecovery();
    }
  }

  /**
   * 强制更新可见区域（拖拽结束后调用）
   */
  function forceUpdateVisibleArea() {
    if (!containerRef.value) return;

    scrollTop.value = containerRef.value.scrollTop;
    viewportHeight.value = containerRef.value.clientHeight;

    // 重置速度检测状态
    lastScrollTopForVelocity = scrollTop.value;
    lastScrollTime = performance.now();
    scrollVelocity.value = 0;

    // 延迟切换到 normal 模式
    startModeRecovery();
  }

  // ==================== 容器尺寸监听 ====================

  let resizeObserver: ResizeObserver | null = null;
  let resizeDebounceTimer: number | null = null;
  let isFirstResize = true;

  function setupResizeObserver() {
    if (!containerRef.value) return;

    // 重置首次标志
    isFirstResize = true;

    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const newWidth = entry.contentRect.width;
      const newHeight = entry.contentRect.height;

      // 首次回调立即执行，避免初始化时的布局跳跃
      if (isFirstResize) {
        isFirstResize = false;
        containerWidth.value = newWidth;
        viewportHeight.value = newHeight;
        recalculateLayoutAsync();
        return;
      }

      // 后续回调使用防抖
      if (resizeDebounceTimer) {
        clearTimeout(resizeDebounceTimer);
      }

      resizeDebounceTimer = window.setTimeout(() => {
        if (Math.abs(newWidth - containerWidth.value) > 1) {
          containerWidth.value = newWidth;
          // 宽度变化需要重算布局
          recalculateLayoutAsync();
        }
        viewportHeight.value = newHeight;
      }, 200);
    });

    resizeObserver.observe(containerRef.value);
  }

  function cleanupResizeObserver() {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (resizeDebounceTimer) {
      clearTimeout(resizeDebounceTimer);
      resizeDebounceTimer = null;
    }
  }

  // ==================== 增量更新 ====================

  /**
   * 增量更新分组（用于上传/删除图片时局部重算）
   */
  function updateGroup(groupId: string, newItems: HistoryItem[]) {
    if (!layoutResult.value) {
      // 没有布局，执行完整计算
      recalculateLayoutAsync();
      return;
    }

    const layoutOptions: TimelineLayoutOptions = {
      containerWidth: containerWidth.value,
      targetRowHeight: config.targetRowHeight,
      gap: config.gap,
      headerHeight: config.headerHeight,
      groupGap: config.groupGap,
      maxRowHeight: config.maxRowHeight,
      lastRowBehavior: 'left',
    };

    const newLayout = updateGroupLayout(
      layoutResult.value,
      groupId,
      toLayoutItems(newItems),
      layoutOptions
    );

    layoutResult.value = newLayout;
  }

  // ==================== 生命周期 ====================

  onMounted(() => {
    setupResizeObserver();

    // 监听滚动事件
    if (containerRef.value) {
      containerRef.value.addEventListener('scroll', handleScroll, { passive: true });
    }
  });

  onUnmounted(() => {
    cleanupResizeObserver();

    if (containerRef.value) {
      containerRef.value.removeEventListener('scroll', handleScroll);
    }

    if (rafId !== null) {
      cancelAnimationFrame(rafId);
    }

    // 清理模式恢复定时器
    if (modeRecoveryTimer !== null) {
      clearTimeout(modeRecoveryTimer);
      modeRecoveryTimer = null;
    }
  });

  // 监听 groups 变化，重算布局
  watch(
    groups,
    () => {
      recalculateLayoutAsync();
    },
    { deep: false } // 浅监听，只在引用变化时触发
  );

  // 监听 containerRef 变化（可能延迟挂载）
  watch(containerRef, (newRef, oldRef) => {
    if (oldRef) {
      oldRef.removeEventListener('scroll', handleScroll);
    }

    cleanupResizeObserver();

    if (newRef) {
      newRef.addEventListener('scroll', handleScroll, { passive: true });
      setupResizeObserver();
      recalculateLayoutAsync();
    }
  });

  // ==================== 返回值 ====================

  return {
    // 状态
    containerWidth,
    scrollTop,
    viewportHeight,
    totalHeight,
    scrollProgress,
    isCalculating,

    // 三阶段渲染状态
    displayMode,
    scrollVelocity,

    // 可见数据
    visibleItems,
    visibleHeaders,
    currentStickyHeader,
    visibleRowRange,

    // 快速模式可见数据
    fastModeItems,

    // 布局数据（用于高级用途）
    layoutResult,

    // 方法
    scrollTo,
    scrollToGroup,
    scrollToItem,
    scrollToProgress,
    forceUpdateVisibleArea,
    recalculateLayout: recalculateLayoutAsync,
    suspendLayout,
    resumeLayout,
    updateGroup,

    // 处理函数（暴露给外部绑定）
    handleScroll,
  };
}

// ==================== 辅助类型导出 ====================

export type {
  LayoutItem,
  TimelineLayoutResult,
  TimelineLayoutOptions,
  LayoutRow,
  TimelineGroupLayout,
};
