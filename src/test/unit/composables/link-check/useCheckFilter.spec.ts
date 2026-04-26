import { describe, it, expect, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { rowKey, useCheckFilter } from '../../../../composables/link-check/useCheckFilter';
import type { LinkCheckRow } from '../../../../types/linkCheck';

function clickEvent(shiftKey = false): MouseEvent {
  return { shiftKey } as MouseEvent;
}

// watchDebounced mock：替换为同步更新，方便直接设置 searchQuery
vi.mock('@vueuse/core', async (importOriginal) => {
  const { watch } = await import('vue');
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    watchDebounced: (source: Parameters<typeof watch>[0], cb: Parameters<typeof watch>[1]) => {
      watch(source, cb);
    },
  };
});

function makeRow(overrides: Partial<LinkCheckRow> = {}): LinkCheckRow {
  return {
    historyId: 'h1', serviceId: 'r2',
    url: 'https://r2.example.com/img.jpg',
    rawUrl: 'https://r2.example.com/img.jpg',
    fileName: 'img.jpg',
    ...overrides,
  };
}

function makeInvalidRow(overrides: Partial<LinkCheckRow> = {}): LinkCheckRow {
  return makeRow({
    checkResult: { link: '', is_valid: false, error_type: 'http_4xx', browser_might_work: false },
    ...overrides,
  });
}

function makeValidRow(overrides: Partial<LinkCheckRow> = {}): LinkCheckRow {
  return makeRow({
    checkResult: { link: '', is_valid: true, error_type: 'success', browser_might_work: false },
    ...overrides,
  });
}

// ─── scopedRows 筛选 ──────────────────────────────────────────────────────────

describe('scopedRows — 图床筛选', () => {
  it('selectedServiceId 为 null 时返回全部行', () => {
    const checkRows = ref([makeRow({ serviceId: 'r2' }), makeRow({ serviceId: 'github' })]);
    const { scopedRows } = useCheckFilter({ checkRows });
    expect(scopedRows.value).toHaveLength(2);
  });

  it('selectedServiceId 设置后只返回匹配图床的行', () => {
    const checkRows = ref([makeRow({ serviceId: 'r2' }), makeRow({ serviceId: 'github' })]);
    const { scopedRows, selectedServiceId } = useCheckFilter({ checkRows });
    selectedServiceId.value = 'r2';
    expect(scopedRows.value).toHaveLength(1);
    expect(scopedRows.value[0].serviceId).toBe('r2');
  });
});

describe('scopedRows — 搜索筛选', () => {
  it('searchQuery 匹配 url 时只返回匹配行', () => {
    const checkRows = ref([
      makeRow({ url: 'https://r2.example.com/cat.jpg', rawUrl: '', fileName: 'cat.jpg' }),
      makeRow({ url: 'https://github.com/dog.jpg', rawUrl: '', fileName: 'dog.jpg', serviceId: 'github' }),
    ]);
    const { scopedRows, searchQuery } = useCheckFilter({ checkRows });
    searchQuery.value = 'cat';
    expect(scopedRows.value).toHaveLength(1);
    expect(scopedRows.value[0].fileName).toBe('cat.jpg');
  });

  it('searchQuery 大小写不敏感', () => {
    const checkRows = ref([makeRow({ fileName: 'TestPhoto.jpg' })]);
    const { scopedRows, searchQuery } = useCheckFilter({ checkRows });
    searchQuery.value = 'testphoto';
    expect(scopedRows.value).toHaveLength(1);
  });

  it('searchQuery 为空时返回全部行', () => {
    const checkRows = ref([makeRow(), makeRow({ serviceId: 'github' })]);
    const { scopedRows, searchQuery } = useCheckFilter({ checkRows });
    searchQuery.value = '';
    expect(scopedRows.value).toHaveLength(2);
  });
});

// ─── filteredRows 状态筛选 ────────────────────────────────────────────────────

