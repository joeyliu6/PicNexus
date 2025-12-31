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
  /** 最大行高限制（防止单张图片撑满整行时过高） */
  maxRowHeight?: number;
  /** 最后一行的处理方式：'justify' 填满 | 'left' 左对齐 */
  lastRowBehavior: 'justify' | 'left';
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
 * 计算单个分组的 Justified Layout
 *
 * 算法原理：
 * 1. 贪心算法：从左到右累加图片宽度，直到超过容器宽度形成一行
 * 2. 调整行高：让该行所有图片恰好填满容器宽度
 * 3. 最后一行特殊处理：可选择左对齐或填满
 *
 * @param items 图片数组
 * @param options 布局选项
 * @returns 布局结果
 */
export function calculateJustifiedLayout(
  items: LayoutItem[],
  options: LayoutOptions
): GroupLayoutResult {
  const {
    containerWidth,
    targetRowHeight,
    gap,
    maxRowHeight = targetRowHeight * 1.5,
    lastRowBehavior,
  } = options;

  // 空数组直接返回
  if (items.length === 0) {
    return { rows: [], contentHeight: 0 };
  }

  const rows: LayoutRow[] = [];
  let currentY = 0;
  let rowStart = 0;

  while (rowStart < items.length) {
    // 贪心：尽可能多地放入图片直到超过容器宽度
    let rowEnd = rowStart;
    let sumRatio = 0;

    while (rowEnd < items.length) {
      const item = items[rowEnd];
      const ratio = item.aspectRatio || 1;
      const itemWidthAtTargetHeight = targetRowHeight * ratio;
      const numItemsInRow = rowEnd - rowStart;
      const totalGapWidth = numItemsInRow * gap;
      const rowWidthIfAdded = sumRatio * targetRowHeight + itemWidthAtTargetHeight + totalGapWidth;

      // 如果加入这张图片会超出容器宽度，且已经有图片了，就结束本行
      if (rowWidthIfAdded > containerWidth && rowEnd > rowStart) {
        break;
      }

      sumRatio += ratio;
      rowEnd++;
    }

    // 计算该行的图片数量和间距
    const numItems = rowEnd - rowStart;
    const totalGapWidth = (numItems - 1) * gap;
    const availableWidth = containerWidth - totalGapWidth;

    // 计算实际行高（让图片恰好填满可用宽度）
    let rowHeight = availableWidth / sumRatio;

    // 应用最大行高限制
    if (rowHeight > maxRowHeight) {
      rowHeight = maxRowHeight;
    }

    // 判断是否是最后一行
    const isLastRow = rowEnd >= items.length;

    // 最后一行特殊处理
    if (isLastRow && lastRowBehavior === 'left' && numItems < 4) {
      // 最后一行图片少于 4 张时，使用目标行高，左对齐
      rowHeight = targetRowHeight;
    }

    // 计算每张图片的位置和尺寸
    const rowItems: LayoutedItem[] = [];
    let currentX = 0;

    for (let i = rowStart; i < rowEnd; i++) {
      const item = items[i];
      const ratio = item.aspectRatio || 1;
      const itemWidth = rowHeight * ratio;

      rowItems.push({
        id: item.id,
        x: currentX,
        y: currentY,
        width: itemWidth,
        height: rowHeight,
      });

      currentX += itemWidth + gap;
    }

    rows.push({
      y: currentY,
      height: rowHeight,
      items: rowItems,
    });

    currentY += rowHeight + gap;
    rowStart = rowEnd;
  }

  // 总高度 = 最后一行的 y + 高度（不含最后的 gap）
  const contentHeight = currentY - gap;

  return {
    rows,
    contentHeight: Math.max(0, contentHeight),
  };
}

/**
 * 计算完整的时间轴布局
 * 每个日期分组独立计算布局，然后垂直堆叠
 *
 * @param groups 分组数据
 * @param options 布局选项
 * @returns 完整的时间轴布局结果
 */
export function calculateTimelineLayout(
  groups: Array<{
    id: string;
    label: string;
    items: LayoutItem[];
  }>,
  options: TimelineLayoutOptions
): TimelineLayoutResult {
  const { headerHeight, groupGap, ...layoutOptions } = options;

  const groupLayouts: TimelineGroupLayout[] = [];
  const itemPositionMap = new Map<string, { y: number; height: number; groupId: string }>();
  const allRows: Array<{ groupId: string; row: LayoutRow; globalRowIndex: number }> = [];
  let currentY = 0;
  let globalRowIndex = 0;

  for (const group of groups) {
    // 记录分组头部位置
    const groupHeaderY = currentY;
    currentY += headerHeight;

    // 计算该分组的布局
    const groupLayout = calculateJustifiedLayout(group.items, layoutOptions);

    // 调整行和图片的 Y 坐标（加上当前偏移）
    for (const row of groupLayout.rows) {
      row.y += currentY;

      for (const item of row.items) {
        item.y += currentY;
        // 记录到位置索引
        itemPositionMap.set(item.id, {
          y: item.y,
          height: item.height,
          groupId: group.id,
        });
      }

      // 添加到全局行数组
      allRows.push({
        groupId: group.id,
        row,
        globalRowIndex,
      });
      globalRowIndex++;
    }

    groupLayouts.push({
      groupId: group.id,
      label: group.label,
      headerY: groupHeaderY,
      headerHeight,
      contentY: groupHeaderY + headerHeight,
      contentHeight: groupLayout.contentHeight,
      rows: groupLayout.rows,
      itemCount: group.items.length,
    });

    // 更新 Y 坐标：内容高度 + 分组间距
    currentY += groupLayout.contentHeight + groupGap;
  }

  // 总高度（减去最后一个分组的间距）
  const totalHeight = groups.length > 0 ? currentY - groupGap : 0;

  return {
    groupLayouts,
    totalHeight,
    itemPositionMap,
    allRows,
  };
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
  const { headerHeight, groupGap, ...layoutOptions } = options;

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
