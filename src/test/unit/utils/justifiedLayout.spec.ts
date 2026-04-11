import { describe, it, expect } from 'vitest';
import {
  calculateJustifiedLayout,
  calculateTimelineLayout,
  updateGroupLayout,
  findFirstVisibleRowIndex,
  getVisibleRowRange,
  getCurrentStickyHeader,
  findGroupScrollPosition,
  generateSkeletonLayout,
  type LayoutItem,
  type LayoutOptions,
  type TimelineLayoutOptions,
} from '../../../utils/justifiedLayout';

// ─── Helpers ──────────────────────────────────────────
function makeItem(id: string, aspectRatio: number): LayoutItem {
  return { id, aspectRatio };
}

const baseOptions: LayoutOptions = {
  containerWidth: 1000,
  targetRowHeight: 200,
  gap: 4,
  lastRowBehavior: 'justify',
};

const baseTimelineOptions: TimelineLayoutOptions = {
  ...baseOptions,
  headerHeight: 48,
  groupGap: 24,
};

// ═══════════════════════════════════════════════════════════════
// calculateJustifiedLayout
// ═══════════════════════════════════════════════════════════════

describe('calculateJustifiedLayout', () => {
  it('空数组 → 返回空行和 0 高度', () => {
    const result = calculateJustifiedLayout([], baseOptions);
    expect(result.rows).toEqual([]);
    expect(result.contentHeight).toBe(0);
  });

  it('单张图片（justify 模式）→ 1 行 1 图', () => {
    const result = calculateJustifiedLayout([makeItem('a', 1.5)], baseOptions);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].items).toHaveLength(1);
    expect(result.rows[0].items[0].id).toBe('a');
    expect(result.rows[0].items[0].x).toBe(0);
    expect(result.rows[0].items[0].y).toBe(0);
  });

  it('多张图片超过容器宽度 → 自动换行', () => {
    // 5 张宽高比 2 的图片，targetRowHeight 200，容器 1000
    // 每张宽约 400，每行最多 2-3 张
    const items = Array.from({ length: 5 }, (_, i) => makeItem(`img-${i}`, 2));
    const result = calculateJustifiedLayout(items, baseOptions);
    expect(result.rows.length).toBeGreaterThan(1);
    // 所有图片都应被排进某一行
    const totalItems = result.rows.reduce((sum, row) => sum + row.items.length, 0);
    expect(totalItems).toBe(5);
  });

  it('每行填满容器宽度（justify 模式，非最后行）', () => {
    // 构造 10 张宽高比 1 的图片，确保前几行都会被填满
    const items = Array.from({ length: 10 }, (_, i) => makeItem(`img-${i}`, 1));
    const result = calculateJustifiedLayout(items, baseOptions);
    // 前几行应该填满（忽略最后一行）
    for (let r = 0; r < result.rows.length - 1; r++) {
      const row = result.rows[r];
      const rowWidth = row.items.reduce((sum, item) => sum + item.width, 0)
        + (row.items.length - 1) * baseOptions.gap;
      // 容器宽度允许一点浮点误差
      expect(rowWidth).toBeCloseTo(baseOptions.containerWidth, 0);
    }
  });

  it('contentHeight 应等于最后一行 y + height', () => {
    const items = Array.from({ length: 6 }, (_, i) => makeItem(`img-${i}`, 1.5));
    const result = calculateJustifiedLayout(items, baseOptions);
    const lastRow = result.rows[result.rows.length - 1];
    expect(result.contentHeight).toBeCloseTo(lastRow.y + lastRow.height, 0);
  });

  it('最后一行 left 对齐（少于 4 张）→ 使用 targetRowHeight', () => {
    // 前 6 张占 2 行填满，第 3 行只有 2 张
    const items = Array.from({ length: 8 }, (_, i) => makeItem(`img-${i}`, 1));
    const result = calculateJustifiedLayout(items, {
      ...baseOptions,
      lastRowBehavior: 'left',
    });
    const lastRow = result.rows[result.rows.length - 1];
    if (lastRow.items.length < 4) {
      // left 模式下最后一行使用 targetRowHeight（或更小以防溢出）
      expect(lastRow.height).toBeLessThanOrEqual(baseOptions.targetRowHeight);
    }
  });

  it('宽高比 0 → fallback 为 1', () => {
    const items = [makeItem('a', 0), makeItem('b', 0)];
    // 关掉 maxRowHeight clamp，让行高按 justify 算（否则两张 ratio=1 图填 1000 宽时行高会超 maxRowHeight）
    const result = calculateJustifiedLayout(items, { ...baseOptions, maxRowHeight: 10000 });
    expect(result.rows).toHaveLength(1);
    // 两张 ratio=1 填满容器，每张宽度应约 (1000 - gap) / 2
    const expectedWidth = (baseOptions.containerWidth - baseOptions.gap) / 2;
    expect(result.rows[0].items[0].width).toBeCloseTo(expectedWidth, 0);
  });

  it('maxRowHeight 限制单宽图行高', () => {
    // 一张极宽的图，行高应被 maxRowHeight 限制
    const items = [makeItem('wide', 10)];
    const result = calculateJustifiedLayout(items, {
      ...baseOptions,
      maxRowHeight: 250,
      lastRowBehavior: 'justify', // 避免走 left 分支
    });
    expect(result.rows[0].height).toBeLessThanOrEqual(250);
  });

  it('justify 模式下单张图也会被填满', () => {
    const items = [makeItem('a', 1.5)];
    const result = calculateJustifiedLayout(items, {
      ...baseOptions,
      maxRowHeight: 10000, // 不触发 maxRowHeight
    });
    const item = result.rows[0].items[0];
    // 单张图 justify → 填满整个容器宽度
    expect(item.width).toBeCloseTo(baseOptions.containerWidth, 0);
  });

  it('left 模式且 4+ 张 → 走 justify 计算', () => {
    // 确保最后一行有 4+ 张不走 left 分支
    const items = Array.from({ length: 4 }, (_, i) => makeItem(`img-${i}`, 1));
    const result = calculateJustifiedLayout(items, {
      ...baseOptions,
      lastRowBehavior: 'left',
    });
    // 填满容器
    const rowWidth = result.rows[0].items.reduce((s, i) => s + i.width, 0)
      + (result.rows[0].items.length - 1) * baseOptions.gap;
    expect(rowWidth).toBeCloseTo(baseOptions.containerWidth, 0);
  });

  it('行间距 gap 应体现在 y 坐标递增', () => {
    const items = Array.from({ length: 6 }, (_, i) => makeItem(`img-${i}`, 1));
    const result = calculateJustifiedLayout(items, baseOptions);
    if (result.rows.length >= 2) {
      const row0 = result.rows[0];
      const row1 = result.rows[1];
      expect(row1.y).toBeCloseTo(row0.y + row0.height + baseOptions.gap, 0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// calculateTimelineLayout
// ═══════════════════════════════════════════════════════════════

describe('calculateTimelineLayout', () => {
  it('空分组 → 总高度 0', () => {
    const result = calculateTimelineLayout([], baseTimelineOptions);
    expect(result.groupLayouts).toEqual([]);
    expect(result.totalHeight).toBe(0);
    expect(result.itemPositionMap.size).toBe(0);
    expect(result.allRows).toEqual([]);
  });

  it('单分组单图 → 头部 + 图片', () => {
    const result = calculateTimelineLayout(
      [{ id: 'g1', label: '2024-01-01', items: [makeItem('a', 1.5)] }],
      baseTimelineOptions,
    );
    expect(result.groupLayouts).toHaveLength(1);
    const g = result.groupLayouts[0];
    expect(g.groupId).toBe('g1');
    expect(g.label).toBe('2024-01-01');
    expect(g.headerY).toBe(0);
    expect(g.contentY).toBe(baseTimelineOptions.headerHeight);
    expect(g.itemCount).toBe(1);
  });

  it('多分组垂直堆叠 + groupGap 间隔', () => {
    const result = calculateTimelineLayout(
      [
        { id: 'g1', label: 'd1', items: [makeItem('a', 1), makeItem('b', 1)] },
        { id: 'g2', label: 'd2', items: [makeItem('c', 1)] },
      ],
      baseTimelineOptions,
    );
    expect(result.groupLayouts).toHaveLength(2);
    const [g1, g2] = result.groupLayouts;
    // g2 的 headerY 应该 = g1.contentY + g1.contentHeight + groupGap
    expect(g2.headerY).toBeCloseTo(
      g1.contentY + g1.contentHeight + baseTimelineOptions.groupGap,
      0,
    );
  });

  it('itemPositionMap 填充每一张图', () => {
    const result = calculateTimelineLayout(
      [
        { id: 'g1', label: 'd1', items: [makeItem('a', 1), makeItem('b', 1)] },
        { id: 'g2', label: 'd2', items: [makeItem('c', 1)] },
      ],
      baseTimelineOptions,
    );
    expect(result.itemPositionMap.size).toBe(3);
    expect(result.itemPositionMap.get('a')?.groupId).toBe('g1');
    expect(result.itemPositionMap.get('c')?.groupId).toBe('g2');
  });

  it('allRows 按顺序累加 globalRowIndex', () => {
    const result = calculateTimelineLayout(
      [
        { id: 'g1', label: 'd1', items: Array.from({ length: 4 }, (_, i) => makeItem(`a${i}`, 1)) },
        { id: 'g2', label: 'd2', items: Array.from({ length: 4 }, (_, i) => makeItem(`b${i}`, 1)) },
      ],
      baseTimelineOptions,
    );
    const indices = result.allRows.map(r => r.globalRowIndex);
    expect(indices).toEqual(indices.slice().sort((a, b) => a - b));
    expect(indices[0]).toBe(0);
  });

  it('totalHeight 不含最后一组的 groupGap', () => {
    const result = calculateTimelineLayout(
      [
        { id: 'g1', label: 'd1', items: [makeItem('a', 1)] },
        { id: 'g2', label: 'd2', items: [makeItem('b', 1)] },
      ],
      baseTimelineOptions,
    );
    const last = result.groupLayouts[result.groupLayouts.length - 1];
    // totalHeight 应该约等于 last.contentY + last.contentHeight（最后一个 gap 被减去）
    expect(result.totalHeight).toBeCloseTo(last.contentY + last.contentHeight, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// updateGroupLayout
// ═══════════════════════════════════════════════════════════════

describe('updateGroupLayout', () => {
  const initial = () => calculateTimelineLayout(
    [
      { id: 'g1', label: 'd1', items: [makeItem('a', 1), makeItem('b', 1)] },
      { id: 'g2', label: 'd2', items: [makeItem('c', 1), makeItem('d', 1)] },
      { id: 'g3', label: 'd3', items: [makeItem('e', 1)] },
    ],
    baseTimelineOptions,
  );

  it('目标分组不存在 → 返回原布局', () => {
    const layout = initial();
    const result = updateGroupLayout(layout, 'no-such-group', [makeItem('x', 1)], baseTimelineOptions);
    expect(result).toBe(layout);
  });

  it('高度不变（等量替换）→ 只更新该分组内容，后续分组 y 不变', () => {
    const layout = initial();
    const g3HeaderYBefore = layout.groupLayouts[2].headerY;
    // 用同等数量的新图片替换 g1（宽高比相同，应同等高度）
    const result = updateGroupLayout(layout, 'g1', [makeItem('a2', 1), makeItem('b2', 1)], baseTimelineOptions);
    // g3 的 headerY 应该不变
    expect(result.groupLayouts[2].headerY).toBeCloseTo(g3HeaderYBefore, 0);
    // itemPositionMap 应该反映新图片
    expect(result.itemPositionMap.has('a2')).toBe(true);
    expect(result.itemPositionMap.has('b2')).toBe(true);
  });

  it('高度增加 → 后续分组 y 下移', () => {
    const layout = initial();
    const g3HeaderYBefore = layout.groupLayouts[2].headerY;
    // 给 g1 加更多图片（从 2 张 → 6 张，必然换行，高度增加）
    const newItems = Array.from({ length: 6 }, (_, i) => makeItem(`new-${i}`, 1));
    const result = updateGroupLayout(layout, 'g1', newItems, baseTimelineOptions);
    expect(result.groupLayouts[2].headerY).toBeGreaterThan(g3HeaderYBefore);
    expect(result.totalHeight).toBeGreaterThan(layout.totalHeight);
  });

  it('高度减少 → 后续分组 y 上移', () => {
    const layout = calculateTimelineLayout(
      [
        { id: 'g1', label: 'd1', items: Array.from({ length: 8 }, (_, i) => makeItem(`a${i}`, 1)) },
        { id: 'g2', label: 'd2', items: [makeItem('z', 1)] },
      ],
      baseTimelineOptions,
    );
    const g2HeaderYBefore = layout.groupLayouts[1].headerY;
    // 减少 g1 的图片数量
    const result = updateGroupLayout(layout, 'g1', [makeItem('a0', 1)], baseTimelineOptions);
    expect(result.groupLayouts[1].headerY).toBeLessThan(g2HeaderYBefore);
  });

  it('itemPositionMap 移除被替换的旧图片', () => {
    const layout = initial();
    expect(layout.itemPositionMap.has('a')).toBe(true);
    const result = updateGroupLayout(layout, 'g1', [makeItem('a-new', 1)], baseTimelineOptions);
    expect(result.itemPositionMap.has('a')).toBe(false);
    expect(result.itemPositionMap.has('a-new')).toBe(true);
  });

  it('目标分组之前的分组位置索引保持不变', () => {
    const layout = initial();
    const cYBefore = layout.itemPositionMap.get('c')?.y;
    // 更新 g3（最后一个分组），g1/g2 不动
    const result = updateGroupLayout(layout, 'g3', [makeItem('e2', 1), makeItem('e3', 1)], baseTimelineOptions);
    expect(result.itemPositionMap.get('c')?.y).toBe(cYBefore);
  });
});

// ═══════════════════════════════════════════════════════════════
// findFirstVisibleRowIndex
// ═══════════════════════════════════════════════════════════════

describe('findFirstVisibleRowIndex', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    row: { y: i * 100, height: 80, items: [] },
  }));

  it('空数组 → 0', () => {
    expect(findFirstVisibleRowIndex([], 500)).toBe(0);
  });

  it('scrollTop 0 → 第 0 行', () => {
    expect(findFirstVisibleRowIndex(rows, 0)).toBe(0);
  });

  it('scrollTop 在某一行的中间 → 该行', () => {
    // row[3] y=300 height=80, bottom=380
    // scrollTop=350 应该落在 row[3]
    expect(findFirstVisibleRowIndex(rows, 350)).toBe(3);
  });

  it('scrollTop 刚好在行边界之后 → 下一行', () => {
    // row[2] y=200 height=80 bottom=280
    // scrollTop=281 应该在 row[2].bottom 之后，落到 row[3]
    expect(findFirstVisibleRowIndex(rows, 281)).toBe(3);
  });

  it('scrollTop 超过所有行 → 最后一行 index', () => {
    expect(findFirstVisibleRowIndex(rows, 99999)).toBe(rows.length - 1);
  });
});

// ═══════════════════════════════════════════════════════════════
// getVisibleRowRange
// ═══════════════════════════════════════════════════════════════

describe('getVisibleRowRange', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    row: { y: i * 100, height: 90, items: [] },
  }));

  it('空数组 → [0, 0]', () => {
    expect(getVisibleRowRange([], 0, 500)).toEqual([0, 0]);
  });

  it('基本可见范围（无 overscan）', () => {
    const [start, end] = getVisibleRowRange(rows, 0, 300, 0);
    expect(start).toBe(0);
    // y < 300 的 4 行（0, 100, 200）→ end 应该是 3（不含）
    expect(end).toBeGreaterThanOrEqual(3);
  });

  it('应用 overscan（向上+向下）', () => {
    const [start, end] = getVisibleRowRange(rows, 500, 300, 2);
    // 基准 startIndex=5，overscan 2 → 3
    expect(start).toBe(3);
    // end 增加 overscan
    expect(end).toBeGreaterThan(5);
  });

  it('overscan 受数组边界限制', () => {
    const [start, end] = getVisibleRowRange(rows, 0, 200, 10);
    expect(start).toBe(0); // 不会变负
    expect(end).toBeLessThanOrEqual(rows.length);
  });

  it('默认 overscan = 3', () => {
    const [start] = getVisibleRowRange(rows, 500, 300);
    // startIndex=5 - 3 = 2
    expect(start).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// getCurrentStickyHeader
// ═══════════════════════════════════════════════════════════════

describe('getCurrentStickyHeader', () => {
  const groupLayouts = [
    { groupId: 'g1', label: 'Group 1', headerY: 0, headerHeight: 48, contentY: 48, contentHeight: 200, rows: [], itemCount: 0 },
    { groupId: 'g2', label: 'Group 2', headerY: 248, headerHeight: 48, contentY: 296, contentHeight: 300, rows: [], itemCount: 0 },
    { groupId: 'g3', label: 'Group 3', headerY: 596, headerHeight: 48, contentY: 644, contentHeight: 150, rows: [], itemCount: 0 },
  ];

  it('在第一个分组内 → 返回第一个', () => {
    expect(getCurrentStickyHeader(groupLayouts, 100)?.groupId).toBe('g1');
  });

  it('在第二个分组内 → 返回第二个', () => {
    expect(getCurrentStickyHeader(groupLayouts, 400)?.groupId).toBe('g2');
  });

  it('在最后一个分组之后 → 仍然返回最后一个', () => {
    expect(getCurrentStickyHeader(groupLayouts, 10000)?.groupId).toBe('g3');
  });

  it('空分组数组 → null', () => {
    expect(getCurrentStickyHeader([], 500)).toBeNull();
  });

  it('scrollTop 在最开头之前（理论上不发生，但代码要能兜底）', () => {
    // scrollTop=-10，在 g1.headerY=0 之前 → for 循环不匹配 → fallback 到最后一个的分支也不进
    // 实际会命中 fallback 前的 null 返回。不过 groupLayouts[0].headerY >= 0，-10 < 0，
    // 不匹配 for 循环中的条件，也不满足 fallback 条件（scrollTop >= last.headerY）
    expect(getCurrentStickyHeader(groupLayouts, -10)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// findGroupScrollPosition
// ═══════════════════════════════════════════════════════════════

describe('findGroupScrollPosition', () => {
  const groupLayouts = [
    { groupId: 'g1', label: 'G1', headerY: 0, headerHeight: 48, contentY: 48, contentHeight: 200, rows: [], itemCount: 0 },
    { groupId: 'g2', label: 'G2', headerY: 248, headerHeight: 48, contentY: 296, contentHeight: 300, rows: [], itemCount: 0 },
  ];

  it('找到分组 → 返回 headerY', () => {
    expect(findGroupScrollPosition(groupLayouts, 'g2')).toBe(248);
  });

  it('找不到分组 → 返回 null', () => {
    expect(findGroupScrollPosition(groupLayouts, 'nonexistent')).toBeNull();
  });

  it('空分组数组 → null', () => {
    expect(findGroupScrollPosition([], 'g1')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// generateSkeletonLayout
// ═══════════════════════════════════════════════════════════════

describe('generateSkeletonLayout', () => {
  it('正常输入 → 返回 groups/items/totalHeight', () => {
    const result = generateSkeletonLayout({
      containerWidth: 1200,
      viewportHeight: 800,
    });
    expect(result.groups.length).toBeGreaterThan(0);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.totalHeight).toBeGreaterThan(0);
  });

  it('containerWidth 为 0 → 返回空布局', () => {
    const result = generateSkeletonLayout({ containerWidth: 0, viewportHeight: 800 });
    expect(result.groups).toEqual([]);
    expect(result.items).toEqual([]);
    expect(result.totalHeight).toBe(0);
  });

  it('viewportHeight 为 0 → 返回空布局', () => {
    const result = generateSkeletonLayout({ containerWidth: 1200, viewportHeight: 0 });
    expect(result.groups).toEqual([]);
    expect(result.items).toEqual([]);
    expect(result.totalHeight).toBe(0);
  });

  it('负数 containerWidth → 返回空布局', () => {
    const result = generateSkeletonLayout({ containerWidth: -1, viewportHeight: 500 });
    expect(result.groups).toEqual([]);
  });

  it('默认参数生效（targetRowHeight / gap / headerHeight / groupGap 都有默认值）', () => {
    const result = generateSkeletonLayout({
      containerWidth: 800,
      viewportHeight: 600,
    });
    expect(result.groups.length).toBeGreaterThan(0);
  });

  it('自定义参数透传', () => {
    const result = generateSkeletonLayout({
      containerWidth: 1000,
      viewportHeight: 500,
      targetRowHeight: 150,
      gap: 8,
      headerHeight: 40,
      groupGap: 16,
    });
    expect(result.groups.length).toBeGreaterThan(0);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('相同输入多次调用应产生完全一致的布局（确定性）', () => {
    const opts = { containerWidth: 1000, viewportHeight: 500 };
    const r1 = generateSkeletonLayout(opts);
    const r2 = generateSkeletonLayout(opts);
    expect(r1.groups).toEqual(r2.groups);
    expect(r1.items).toEqual(r2.items);
    expect(r1.totalHeight).toBe(r2.totalHeight);
  });

  it('视口越高 → 产生越多分组', () => {
    const small = generateSkeletonLayout({ containerWidth: 1000, viewportHeight: 300 });
    const large = generateSkeletonLayout({ containerWidth: 1000, viewportHeight: 2000 });
    expect(large.groups.length).toBeGreaterThanOrEqual(small.groups.length);
  });
});