describe('filteredRows — statusFilter', () => {
  it('invalid：只返回 http 失效（非 timeout/suspicious）行', () => {
    const checkRows = ref([
      makeInvalidRow({ historyId: 'h1', checkResult: { link: '', is_valid: false, error_type: 'http_4xx', browser_might_work: false } }),
      makeRow({ historyId: 'h2', checkResult: { link: '', is_valid: false, error_type: 'timeout', browser_might_work: false } }),
      makeValidRow({ historyId: 'h3' }),
    ]);
    const { filteredRows, statusFilter } = useCheckFilter({ checkRows });
    statusFilter.value = 'invalid';
    expect(filteredRows.value).toHaveLength(1);
    expect(filteredRows.value[0].historyId).toBe('h1');
  });

  it('valid：只返回有效行', () => {
    const checkRows = ref([makeValidRow({ historyId: 'h1' }), makeInvalidRow({ historyId: 'h2' })]);
    const { filteredRows, statusFilter } = useCheckFilter({ checkRows });
    statusFilter.value = 'valid';
    expect(filteredRows.value).toHaveLength(1);
    expect(filteredRows.value[0].historyId).toBe('h1');
  });

  it('unchecked：只返回无 checkResult 的行', () => {
    const checkRows = ref([makeRow({ historyId: 'h1' }), makeValidRow({ historyId: 'h2' })]);
    const { filteredRows, statusFilter } = useCheckFilter({ checkRows });
    statusFilter.value = 'unchecked';
    expect(filteredRows.value).toHaveLength(1);
    expect(filteredRows.value[0].historyId).toBe('h1');
  });

  it('all：返回全部行', () => {
    const checkRows = ref([makeRow(), makeValidRow(), makeInvalidRow()]);
    const { filteredRows, statusFilter } = useCheckFilter({ checkRows });
    statusFilter.value = 'all';
    expect(filteredRows.value).toHaveLength(3);
  });

  it('suspicious：返回 browser_might_work 为 true 的行', () => {
    const checkRows = ref([
      makeRow({ historyId: 'h1', checkResult: { link: '', is_valid: false, error_type: 'http_4xx', browser_might_work: true } }),
      makeInvalidRow({ historyId: 'h2' }),
    ]);
    const { filteredRows, statusFilter } = useCheckFilter({ checkRows });
    statusFilter.value = 'suspicious';
    expect(filteredRows.value).toHaveLength(1);
    expect(filteredRows.value[0].historyId).toBe('h1');
  });

  it('timeout：只返回超时行', () => {
    const checkRows = ref([
      makeRow({ historyId: 'h1', checkResult: { link: '', is_valid: false, error_type: 'timeout', browser_might_work: false } }),
      makeInvalidRow({ historyId: 'h2' }),
    ]);
    const { filteredRows, statusFilter } = useCheckFilter({ checkRows });
    statusFilter.value = 'timeout';
    expect(filteredRows.value).toHaveLength(1);
    expect(filteredRows.value[0].historyId).toBe('h1');
  });
});

// ─── 分页 ────────────────────────────────────────────────────────────────────

describe('totalPages & visibleRows', () => {
  it('totalPages 最小为 1', () => {
    const checkRows = ref<LinkCheckRow[]>([]);
    const { totalPages, statusFilter } = useCheckFilter({ checkRows });
    statusFilter.value = 'all';
    expect(totalPages.value).toBe(1);
  });

  it('visibleRows 返回第一页（100 条）', () => {
    const checkRows = ref(
      Array.from({ length: 150 }, (_, i) =>
        makeValidRow({ historyId: `h${i}`, url: `https://r2.example.com/${i}.jpg`, rawUrl: '' }),
      ),
    );
    const { visibleRows, totalPages, statusFilter } = useCheckFilter({ checkRows });
    statusFilter.value = 'valid';
    expect(totalPages.value).toBe(2);
    expect(visibleRows.value).toHaveLength(100);
  });
});

describe('bottomSummary', () => {
  it('无结果时返回空字符串', () => {
    const checkRows = ref<LinkCheckRow[]>([]);
    const { bottomSummary, statusFilter } = useCheckFilter({ checkRows });
    statusFilter.value = 'all';
    expect(bottomSummary.value).toBe('');
  });

  it('有结果时显示数量', () => {
    const checkRows = ref([makeValidRow(), makeValidRow()]);
    const { bottomSummary, statusFilter } = useCheckFilter({ checkRows });
    statusFilter.value = 'valid';
    expect(bottomSummary.value).toContain('2');
  });
});

// ─── 选择逻辑 ─────────────────────────────────────────────────────────────────

