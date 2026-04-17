/**
 * 滚动速度检测模块
 * 负责滚动速度计算、displayMode 三阶段切换（fast/placeholder/full）
 */

import { ref, computed, type Ref } from 'vue';
import type { VirtualTimelineOptions, FastModeItem } from './types';
import { DEFAULT_OPTIONS } from './types';
import type { TimelineLayoutResult } from '../../utils/justifiedLayout';

/**
 * 滚动速度检测 Composable
 *
 * @param scrollTop 滚动位置 ref
 * @param viewportHeight 视口高度 ref
 * @param containerWidth 容器宽度 ref
 * @param layoutResult 布局结果 ref
 * @param visibleRowRange 可见行范围 computed
 * @param groups 分组数据 ref（用于降级网格计算）
 * @param options 配置选项
 */
export function useScrollVelocity(
  scrollTop: Ref<number>,
  viewportHeight: Ref<number>,
  containerWidth: Ref<number>,
  layoutResult: Ref<TimelineLayoutResult | null>,
  visibleRowRange: Ref<[number, number]>,
  groups: Ref<{ items: { id: string }[] }[]>,
  options: Required<VirtualTimelineOptions> = DEFAULT_OPTIONS
) {
  const config = options;

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

  /** 滚动方向 */
  const scrollDirection = ref<'up' | 'down' | null>(null);

  /** 上次滚动位置（用于方向判断） */
  let lastScrollTopForDirection = 0;

  /** 快速模式的占位符尺寸 */
  const FAST_MODE_ITEM_SIZE = 160;

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

    // 检测滚动方向
    if (scrollTop.value > lastScrollTopForDirection + 5) {
      scrollDirection.value = 'down';
    } else if (scrollTop.value < lastScrollTopForDirection - 5) {
      scrollDirection.value = 'up';
    }
    lastScrollTopForDirection = scrollTop.value;

    // 计算速度（像素/毫秒）
    scrollVelocity.value = deltaTime > 0 ? deltaScroll / deltaTime : 0;

    lastScrollTopForVelocity = scrollTop.value;
    lastScrollTime = now;

    // 更新显示模式
    if (scrollVelocity.value > FAST_SCROLL_THRESHOLD) {
      displayMode.value = 'fast';
      // 兜底恢复：即使没有后续低速 scroll 事件，也要在最后一次高速事件后回到 normal
      startModeRecovery();
    } else if (displayMode.value === 'fast') {
      // 延迟恢复到正常模式
      startModeRecovery();
    }
  }

  /**
   * 快速模式下的可见占位符
   * 基于实际 Justified Layout 结果生成，确保占位符位置与真实图片一致
   */
  const fastModeItems = computed<FastModeItem[]>(() => {
    if (displayMode.value !== 'fast') return [];

    // 如果有布局结果，使用实际布局位置（更精确）
    if (layoutResult.value && layoutResult.value.allRows.length > 0) {
      const [startIndex, endIndex] = visibleRowRange.value;
      const result: FastModeItem[] = [];

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

    const result: FastModeItem[] = [];

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
   * 重置速度检测状态
   */
  function resetVelocity() {
    lastScrollTopForVelocity = scrollTop.value;
    lastScrollTime = performance.now();
    scrollVelocity.value = 0;
  }

  /**
   * 强制设置 fast 模式（用于拖拽滚动）
   */
  function forceFastMode() {
    displayMode.value = 'fast';
    // 与 updateScrollVelocity 保持一致：无后续事件时也能自动恢复，避免卡死在 fast
    startModeRecovery();
  }

  /**
   * 强制立即恢复 normal 模式（用于跳转/拖拽结束）
   * 不走 startModeRecovery 的 200ms 延迟 —— 那个延迟容易被 useScrollAnchor 修正
   * scrollTop 引发的次级 scroll 事件误判为"高速滚动"重置回 fast，导致图片永不加载。
   */
  function forceNormalMode() {
    if (modeRecoveryTimer) {
      clearTimeout(modeRecoveryTimer);
      modeRecoveryTimer = null;
    }
    displayMode.value = 'normal';
    // 同步重置速度采样，避免下一次 scroll 事件用旧 lastScrollTop 算出虚假高速
    lastScrollTopForVelocity = scrollTop.value;
    lastScrollTime = performance.now();
    scrollVelocity.value = 0;
  }

  /**
   * 清理定时器
   */
  function cleanup() {
    if (modeRecoveryTimer !== null) {
      clearTimeout(modeRecoveryTimer);
      modeRecoveryTimer = null;
    }
  }

  return {
    scrollVelocity,
    displayMode,
    scrollDirection,
    fastModeItems,
    updateScrollVelocity,
    startModeRecovery,
    resetVelocity,
    forceFastMode,
    forceNormalMode,
    cleanup,
  };
}
