/**
 * 时间轴布局计算模块
 * 负责 calculateFullLayout、recalculateLayoutAsync、updateGroup 等布局相关逻辑
 *
 * 支持 skeleton/real 混合模式：
 * - skeleton group（isSkeleton=true）：优先用"已加载天单图平均高度"×expectedCount 估算，
 *   无可用采样时退回列数推算；
 * - real group：走完整 justifiedLayout 计算。
 */

import { ref, shallowRef, watch, type Ref } from 'vue';
import {
  calculateJustifiedLayout,
  updateGroupLayout,
  type LayoutItem,
  type TimelineLayoutResult,
  type TimelineLayoutOptions,
  type TimelineGroupLayout,
  type GroupLayoutResult,
} from '../../utils/justifiedLayout';
import type { ImageMeta } from '../../types/image-meta';
import type { PhotoGroup, VirtualTimelineOptions } from './types';
import { DEFAULT_OPTIONS } from './types';

/** 采样阈值：已加载真实行数达到此值才启用行高均值估算，避免单天偏差污染 */
const ROW_SAMPLE_THRESHOLD = 3;

/**
 * 无采样时的 fallback：按固定 1.3 宽高比估算列数推算行数
 * 最低保底 2 列，避免移动端除出 1 或 0
 */
function estimateSkeletonCols(containerWidth: number, targetRowHeight: number): number {
  if (containerWidth <= 0 || targetRowHeight <= 0) return 2;
  const avgItemWidth = targetRowHeight * 1.3;
  return Math.max(2, Math.round(containerWidth / avgItemWidth));
}

export function useTimelineLayout(
  containerWidth: Ref<number>,
  groups: Ref<PhotoGroup[]>,
  options: Required<VirtualTimelineOptions> = DEFAULT_OPTIONS,
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
   * 两遍遍历：
   * 1. pre-pass：对 real 天跑 justifiedLayout 缓存结果，顺便累加样本（总像素 / 总图片数）。
   * 2. main-pass：累加 Y，skeleton 天用 avgPxPerPhoto×expectedCount 估算（无样本则退回列数推算）。
   *
   * 采样均值贴近真实 justifiedLayout，避免 skeleton→real 切换时的高度突变。
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

    // pre-pass: 对 real 天跑 justifiedLayout，缓存结果 + 累加行高采样
    // per-photo 均值对宽高比分布敏感（全横图 vs 全竖图会差 30%+），改用"行高均值 × 行数"更稳
    const realLayoutCache = new Map<string, GroupLayoutResult>();
    let totalPhotoHeight = 0;
    let totalRowCount = 0;
    for (const group of groups.value) {
      if (!group.isSkeleton && group.items.length > 0) {
        const result = calculateJustifiedLayout(toLayoutItems(group.items), layoutOptions);
        realLayoutCache.set(group.id, result);
        totalPhotoHeight += result.contentHeight;
        totalRowCount += result.rows.length;
      }
    }

    const fallbackCols = estimateSkeletonCols(containerWidth.value, targetRowHeight);
    // 样本充足用行高均值；否则退回固定列数×targetRowHeight 推算
    const avgRowHeight = totalRowCount >= ROW_SAMPLE_THRESHOLD
      ? totalPhotoHeight / totalRowCount
      : null;

    const groupLayouts: TimelineGroupLayout[] = [];
    const itemPositionMap = new Map<string, { y: number; height: number; groupId: string }>();
    const allRows: Array<{ groupId: string; row: import('../../utils/justifiedLayout').LayoutRow; globalRowIndex: number }> = [];
    let currentY = 0;
    let globalRowIndex = 0;

    for (const group of groups.value) {
      const headerY = currentY;
      currentY += headerHeight;

      if (group.isSkeleton || group.items.length === 0) {
        const expectedCount = group.expectedCount ?? group.items.length;
        const rowCount = Math.ceil(expectedCount / fallbackCols);
        const rowH = avgRowHeight ?? targetRowHeight;
        const contentHeight = rowCount > 0
          ? Math.round(rowCount * rowH + Math.max(rowCount - 1, 0) * gap)
          : 0;
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
        const groupLayout = realLayoutCache.get(group.id)!;

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