describe('选择逻辑', () => {
  it('初始状态无选中', () => {
    const checkRows = ref([makeRow()]);
    const { hasSelection, selectedCount } = useCheckFilter({ checkRows });
    expect(hasSelection.value).toBe(false);
    expect(selectedCount.value).toBe(0);
  });

  it('handleToggleSelect 选中/取消选中（按 rowKey 作键）', () => {
    const checkRows = ref([makeValidRow({ historyId: 'h1', serviceId: 'r2' })]);
    const { handleToggleSelect, selectedIds, hasSelection, statusFilter } = useCheckFilter({ checkRows });
    statusFilter.value = 'valid';
    const key = rowKey({ historyId: 'h1', serviceId: 'r2' });

    handleToggleSelect(key, clickEvent());
    expect(selectedIds.value.has(key)).toBe(true);
    expect(hasSelection.value).toBe(true);

    handleToggleSelect(key, clickEvent());
    expect(selectedIds.value.has(key)).toBe(false);
  });

  it('同一 historyId 的不同 serviceId 是两条独立选中', () => {
    const checkRows = ref([
      makeValidRow({ historyId: 'h1', serviceId: 'r2' }),
      makeValidRow({ historyId: 'h1', serviceId: 'github' }),
    ]);
    const { toggleSelectAll, selectedCount, statusFilter } = useCheckFilter({ checkRows });
    statusFilter.value = 'valid';

    toggleSelectAll();
    expect(selectedCount.value).toBe(2);
  });

  it('clearSelection 清空所有选中', () => {
    const checkRows = ref([
      makeValidRow({ historyId: 'h1', serviceId: 'r2' }),
      makeValidRow({ historyId: 'h2', serviceId: 'r2' }),
    ]);
    const { handleToggleSelect, clearSelection, hasSelection, statusFilter } = useCheckFilter({ checkRows });
    statusFilter.value = 'valid';
    handleToggleSelect(rowKey({ historyId: 'h1', serviceId: 'r2' }), clickEvent());
    handleToggleSelect(rowKey({ historyId: 'h2', serviceId: 'r2' }), clickEvent());
    clearSelection();
    expect(hasSelection.value).toBe(false);
  });

  it('toggleSelectAll 全选和取消全选', () => {
    const checkRows = ref([makeValidRow({ historyId: 'h1' }), makeValidRow({ historyId: 'h2' })]);
    const { toggleSelectAll, isAllSelected, statusFilter } = useCheckFilter({ checkRows });
    statusFilter.value = 'valid';

    toggleSelectAll();
    expect(isAllSelected.value).toBe(true);

    toggleSelectAll();
    expect(isAllSelected.value).toBe(false);
  });
});

describe('held rows in unchecked filter', () => {
  it('keeps recently completed rows during the source-tab hold', () => {
    const checkRows = ref([
      makeRow({ historyId: 'h1' }),
      makeValidRow({ historyId: 'h2', recentlyCompletedAt: Date.now() }),
    ]);
    const { filteredRows, statusFilter } = useCheckFilter({ checkRows });
    statusFilter.value = 'unchecked';
    expect(filteredRows.value.map((row) => row.historyId)).toEqual(['h1', 'h2']);
  });

  it('keeps held invalid rows in their original source order', () => {
    const checkRows = ref([
      makeRow({ historyId: 'h1' }),
      makeInvalidRow({ historyId: 'h2', recentlyCompletedAt: Date.now() }),
      makeRow({ historyId: 'h3' }),
    ]);
    const { filteredRows, statusFilter } = useCheckFilter({ checkRows });
    statusFilter.value = 'unchecked';
    expect(filteredRows.value.map((row) => row.historyId)).toEqual(['h1', 'h2', 'h3']);
  });
});

