/**
 * 时间轴布局计算模块
 * 负责 toLayoutItems、calculateFullLayout、recalculateLayoutAsync 等布局相关逻辑
 */

import { ref, shallowRef, watch, type Ref } from 'vue';
import {
  calculateTimelineLayout,
  updateGroupLayout,
  type LayoutItem,
  type TimelineLayoutResult,
  type TimelineLayoutOptions,
} from '../../utils/justifiedLayout';
import type { ImageMeta } from '../../types/image-meta';
import type { PhotoGroup, VirtualTimelineOptions } from './types';
import { DEFAULT_OPTIONS } from './types';

/**
 * 时间轴布局计算 Composable
 *
 * @param containerWidth 容器宽度 ref
 * @param groups 图片分组数据
 * @param options 配置选项
 */
export function useTimelineLayout(
  containerWidth: Ref<number>,
  groups: Ref<PhotoGroup[]>,
  options: Required<VirtualTimelineOptions> = DEFAULT_OPTIONS
) {
  const config = options;

  /** 布局结果缓存 */
  const layoutResult = shallowRef<TimelineLayoutResult | null>(null);

  /** 布局计算中标志 */
  const isCalculating = ref(false);

  /** 布局暂停标志（用于批量更新） */
  const isLayoutSuspended = ref(false);

  /** 需要重算的脏标志 */
  const layoutDirty = ref(false);

  /**
   * 将 ImageMeta 转换为 LayoutItem
   */
  function toLayoutItems(items: ImageMeta[]): LayoutItem[] {
    return items.map((meta) => ({
      id: meta.id,
      // 如果没有宽高比，默认为 1（正方形）
      aspectRatio: meta.aspectRatio && meta.aspectRatio > 0 ? meta.aspectRatio : 1,
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

  /**
   * 增量更新分组（用于上传/删除图片时局部重算）
   */
  function updateGroup(groupId: string, newItems: ImageMeta[]) {
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

  // 监听 groups 变化，重算布局
  watch(
    groups,
    () => {
      recalculateLayoutAsync();
    },
    { deep: false } // 浅监听，只在引用变化时触发
  );

  return {
    layoutResult,
    isCalculating,
    calculateFullLayout,
    recalculateLayoutAsync,
    suspendLayout,
    resumeLayout,
    updateGroup,
  };
}
