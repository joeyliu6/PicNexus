/**
 * 虚拟时间轴 Composable
 * 管理 Justified Layout 的虚拟滚动，支持大量图片流畅浏览
 *
 * 拆分为 3 个子模块：
 * - useTimelineLayout: 布局计算（toLayoutItems、calculateFullLayout、recalculateLayoutAsync）
 * - useVisibleArea: 可见区域计算（visibleRowRange、visibleItems、visibleHeaders）
 * - useScrollVelocity: 滚动速度检测与三阶段渲染切换
 */

import { ref, watch, onMounted, onUnmounted, nextTick, type Ref } from 'vue';
import { findGroupScrollPosition } from '../utils/justifiedLayout';
import type {
  LayoutItem,
  TimelineLayoutResult,
  TimelineLayoutOptions,
  LayoutRow,
  TimelineGroupLayout,
} from '../utils/justifiedLayout';

// 子模块
import { useTimelineLayout } from './timeline/useTimelineLayout';
import { useVisibleArea } from './timeline/useVisibleArea';
import { useScrollVelocity } from './timeline/useScrollVelocity';

// 类型从 types 文件重导出，保持原有导出接口不变
import { DEFAULT_OPTIONS } from './timeline/types';
import type {
  PhotoGroup,
  VisibleItem,
  VisibleHeader,
  VirtualTimelineOptions,
  FastModeItem,
} from './timeline/types';

export type {
  PhotoGroup,
  VisibleItem,
  VisibleHeader,
  VirtualTimelineOptions,
  FastModeItem,
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

  /** 滚动位置恢复中标志（抑制 ResizeObserver 干扰） */
  let isRestoring = false;

  // ==================== 子模块组合 ====================

  const {
    layoutResult,
    isCalculating,
    calculateFullLayout,
    recalculateLayoutAsync,
    suspendLayout,
    resumeLayout,
    updateGroup,
  } = useTimelineLayout(containerWidth, groups, config);

  const {
    visibleRowRange,
    visibleItems,
    visibleHeaders,
    currentStickyHeader,
    totalHeight,
    scrollProgress,
    visibleDayKeys,
  } = useVisibleArea(scrollTop, viewportHeight, layoutResult, groups, containerRef, config);

  const {
    scrollVelocity,
    displayMode,
    scrollDirection,
    fastModeItems,
    updateScrollVelocity,
    startModeRecovery,
    resetVelocity,
    forceFastMode,
    cleanup: cleanupVelocity,
  } = useScrollVelocity(scrollTop, viewportHeight, containerWidth, layoutResult, visibleRowRange, groups, config);

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
   * @param instant 是否立即滚动（跳过动画，强制 fast 模式）
   */
  function scrollToProgress(progress: number, instant: boolean = false) {
    if (!containerRef.value) return;

    const maxScroll = totalHeight.value - viewportHeight.value;
    const targetY = maxScroll * Math.min(1, Math.max(0, progress));
    containerRef.value.scrollTop = targetY;
    scrollTop.value = targetY;

    if (instant) {
      forceFastMode();
    } else {
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

    // 检查 containerWidth 是否过时（从 display:none 恢复时仍为 0）
    // 使用内容宽度（减去 padding），与 ResizeObserver 的 contentRect.width 一致
    const style = getComputedStyle(containerRef.value);
    const currentWidth = containerRef.value.clientWidth
      - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (currentWidth > 0 && Math.abs(currentWidth - containerWidth.value) > 1) {
      containerWidth.value = currentWidth;
      const result = calculateFullLayout();
      if (result) {
        layoutResult.value = result;
        isCalculating.value = false;
      }
    }

    // 重置速度检测状态
    resetVelocity();

    // 延迟切换到 normal 模式
    startModeRecovery();
  }

  /**
   * 恢复滚动位置（由调用者指定目标位置，不从 DOM 读取）
   * 用于 KeepAlive/Tab 切换后的位置恢复，避免 forceUpdateVisibleArea 读取 DOM scrollTop=0 的竞态
   */
  async function restoreScrollTop(targetScrollTop: number) {
    if (!containerRef.value) return;
    isRestoring = true;

    const style = getComputedStyle(containerRef.value);
    const currentWidth = containerRef.value.clientWidth
      - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (currentWidth > 0 && Math.abs(currentWidth - containerWidth.value) > 1) {
      containerWidth.value = currentWidth;
      const result = calculateFullLayout();
      if (result) {
        layoutResult.value = result;
        isCalculating.value = false;
      }
    }

    viewportHeight.value = containerRef.value.clientHeight;

    // 等 Vue flush layoutResult → DOM spacer 高度更新，再设置 scrollTop
    // 否则 spacer 为 0 时 scrollTop 会被浏览器 clamp 到 0
    await nextTick();

    if (!containerRef.value) {
      isRestoring = false;
      return;
    }

    containerRef.value.scrollTop = targetScrollTop;
    // ⚠️ 读回 DOM 实际 scrollTop —— 若 spacer 尚未就绪，浏览器会 clamp 到可达最大值，
    // 不能用 targetScrollTop 强写 scrollTop.value，否则 visibleItems 会被欺骗去渲染不可见区域
    scrollTop.value = containerRef.value.scrollTop;

    resetVelocity();
    startModeRecovery();

    requestAnimationFrame(() => { isRestoring = false; });
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

      if (isRestoring) return;

      const newWidth = entry.contentRect.width;
      const newHeight = entry.contentRect.height;

      // 容器被隐藏/分离时宽度为 0，跳过以保留正确的布局状态
      if (newWidth === 0) return;

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

    // 清理滚动速度定时器
    cleanupVelocity();
  });

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
    scrollDirection,

    // 可见数据
    visibleItems,
    visibleHeaders,
    currentStickyHeader,
    visibleRowRange,
    visibleDayKeys,

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
    restoreScrollTop,
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
