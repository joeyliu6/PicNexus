import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { useVisibleArea } from '@/composables/timeline/useVisibleArea';
import type { TimelineLayoutResult, LayoutedItem, LayoutRow } from '@/utils/justifiedLayout';
import type { PhotoGroup } from '@/composables/timeline/types';
import { DEFAULT_OPTIONS } from '@/composables/timeline/types';
import type { ImageMeta } from '@/types/image-meta';

// ─── 测试辅助 ─────────────────────────────────────────────────────────────────

function makeMeta(id: string): ImageMeta {
  return {
    id,
    timestamp: Date.now(),
    localFileName: `${id}.jpg`,
    aspectRatio: 1.5,
    primaryService: 'r2' as import('@/config/types').ServiceType,
    primaryUrl: `https://r2.example.com/${id}.jpg`,
  };
}

function makeLayoutItem(id: string, x = 0, y = 0, width = 200, height = 150): LayoutedItem {
  return { id, x, y, width, height };
}

function makeRow(items: LayoutedItem[], y = 0): LayoutRow {
  return { y, height: 150, items };
}

function makeLayoutResult(overrides: Partial<TimelineLayoutResult> = {}): TimelineLayoutResult {
  const item1 = makeLayoutItem('img-1', 0, 0);
  const item2 = makeLayoutItem('img-2', 204, 0);
  const row1: LayoutRow = makeRow([item1, item2], 48); // after header (48px)
  const row2: LayoutRow = makeRow([makeLayoutItem('img-3', 0, 202)], 202);

  return {
    groupLayouts: [
      {
        groupId: 'g1',
        label: '2024年5月15日',
        headerY: 0,
        headerHeight: 48,
        contentY: 48,
        contentHeight: 500,
        rows: [row1, row2],
        itemCount: 3,
      },
    ],
    totalHeight: 600,
    itemPositionMap: new Map([
      ['img-1', { y: 0, height: 150, groupId: 'g1' }],
      ['img-2', { y: 0, height: 150, groupId: 'g1' }],
      ['img-3', { y: 202, height: 150, groupId: 'g1' }],
    ]),
    allRows: [
      { groupId: 'g1', row: row1, globalRowIndex: 0 },
      { groupId: 'g1', row: row2, globalRowIndex: 1 },
    ],
    ...overrides,
  };
}

function makeGroups(): PhotoGroup[] {
  return [
    {
      id: 'g1',
      label: '2024年5月15日',
      year: 2024, month: 4, day: 15,
      date: new Date('2024-05-15'),
      items: [makeMeta('img-1'), makeMeta('img-2'), makeMeta('img-3')],
    },
  ];
}

// ─── layoutResult = null 时的默认值 ──────────────────────────────────────────

describe('useVisibleArea — 无布局时的默认值', () => {
  it('visibleRowRange 为 [0, 0]', () => {
    const { visibleRowRange } = useVisibleArea(ref(0), ref(600), ref(null), ref([]), ref(null), DEFAULT_OPTIONS);
    expect(visibleRowRange.value).toEqual([0, 0]);
  });

  it('visibleItems 为空数组', () => {
    const { visibleItems } = useVisibleArea(ref(0), ref(600), ref(null), ref([]), ref(null), DEFAULT_OPTIONS);
    expect(visibleItems.value).toHaveLength(0);
  });

  it('visibleHeaders 为空数组', () => {
    const { visibleHeaders } = useVisibleArea(ref(0), ref(600), ref(null), ref([]), ref(null), DEFAULT_OPTIONS);
    expect(visibleHeaders.value).toHaveLength(0);
  });

  it('currentStickyHeader 为 null', () => {
    const { currentStickyHeader } = useVisibleArea(ref(0), ref(600), ref(null), ref([]), ref(null), DEFAULT_OPTIONS);
    expect(currentStickyHeader.value).toBeNull();
  });

  it('totalHeight 为 0', () => {
    const { totalHeight } = useVisibleArea(ref(0), ref(600), ref(null), ref([]), ref(null), DEFAULT_OPTIONS);
    expect(totalHeight.value).toBe(0);
  });

  it('scrollProgress 为 0（无容器）', () => {
    const { scrollProgress } = useVisibleArea(ref(0), ref(600), ref(null), ref([]), ref(null), DEFAULT_OPTIONS);
    expect(scrollProgress.value).toBe(0);
  });
});