describe('high throughput display snapshot', () => {
  it('batches target-tab membership changes for 400ms', async () => {
    vi.useFakeTimers();
    try {
      const isHighThroughput = ref(false);
      const checkRows = ref<LinkCheckRow[]>([]);
      const { filteredRows, statusFilter, suppressListMotion } = useCheckFilter({ checkRows, isHighThroughput });

      statusFilter.value = 'valid';
      await nextTick();
      isHighThroughput.value = true;
      await nextTick();

      checkRows.value = [makeValidRow({ historyId: 'h1' })];
      await nextTick();

      expect(suppressListMotion.value).toBe(true);
      expect(filteredRows.value).toHaveLength(0);

      vi.advanceTimersByTime(399);
      await nextTick();
      expect(filteredRows.value).toHaveLength(0);

      vi.advanceTimersByTime(1);
      await nextTick();
      expect(filteredRows.value.map((row) => row.historyId)).toEqual(['h1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('commits immediately when the user changes filter scope', async () => {
    vi.useFakeTimers();
    try {
      const isHighThroughput = ref(true);
      const checkRows = ref([
        makeInvalidRow({ historyId: 'h1' }),
        makeValidRow({ historyId: 'h2' }),
      ]);
      const { filteredRows, statusFilter } = useCheckFilter({ checkRows, isHighThroughput });

      await nextTick();
      expect(filteredRows.value.map((row) => row.historyId)).toEqual(['h1']);

      statusFilter.value = 'valid';
      await nextTick();
      expect(filteredRows.value.map((row) => row.historyId)).toEqual(['h2']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops unchecked leaving rows from the next high-throughput snapshot', async () => {
    const isHighThroughput = ref(true);
    const checkRows = ref([
      makeRow({ historyId: 'h1' }),
      makeValidRow({ historyId: 'h2', recentlyCompletedAt: Date.now() }),
      makeInvalidRow({ historyId: 'h3', recentlyCompletedAt: Date.now(), uncheckedLeavingAt: Date.now() }),
    ]);
    const { filteredRows, statusFilter, suppressListMotion } = useCheckFilter({ checkRows, isHighThroughput });

    statusFilter.value = 'unchecked';
    await nextTick();

    expect(suppressListMotion.value).toBe(true);
    expect(filteredRows.value.map((row) => row.historyId)).toEqual(['h1', 'h2']);
  });
});

describe('checking snapshot filter behavior', () => {
  it('keeps the current filtered list stable while checking', async () => {
    const isChecking = ref(false);
    const checkRows = ref([
      makeRow({ historyId: 'h1' }),
      makeRow({ historyId: 'h2' }),
    ]);
    const { filteredRows, statusFilter, suppressListMotion } = useCheckFilter({ checkRows, isChecking });

    statusFilter.value = 'unchecked';
    await nextTick();
    isChecking.value = true;
    await nextTick();

    checkRows.value = [
      makeValidRow({ historyId: 'h1' }),
      makeRow({ historyId: 'h2' }),
      makeRow({ historyId: 'h3' }),
    ];
    await nextTick();

    expect(filteredRows.value.map((row) => row.historyId)).toEqual(['h1', 'h2']);
    expect(suppressListMotion.value).toBe(true);
  });

  it('auto applies the current filter shortly after checking ends', async () => {
    vi.useFakeTimers();
    try {
      const isChecking = ref(false);
      const checkRows = ref([
        makeRow({ historyId: 'h1' }),
        makeRow({ historyId: 'h2' }),
      ]);
      const { filteredRows, statusFilter } = useCheckFilter({ checkRows, isChecking });

      statusFilter.value = 'unchecked';
      await nextTick();
      isChecking.value = true;
      await nextTick();

      checkRows.value = [
        makeValidRow({ historyId: 'h1', recentlyCompletedAt: Date.now() }),
        makeRow({ historyId: 'h2' }),
      ];
      await nextTick();
      expect(filteredRows.value.map((row) => row.historyId)).toEqual(['h1', 'h2']);

      isChecking.value = false;
      await nextTick();
      vi.advanceTimersByTime(449);
      await nextTick();
      expect(filteredRows.value.map((row) => row.historyId)).toEqual(['h1', 'h2']);

      vi.advanceTimersByTime(1);
      await nextTick();
      expect(filteredRows.value.map((row) => row.historyId)).toEqual(['h2']);

      checkRows.value = [
        makeValidRow({ historyId: 'h1', recentlyCompletedAt: Date.now(), uncheckedLeavingAt: Date.now() }),
        makeRow({ historyId: 'h2' }),
      ];
      await nextTick();
      expect(filteredRows.value.map((row) => row.historyId)).toEqual(['h2']);
    } finally {
      vi.useRealTimers();
    }
  });
});
