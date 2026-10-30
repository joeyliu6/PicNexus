/**
 * Justified Layout 算法
 * 实现类似 Google Photos 的图片网格布局
 * 固定行高，图片按原始宽高比显示，每行填满容器宽度
 */

// ==================== 类型定义 ====================

/** 输入项：用于布局计算的图片信息 */
export interface LayoutItem {
  /** 唯一标识符 */
  id: string;
  /** 宽高比 (width / height)，如果未知则默认为 1 */
  aspectRatio: number;
}

/** 布局后的图片位置和尺寸 */
export interface LayoutedItem {
  /** 唯一标识符 */
  id: string;
  /** 左上角 x 坐标（相对于容器） */
  x: number;
  /** 左上角 y 坐标（相对于容器） */
  y: number;
  /** 计算后的宽度 */
  width: number;
  /** 计算后的高度（同一行的图片高度相同） */
  height: number;
}

/** 布局后的行信息 */
export interface LayoutRow {
  /** 行的 y 坐标 */
  y: number;
  /** 行高 */
  height: number;
  /** 该行包含的图片 */
  items: LayoutedItem[];
}

/** 单个分组的布局结果 */
export interface GroupLayoutResult {
  /** 所有行 */
  rows: LayoutRow[];
  /** 内容区域总高度（不含头部） */
  contentHeight: number;
}

/** 时间轴分组布局结果 */
export interface TimelineGroupLayout {
  /** 分组 ID（如 '2024-5-15'） */
  groupId: string;
  /** 分组标签（如 '2024年5月15日'） */
  label: string;
  /** 分组头部的 y 坐标 */
  headerY: number;
  /** 分组头部高度 */
  headerHeight: number;
  /** 内容区域起始 y 坐标 */
  contentY: number;
  /** 内容区域高度 */
  contentHeight: number;
  /** 布局后的行 */
  rows: LayoutRow[];
  /** 该分组包含的图片数量 */
  itemCount: number;
  /**
   * 骨架占位矩形（仅 skeleton 天存在，real 天为 undefined）。
   * 坐标相对于 contentY，供虚拟滚动按 count × avg 画灰色占位，避免未加载天视觉空白。
   */
  skeletonSlots?: Array<{ x: number; y: number; width: number; height: number }>;
}

/** 完整的时间轴布局结果 */
export interface TimelineLayoutResult {
  /** 所有分组的布局 */
  groupLayouts: TimelineGroupLayout[];
  /** 总高度 */
  totalHeight: number;
  /** 图片位置索引：id -> { y, height }，用于快速查找 */
  itemPositionMap: Map<string, { y: number; height: number; groupId: string }>;
  /** 所有行的扁平数组，用于虚拟滚动 */
  allRows: Array<{ groupId: string; row: LayoutRow; globalRowIndex: number }>;
}

/** 布局配置选项 */
export interface LayoutOptions {
  /** 容器宽度 */
  containerWidth: number;
  /** 目标行高（实际行高会根据图片调整） */
  targetRowHeight: number;
  /** 图片间距 */
  gap: number;
}

/** 时间轴布局配置 */
export interface TimelineLayoutOptions extends LayoutOptions {
  /** 分组头部高度 */
  headerHeight: number;
  /** 分组之间的间距 */
  groupGap: number;
}

// ==================== 核心算法 ====================

/**
 * 计算单个分组的 Justified Layout（GalleryScreen.dc.html 的排法）
 *
 * 1. 一张张放进这一行，放到「按目标行高排已经铺满宽度」的那一张为止（含这一张）
 * 2. 把整行缩到正好铺满容器宽度：行高只会小于等于目标行高，不会被放大
 * 3. 最后一行不够宽：保持目标行高、靠左
 *
 * @param items 图片数组
 * @param options 布局选项
 * @returns 布局结果
 */
