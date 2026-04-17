/**
 * 时间轴布局计算模块
 * 负责 calculateFullLayout、recalculateLayoutAsync、updateGroup 等布局相关逻辑
 *
 * 支持 skeleton/real 混合模式：
 * - skeleton group（isSkeleton=true）：用 expectedCount × avgCellHeight 做粗糙占位高度
 * - real group：走完整 justifiedLayout 计算
 */

import { ref, shallowRef, watch, type Ref } from 'vue';
import {
  calculateJustifiedLayout,
  updateGroupLayout,
  type LayoutItem,
  type TimelineLayoutResult,
  type TimelineLayoutOptions,
  type TimelineGroupLayout,
} from '../../utils/justifiedLayout';
import type { ImageMeta } from '../../types/image-meta';
import type { PhotoGroup, VirtualTimelineOptions } from './types';
import { DEFAULT_OPTIONS } from './types';

/** skeleton 模式下每张图片的初始估算高度（targetRowHeight + gap） */
const DEFAULT_AVG_CELL_HEIGHT = 209;

export function useTimelineLayout(
  containerWidth: Ref<number>,
  groups: Ref<PhotoGroup[]>,
  options: Required<VirtualTimelineOptions> = DEFAULT_OPTIONS,
  /** skeleton 天的估算行高（由 useTimelineDayPagination 或外部采样维护） */
  avgCellHeight: Ref<number> = ref(DEFAULT_AVG_CELL_HEIGHT),
) {
  const config = options;

  const layoutResult = shallowRef<TimelineLayoutResult | null>(null);
  const isCalculating = ref(false);
  const isLayoutSuspended = ref(false);
  const layoutDirty = ref(false);

  function toLayoutItems(items: ImageMeta[]): LayoutItem[] {
    return items.map((meta) => ({
      id: meta.id,
      aspectRatio: meta.aspectRatio && meta.aspectRatio > 0 ? meta.aspectRatio : 1,
    }));
  }

  /**
   * 计算完整布局（skeleton/real 混合）
   *
   * skeleton 天占位高度 = expectedCount × avgCellHeight，rows 为空。
   * real 天走正常 justifiedLayout。
   * 保证后续分组 Y 坐标连续累积。
   */
  function calculateFullLayout(): TimelineLayoutResult | null {
    if (containerWidth.value <= 0 || groups.value.length === 0) {
      return null;
    }

    const { headerHeight, groupGap, targetRowHeight, gap, maxRowHeight } = config;

    const layoutOptions: TimelineLayoutOptions = {
      containerWidth: containerWidth.value,
      targetRowHeight,
      gap,
      headerHeight,
      groupGap,
      maxRowHeight,
      lastRowBehavior: 'left',
    };

    const groupLayouts: TimelineGroupLayout[] = [];
    const itemPositionMap = new Map<string, { y: number; height: number; groupId: string }>();
    const allRows: Array<{ groupId: string; row: import('../../utils/justifiedLayout').LayoutRow; globalRowIndex: number }> = [];
    let currentY = 0;
    let globalRowIndex = 0;
    const cellH = avgCellHeight.value;

    for (const group of groups.value) {
      const headerY = currentY;
      currentY += headerHeight;

      if (group.isSkeleton || group.items.length === 0) {
        // skeleton 占位：粗糙估算高度，无行数据
        const expectedCount = group.expectedCount ?? group.items.length;
        const contentHeight = Math.max(expectedCount * cellH, 0);
        groupLayouts.push({
          groupId: group.id,
          label: group.label,
          headerY,
          headerHeight,
          contentY: headerY + headerHeight,
          contentHeight,
          rows: [],
          itemCount: expectedCount,
        });
        currentY += contentHeight + groupGap;
      } else {
        // real 布局
        const layoutItems = toLayoutItems(group.items);
        const groupLayout = calculateJustifiedLayout(layoutItems, layoutOptions);

        for (const row of groupLayout.rows) {
          row.y += currentY;
          for (const item of row.items) {
            item.y += currentY;
            itemPositionMap.set(item.id, { y: item.y, height: item.height, groupId: group.id });
          }
          allRows.push({ groupId: group.id, row, globalRowIndex: globalRowIndex++ });
        }

        groupLayouts.push({
          groupId: group.id,
          label: group.label,
          headerY,
          headerHeight,
          contentY: headerY + headerHeight,
          contentHeight: groupLayout.contentHeight,
          rows: groupLayout.rows,
          itemCount: group.items.length,
        });
        currentY += groupLayout.contentHeight + groupGap;
      }
    }

    const totalHeight = groups.value.length > 0 ? currentY - groupGap : 0;

    return { groupLayouts, totalHeight, itemPositionMap, allRows };
  }

  function recalculateLayoutAsync() {
    if (isLayoutSuspended.value) {
      layoutDirty.value = true;
      return;
    }

    isCalculating.value = true;

    const callback = () => {
      const result = calculateFullLayout();
      layoutResult.value = result;
      isCalculating.value = false;
      layoutDirty.value = false;
    };

    if ('requestIdleCallback' in window) {
      requestIdleCallback(callback, { timeout: 100 });
    } else {
      setTimeout(callback, 0);
    }
  }

  function suspendLayout() {
    isLayoutSuspended.value = true;
  }

  function resumeLayout() {
    isLayoutSuspended.value = false;
    if (layoutDirty.value) {
      recalculateLayoutAsync();
    }
  }

  /**
   * 增量更新分组（skeleton→real 切换时调用）
   * 内部使用 updateGroupLayout 做增量重算，自动修正后续分组 Y 坐标。
   */
  function updateGroup(groupId: string, newItems: ImageMeta[]) {
    if (!layoutResult.value) {
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
      layoutOptions,
    );

    layoutResult.value = newLayout;
  }

  watch(
    groups,
    () => {
      recalculateLayoutAsync();
    },
    { deep: false },
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
