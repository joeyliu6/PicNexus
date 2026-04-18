/**
 * 时间轴布局计算模块
 * 负责 calculateFullLayout、recalculateLayoutAsync、updateGroup 等布局相关逻辑
 *
 * 支持 skeleton/real 混合模式，骨架 group 走三级路径：
 * 1. 命中 aspectRatios cache（预取过的月） → 精准比例 justifiedLayout
 * 2. 未命中但有 aspectRatioSum（dayStats 提供，永不变） → 平均比例 justifiedLayout（时间不变量，跨阶段稳定）
 * 3. 兜底（极少见，如测试 fixtures 缺 aspectRatioSum） → 等宽矩阵 × targetRowHeight
 * real group 走完整 justifiedLayout。
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

/**
 * 无采样时的 fallback：按固定 1.3 宽高比估算列数推算行数
 * 最低保底 2 列，避免移动端除出 1 或 0
 */
function estimateSkeletonCols(containerWidth: number, targetRowHeight: number): number {
  if (containerWidth <= 0 || targetRowHeight <= 0) return 2;
  const avgItemWidth = targetRowHeight * 1.3;
  return Math.max(2, Math.round(containerWidth / avgItemWidth));
}

type SkeletonSlot = { x: number; y: number; width: number; height: number };

/** 生成等宽等高的矩阵骨架槽位 + 内容高度 */
function buildUniformGrid(
  count: number,
  cols: number,
  cellW: number,
  cellH: number,
  gap: number,
): { slots: SkeletonSlot[]; contentHeight: number } {
  const rowCount = Math.ceil(count / cols);
  const slots: SkeletonSlot[] = [];
  let remaining = count;
  for (let r = 0; r < rowCount; r++) {
    const colsInRow = Math.min(cols, remaining);
    const rowY = r * (cellH + gap);
    for (let c = 0; c < colsInRow; c++) {
      slots.push({ x: c * (cellW + gap), y: rowY, width: cellW, height: cellH });
    }
    remaining -= colsInRow;
  }
  const contentHeight = rowCount > 0
    ? Math.round(rowCount * cellH + Math.max(rowCount - 1, 0) * gap)
    : 0;
  return { slots, contentHeight };
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

  /**
   * 路径 ① skeleton 布局缓存
   *
   * isFullyPreloaded=true 时 3000+ 天全部进入路径 ①，每次 calculateFullLayout
   * 都跑一遍 justifiedLayout（v5 实测 1-3s 主线程阻塞）。
   * aspectRatios 数组是 DB 快照 + LRU 不变量：aspectRatios.length 不变 + containerWidth 不变
   * → justifiedLayout 结果确定相同，可全量复用。
   *
   * 失效信号：
   * - containerWidth 变化（窗口 resize） → 全清
   * - 某天 aspectRatios.length 变化（removeItemsByIds 删图） → 该 key 失效
   * - dayKey 不再出现在 groups（filter 切换） → 按 aliveKeys 收敛
   */
  interface CachedSkeletonLayout {
    width: number;
    count: number;
    contentHeight: number;
    slots: Array<{ x: number; y: number; width: number; height: number }>;
  }
  const skeletonLayoutCache = new Map<string, CachedSkeletonLayout>();

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
   * 1. pre-pass：对 real 天跑 justifiedLayout 缓存结果。
   * 2. main-pass：累加 Y，skeleton 天按三级路径：
   *    - 命中 aspectRatios cache → 精准比例 justified
   *    - 有 aspectRatioSum → 平均比例 justified（时间不变量，跨阶段稳定）
   *    - 兜底 → 等宽矩阵 × targetRowHeight
   *
   * 不再用 avgRowHeight 估算：样本变化会让 Oct 31 这种目标月的 headerY
   * 随 ensureDaysLoaded 漂移（数万 px 级），造成早跳 / 晚跳落点偏移。
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

    // skeleton cache 收敛：清掉不再出现在 groups 的旧 dayKey，防止 filter 切换后残留
    const aliveKeys = new Set(groups.value.map(g => g.id));
    for (const k of skeletonLayoutCache.keys()) {
      if (!aliveKeys.has(k)) skeletonLayoutCache.delete(k);
    }

    // pre-pass: 对 real 天跑 justifiedLayout 并缓存
    const realLayoutCache = new Map<string, GroupLayoutResult>();
    for (const group of groups.value) {
      if (!group.isSkeleton && group.items.length > 0) {
        const result = calculateJustifiedLayout(toLayoutItems(group.items), layoutOptions);
        realLayoutCache.set(group.id, result);
      }
    }

    const fallbackCols = estimateSkeletonCols(containerWidth.value, targetRowHeight);

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

        // ① 精准路径：LRU cache 命中真实 aspectRatios → 跑和真图一样的 justifiedLayout
        // → skeleton→real 切换时位置/尺寸零跳变，只有颜色变化
        if (group.aspectRatios && group.aspectRatios.length > 0) {
          const aspectRatios = group.aspectRatios;
          let cached = skeletonLayoutCache.get(group.id);
          if (!cached || cached.width !== containerWidth.value || cached.count !== aspectRatios.length) {
            const fakeItems: LayoutItem[] = aspectRatios.map((ar, idx) => ({
              id: `__skeleton__${group.id}__${idx}`,
              aspectRatio: ar > 0 ? ar : 1,
            }));
            const result = calculateJustifiedLayout(fakeItems, layoutOptions);
            const slots = result.rows.flatMap(row =>
              row.items.map(item => ({ x: item.x, y: item.y, width: item.width, height: item.height }))
            );
            cached = {
              width: containerWidth.value,
              count: aspectRatios.length,
              contentHeight: result.contentHeight,
              slots,
            };
            skeletonLayoutCache.set(group.id, cached);
          }
          groupLayouts.push({
            groupId: group.id,
            label: group.label,
            headerY,
            headerHeight,
            contentY: headerY + headerHeight,
            contentHeight: cached.contentHeight,
            rows: [],
            itemCount: expectedCount,
            skeletonSlots: cached.slots,
          });
          currentY += cached.contentHeight + groupGap;
        }
        // ② 平均比例路径（闭式公式）：aspectRatioSum 是时间不变量，跨阶段高度稳定
        // 选闭式公式而非 justifiedLayout × 3000+ 天：后者会阻塞主线程 1-3s，触发 waitLayoutSettled 超时
        else if (group.aspectRatioSum && group.aspectRatioSum > 0 && expectedCount > 0) {
          const avgAspect = group.aspectRatioSum / expectedCount;
          const photoW = avgAspect * targetRowHeight;
          const nPerRow = Math.max(1, Math.floor((containerWidth.value + gap) / (photoW + gap)));
          const { slots, contentHeight } = buildUniformGrid(expectedCount, nPerRow, photoW, targetRowHeight, gap);
          groupLayouts.push({
            groupId: group.id,
            label: group.label,
            headerY,
            headerHeight,
            contentY: headerY + headerHeight,
            contentHeight,
            rows: [],
            itemCount: expectedCount,
            skeletonSlots: slots,
          });
          currentY += contentHeight + groupGap;
        }
        // ③ 兜底路径：连 aspectRatioSum 都没有（极少见，如测试 fixtures）→ 等宽矩阵
        else {
          const itemWidth = Math.max(
            1,
            Math.floor((containerWidth.value - (fallbackCols - 1) * gap) / fallbackCols),
          );
          const { slots, contentHeight } = buildUniformGrid(expectedCount, fallbackCols, itemWidth, targetRowHeight, gap);
          groupLayouts.push({
            groupId: group.id,
            label: group.label,
            headerY,
            headerHeight,
            contentY: headerY + headerHeight,
            contentHeight,
            rows: [],
            itemCount: expectedCount,
            skeletonSlots: slots,
          });
          currentY += contentHeight + groupGap;
        }
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