export function calculateJustifiedLayout(
  items: LayoutItem[],
  options: LayoutOptions
): GroupLayoutResult {
  const { containerWidth, targetRowHeight, gap } = options;
  if (items.length === 0) {
    return { rows: [], contentHeight: 0 };
  }

  const rows: LayoutRow[] = [];
  let currentY = 0;
  let row: LayoutItem[] = [];
  let sumRatio = 0;

  const placeRow = (rowHeight: number): void => {
    let currentX = 0;
    const rowItems: LayoutedItem[] = row.map((item) => {
      const width = rowHeight * (item.aspectRatio || 1);
      const placed = { id: item.id, x: currentX, y: currentY, width, height: rowHeight };
      currentX += width + gap;
      return placed;
    });
    rows.push({ y: currentY, height: rowHeight, items: rowItems });
    currentY += rowHeight + gap;
    row = [];
    sumRatio = 0;
  };

  for (const item of items) {
    row.push(item);
    sumRatio += item.aspectRatio || 1;
    const totalGapWidth = (row.length - 1) * gap;
    if (sumRatio * targetRowHeight + totalGapWidth >= containerWidth) {
      placeRow((containerWidth - totalGapWidth) / sumRatio);
    }
  }
  if (row.length > 0) placeRow(targetRowHeight);

  // 总高度 = 最后一行的 y + 高度（不含最后的 gap）
  return { rows, contentHeight: Math.max(0, currentY - gap) };
}

// ==================== 增量更新工具函数 ====================

/**
 * 局部重算分组布局（用于上传/删除图片时）
 * 只重算目标分组，其他分组只更新 Y 坐标偏移
 *
 * @param layout 现有布局结果
 * @param targetGroupId 需要重算的分组 ID
 * @param newItems 该分组的新图片数组
 * @param options 布局选项
 * @returns 更新后的布局结果
 */
export function updateGroupLayout(
  layout: TimelineLayoutResult,
  targetGroupId: string,
  newItems: LayoutItem[],
  options: TimelineLayoutOptions
): TimelineLayoutResult {
  // 解构时丢掉 headerHeight / groupGap：它们只控制分组之间的垂直间距，
  // 本函数只重算"某一分组内部"的布局，不涉及组间间距
  const { headerHeight: _headerHeight, groupGap: _groupGap, ...layoutOptions } = options;

  // 找到目标分组的索引
  const targetIndex = layout.groupLayouts.findIndex((g) => g.groupId === targetGroupId);
  if (targetIndex === -1) {
    // 分组不存在，返回原布局
    return layout;
  }

  const targetGroup = layout.groupLayouts[targetIndex];
  const oldContentHeight = targetGroup.contentHeight;

  // 重算目标分组的布局
  const newGroupLayout = calculateJustifiedLayout(newItems, layoutOptions);
  const newContentHeight = newGroupLayout.contentHeight;

  // 计算高度差
  const deltaHeight = newContentHeight - oldContentHeight;

  // 如果高度没变化，只需更新图片数据
  if (Math.abs(deltaHeight) < 0.1) {
    // 更新目标分组的行数据
    const contentY = targetGroup.contentY;
    for (const row of newGroupLayout.rows) {
      row.y += contentY;
      for (const item of row.items) {
        item.y += contentY;
      }
    }

    targetGroup.rows = newGroupLayout.rows;
    targetGroup.contentHeight = newContentHeight;
    targetGroup.itemCount = newItems.length;

    // 更新位置索引
    const newItemPositionMap = new Map(layout.itemPositionMap);
    // 移除旧的该分组图片
    for (const [id, pos] of newItemPositionMap) {
      if (pos.groupId === targetGroupId) {
        newItemPositionMap.delete(id);
      }
    }
    // 添加新的
    for (const row of newGroupLayout.rows) {
      for (const item of row.items) {
        newItemPositionMap.set(item.id, {
          y: item.y,
          height: item.height,
          groupId: targetGroupId,
        });
      }
    }

    // 重建 allRows
    const newAllRows = rebuildAllRows(layout.groupLayouts);

    return {
      ...layout,
      itemPositionMap: newItemPositionMap,
      allRows: newAllRows,
    };
  }

  // 高度有变化，需要更新后续分组的 Y 坐标
  const newGroupLayouts = [...layout.groupLayouts];
  const newItemPositionMap = new Map<string, { y: number; height: number; groupId: string }>();

  // 更新目标分组
  const contentY = targetGroup.contentY;
  for (const row of newGroupLayout.rows) {
    row.y += contentY;
    for (const item of row.items) {
      item.y += contentY;
      newItemPositionMap.set(item.id, {
        y: item.y,
        height: item.height,
        groupId: targetGroupId,
      });
    }
  }

  newGroupLayouts[targetIndex] = {
    ...targetGroup,
    rows: newGroupLayout.rows,
    contentHeight: newContentHeight,
    itemCount: newItems.length,
  };

  // 更新后续分组的 Y 坐标
  for (let i = targetIndex + 1; i < newGroupLayouts.length; i++) {
    const group = newGroupLayouts[i];

    group.headerY += deltaHeight;
    group.contentY += deltaHeight;

    for (const row of group.rows) {
      row.y += deltaHeight;
      for (const item of row.items) {
        item.y += deltaHeight;
        newItemPositionMap.set(item.id, {
          y: item.y,
          height: item.height,
          groupId: group.groupId,
        });
      }
    }
  }

  // 保留目标分组之前的分组的位置索引
  for (let i = 0; i < targetIndex; i++) {
    const group = newGroupLayouts[i];
    for (const row of group.rows) {
      for (const item of row.items) {
        newItemPositionMap.set(item.id, {
          y: item.y,
          height: item.height,
          groupId: group.groupId,
        });
      }
    }
  }

  // 重建 allRows
  const newAllRows = rebuildAllRows(newGroupLayouts);

  return {
    groupLayouts: newGroupLayouts,
    totalHeight: layout.totalHeight + deltaHeight,
    itemPositionMap: newItemPositionMap,
    allRows: newAllRows,
  };
}

