import { describe, it, expect } from 'vitest';
import {
  calculateJustifiedLayout,
  calculateTimelineLayout,
  updateGroupLayout,
  findFirstVisibleRowIndex,
  getVisibleRowRange,
  getCurrentStickyHeader,
  findGroupScrollPosition,
  type LayoutItem,
  type LayoutOptions,
  type TimelineLayoutOptions,
} from '@/utils/justifiedLayout';

// ─── Helpers ──────────────────────────────────────────
function makeItem(id: string, aspectRatio: number): LayoutItem {
  return { id, aspectRatio };
}

const baseOptions: LayoutOptions = {
  containerWidth: 1000,
  targetRowHeight: 200,
  gap: 4,
};

const baseTimelineOptions: TimelineLayoutOptions = {
  ...baseOptions,
  headerHeight: 48,
  groupGap: 24,
};

// ═══════════════════════════════════════════════════════════════
// calculateJustifiedLayout
// ═══════════════════════════════════════════════════════════════

// GalleryScreen.dc.html 的排法：放进「按目标行高已经铺满」的那一张为止，再整行缩到正好铺满；
// 行高只会小于等于目标；最后一行不够宽就保持目标行高、靠左
describe('calculateJustifiedLayout', () => {
  const gallery: LayoutOptions = { containerWidth: 1144, targetRowHeight: 150, gap: 6 };
  const rowWidth = (row: { items: Array<{ width: number }> }, gap: number) =>
    row.items.reduce((sum, item) => sum + item.width, 0) + (row.items.length - 1) * gap;

  it('空数组 → 返回空行和 0 高度', () => {
    const result = calculateJustifiedLayout([], baseOptions);
    expect(result.rows).toEqual([]);
    expect(result.contentHeight).toBe(0);
  });

  // 设计稿 G01「今天」那 6 张：一行放下、行高约 135（旧排法拆成 5 张约 173 + 单独 1 张）
  it('takes the picture that overflows into the row and shrinks the row to fit', () => {
    const today = [16 / 9, 16 / 9, 4 / 3, 1280 / 2200, 1, 16 / 9].map((ratio, i) => makeItem(`t${i}`, ratio));
    const { rows } = calculateJustifiedLayout(today, gallery);
    expect(rows).toHaveLength(1);
    expect(rows[0].items).toHaveLength(6);
    expect(rows[0].height).toBeCloseTo(135, 0);
    expect(rowWidth(rows[0], gallery.gap)).toBeCloseTo(gallery.containerWidth, 3);
  });

  it('keeps every full row at or below the target height, filling the width', () => {
    const ratios = [1.5, 0.75, 1, 2, 1.33, 0.56, 1.78, 1, 3, 0.8, 1.2, 1.6];
    const { rows } = calculateJustifiedLayout(ratios.map((r, i) => makeItem(`i${i}`, r)), gallery);
    for (const row of rows.slice(0, -1)) {
      expect(row.height).toBeLessThanOrEqual(gallery.targetRowHeight);
      expect(rowWidth(row, gallery.gap)).toBeCloseTo(gallery.containerWidth, 3);
    }
    expect(rows.reduce((n, row) => n + row.items.length, 0)).toBe(ratios.length);
  });

  it('leaves a short last row at the target height, left-aligned', () => {
    const { rows } = calculateJustifiedLayout([makeItem('a', 1), makeItem('b', 1)], gallery);
    expect(rows).toHaveLength(1);
    expect(rows[0].height).toBe(gallery.targetRowHeight);
    expect(rows[0].items.map((item) => item.x)).toEqual([0, 156]);
  });

  it('fits a single very wide picture into the width instead of a taller row', () => {
    const { rows } = calculateJustifiedLayout([makeItem('pano', 10)], gallery);
    expect(rows[0].height).toBeCloseTo(114.4, 3);
    expect(rows[0].items[0].width).toBeCloseTo(gallery.containerWidth, 3);
  });

  it('宽高比 0 → fallback 为 1', () => {
    const { rows } = calculateJustifiedLayout([makeItem('a', 0)], gallery);
    expect(rows[0].items[0].width).toBe(gallery.targetRowHeight);
  });

  it('contentHeight 应等于最后一行 y + height', () => {
    const items = Array.from({ length: 6 }, (_, i) => makeItem(`img-${i}`, 1.5));
    const result = calculateJustifiedLayout(items, baseOptions);
    const lastRow = result.rows[result.rows.length - 1];
    expect(result.contentHeight).toBeCloseTo(lastRow.y + lastRow.height, 0);
  });

  it('行间距 gap 应体现在 y 坐标递增', () => {
    const items = Array.from({ length: 6 }, (_, i) => makeItem(`img-${i}`, 1));
    const result = calculateJustifiedLayout(items, baseOptions);
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    const [row0, row1] = result.rows;
    expect(row1.y).toBeCloseTo(row0.y + row0.height + baseOptions.gap, 0);
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