// ─── 有布局结果时的计算 ───────────────────────────────────────────────────────

describe('useVisibleArea — 有布局时', () => {
  it('totalHeight 来自 layoutResult.totalHeight', () => {
    const layout = ref(makeLayoutResult({ totalHeight: 1200 }));
    const { totalHeight } = useVisibleArea(ref(0), ref(600), layout, ref(makeGroups()), ref(null), DEFAULT_OPTIONS);
    expect(totalHeight.value).toBe(1200);
  });

  it('visibleItems 包含可见行中的图片', () => {
    const layout = ref(makeLayoutResult());
    const groups = ref(makeGroups());
    const { visibleItems } = useVisibleArea(ref(0), ref(600), layout, groups, ref(null), DEFAULT_OPTIONS);
    expect(visibleItems.value.length).toBeGreaterThan(0);
    const ids = visibleItems.value.map(item => item.meta.id);
    expect(ids).toContain('img-1');
  });

  it('visibleItems 包含正确的位置信息', () => {
    const layout = ref(makeLayoutResult());
    const groups = ref(makeGroups());
    const { visibleItems } = useVisibleArea(ref(0), ref(600), layout, groups, ref(null), DEFAULT_OPTIONS);
    const item = visibleItems.value.find(v => v.meta.id === 'img-1');
    expect(item).toBeDefined();
    expect(item!.x).toBe(0);
    expect(item!.y).toBe(0);
    expect(item!.width).toBe(200);
  });

  it('visibleHeaders 包含可见分组头部', () => {
    const layout = ref(makeLayoutResult());
    const groups = ref(makeGroups());
    const { visibleHeaders } = useVisibleArea(ref(0), ref(600), layout, groups, ref(null), DEFAULT_OPTIONS);
    expect(visibleHeaders.value.length).toBeGreaterThan(0);
    expect(visibleHeaders.value[0].groupId).toBe('g1');
  });
});

// ─── scrollProgress ───────────────────────────────────────────────────────────

describe('scrollProgress', () => {
  it('无 container 时为 0', () => {
    const layout = ref(makeLayoutResult({ totalHeight: 1000 }));
    const { scrollProgress } = useVisibleArea(ref(0), ref(600), layout, ref([]), ref(null), DEFAULT_OPTIONS);
    expect(scrollProgress.value).toBe(0);
  });

  it('有 container 时按滚动位置计算进度', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollTop', { get: () => 0, configurable: true });
    const layout = ref(makeLayoutResult({ totalHeight: 1000 }));
    const scrollTop = ref(200);
    const viewportHeight = ref(400);
    const { scrollProgress } = useVisibleArea(scrollTop, viewportHeight, layout, ref([]), ref(container), DEFAULT_OPTIONS);
    // maxScroll = 1000 - 400 = 600, progress = 200/600 ≈ 0.333
    expect(scrollProgress.value).toBeCloseTo(1 / 3, 2);
  });

  it('scrollProgress 不超过 1', () => {
    const container = document.createElement('div');
    const layout = ref(makeLayoutResult({ totalHeight: 1000 }));
    const scrollTop = ref(900);
    const viewportHeight = ref(400);
    const { scrollProgress } = useVisibleArea(scrollTop, viewportHeight, layout, ref([]), ref(container), DEFAULT_OPTIONS);
    expect(scrollProgress.value).toBeLessThanOrEqual(1);
  });
});