/**
 * 重建 allRows 数组
 */
function rebuildAllRows(
  groupLayouts: TimelineGroupLayout[]
): Array<{ groupId: string; row: LayoutRow; globalRowIndex: number }> {
  const allRows: Array<{ groupId: string; row: LayoutRow; globalRowIndex: number }> = [];
  let globalRowIndex = 0;

  for (const group of groupLayouts) {
    for (const row of group.rows) {
      allRows.push({
        groupId: group.groupId,
        row,
        globalRowIndex,
      });
      globalRowIndex++;
    }
  }

  return allRows;
}

// ==================== 虚拟滚动辅助函数 ====================

/**
 * 二分查找第一个可见行的索引
 *
 * @param allRows 所有行的数组
 * @param scrollTop 滚动位置
 * @returns 第一个可见行的索引
 */
export function findFirstVisibleRowIndex(
  allRows: Array<{ row: LayoutRow }>,
  scrollTop: number
): number {
  if (allRows.length === 0) return 0;

  let left = 0;
  let right = allRows.length - 1;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    const rowBottom = allRows[mid].row.y + allRows[mid].row.height;

    if (rowBottom < scrollTop) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  return left;
}

/**
 * 获取可见行的索引范围
 *
 * @param allRows 所有行的数组
 * @param scrollTop 滚动位置
 * @param viewportHeight 视口高度
 * @param overscan 上下额外渲染的行数
 * @returns [startIndex, endIndex]
 */
export function getVisibleRowRange(
  allRows: Array<{ row: LayoutRow }>,
  scrollTop: number,
  viewportHeight: number,
  overscan: number = 3
): [number, number] {
  if (allRows.length === 0) return [0, 0];

  const viewBottom = scrollTop + viewportHeight;

  // 找到第一个可见行
  let startIndex = findFirstVisibleRowIndex(allRows, scrollTop);

  // 应用 overscan（向上）
  startIndex = Math.max(0, startIndex - overscan);

  // 找到最后一个可见行
  let endIndex = startIndex;
  while (endIndex < allRows.length && allRows[endIndex].row.y < viewBottom) {
    endIndex++;
  }

  // 应用 overscan（向下）
  endIndex = Math.min(allRows.length, endIndex + overscan);

  return [startIndex, endIndex];
}

/**
 * 根据滚动位置找到当前应该显示的粘性头部
 *
 * @param groupLayouts 分组布局数组
 * @param scrollTop 滚动位置
 * @returns 当前分组的标签，或 null
 */
export function getCurrentStickyHeader(
  groupLayouts: TimelineGroupLayout[],
  scrollTop: number
): { groupId: string; label: string } | null {
  for (const group of groupLayouts) {
    const groupEnd = group.contentY + group.contentHeight;
    if (scrollTop >= group.headerY && scrollTop < groupEnd) {
      return { groupId: group.groupId, label: group.label };
    }
  }

  // 如果在所有分组之后，返回最后一个
  if (groupLayouts.length > 0 && scrollTop >= groupLayouts[groupLayouts.length - 1].headerY) {
    const lastGroup = groupLayouts[groupLayouts.length - 1];
    return { groupId: lastGroup.groupId, label: lastGroup.label };
  }

  return null;
}

/**
 * 查找分组的 Y 坐标（用于快速跳转）
 *
 * @param groupLayouts 分组布局数组
 * @param groupId 目标分组 ID
 * @returns Y 坐标，或 null
 */
export function findGroupScrollPosition(
  groupLayouts: TimelineGroupLayout[],
  groupId: string
): number | null {
  const group = groupLayouts.find((g) => g.groupId === groupId);
  return group ? group.headerY : null;
}
