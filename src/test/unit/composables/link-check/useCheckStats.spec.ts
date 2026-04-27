import { describe, it, expect, vi } from 'vitest';
import { ref, computed, nextTick } from 'vue';
import { useCheckStats } from '../../../../composables/link-check/useCheckStats';
import type { LinkCheckRow, BatchCheckProgress } from '../../../../types/linkCheck';

function makeRow(overrides: Partial<LinkCheckRow> = {}): LinkCheckRow {
  return {
    historyId: 'h1', serviceId: 'r2',
    url: 'https://r2.example.com/img.jpg', rawUrl: 'https://r2.example.com/img.jpg',
    fileName: 'img.jpg',
    ...overrides,
  };
}

describe('useCheckStats — stats', () => {
  it('全部未检测时 unchecked = total, others = 0', () => {
    const rows = ref([makeRow(), makeRow({ serviceId: 'github' })]);
    const { stats } = useCheckStats({ scopedRows: computed(() => rows.value), checkRows: rows, progress: ref(null) });
    expect(stats.value.total).toBe(2);
    expect(stats.value.unchecked).toBe(2);
    expect(stats.value.valid).toBe(0);
    expect(stats.value.checked).toBe(0);
    expect(stats.value.problems).toBe(0);
  });

  it('有效链接计入 valid', () => {
    const rows = ref([makeRow({ checkResult: { link: '', is_valid: true, error_type: 'success', browser_might_work: false } })]);
    const { stats } = useCheckStats({ scopedRows: computed(() => rows.value), checkRows: rows, progress: ref(null) });
    expect(stats.value.valid).toBe(1);
    expect(stats.value.invalid).toBe(0);
    expect(stats.value.checked).toBe(1);
  });

  it('超时链接计入 timeout 和 problems', () => {
    const rows = ref([makeRow({ checkResult: { link: '', is_valid: false, error_type: 'timeout', browser_might_work: false } })]);
    const { stats } = useCheckStats({ scopedRows: computed(() => rows.value), checkRows: rows, progress: ref(null) });
    expect(stats.value.timeout).toBe(1);
    expect(stats.value.problems).toBe(1);
    expect(stats.value.invalid).toBe(0);
  });

  it('可疑链接（suspicious）计入 suspicious 和 problems', () => {
    const rows = ref([makeRow({ checkResult: { link: '', is_valid: false, error_type: 'suspicious', browser_might_work: false } })]);
    const { stats } = useCheckStats({ scopedRows: computed(() => rows.value), checkRows: rows, progress: ref(null) });
    expect(stats.value.suspicious).toBe(1);
    expect(stats.value.problems).toBe(1);
  });

  it('browser_might_work 也计入 suspicious', () => {
    const rows = ref([makeRow({ checkResult: { link: '', is_valid: false, error_type: 'http_4xx', browser_might_work: true } })]);
    const { stats } = useCheckStats({ scopedRows: computed(() => rows.value), checkRows: rows, progress: ref(null) });
    expect(stats.value.suspicious).toBe(1);
  });

  it('失效链接（http_4xx）计入 invalid', () => {
    const rows = ref([makeRow({ checkResult: { link: '', is_valid: false, error_type: 'http_4xx', browser_might_work: false } })]);
    const { stats } = useCheckStats({ scopedRows: computed(() => rows.value), checkRows: rows, progress: ref(null) });
    expect(stats.value.invalid).toBe(1);
    expect(stats.value.problems).toBe(1);
  });

  it('problems = invalid + timeout + suspicious', () => {
    const rows = ref([
      makeRow({ checkResult: { link: '', is_valid: false, error_type: 'http_4xx', browser_might_work: false } }),
      makeRow({ checkResult: { link: '', is_valid: false, error_type: 'timeout', browser_might_work: false } }),
      makeRow({ checkResult: { link: '', is_valid: false, error_type: 'suspicious', browser_might_work: false } }),
    ]);
    const { stats } = useCheckStats({ scopedRows: computed(() => rows.value), checkRows: rows, progress: ref(null) });
    expect(stats.value.problems).toBe(3);
  });
});

describe('useCheckStats high throughput mode', () => {
  it('enters high throughput mode when smoothed rate reaches 12/s', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(100);
      const rows = ref<LinkCheckRow[]>([]);
      const progress = ref<BatchCheckProgress | null>(null);
      const { isHighThroughput } = useCheckStats({ scopedRows: computed(() => rows.value), checkRows: rows, progress });

      progress.value = { checked: 0, total: 100, current_url: '' };
      await nextTick();
      vi.setSystemTime(1100);
      progress.value = { checked: 20, total: 100, current_url: '' };
      await nextTick();

      expect(isHighThroughput.value).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exits high throughput mode when smoothed rate falls to 6/s', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(100);
      const rows = ref<LinkCheckRow[]>([]);
      const progress = ref<BatchCheckProgress | null>(null);
      const { isHighThroughput } = useCheckStats({ scopedRows: computed(() => rows.value), checkRows: rows, progress });

      progress.value = { checked: 0, total: 100, current_url: '' };
      await nextTick();
      vi.setSystemTime(1100);
      progress.value = { checked: 20, total: 100, current_url: '' };
      await nextTick();
      expect(isHighThroughput.value).toBe(true);

      for (const [time, checked] of [[2100, 21], [3100, 22], [4100, 23], [5100, 24]] as const) {
        vi.setSystemTime(time);
        progress.value = { checked, total: 100, current_url: '' };
        await nextTick();
      }

      expect(isHighThroughput.value).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets high throughput mode when progress is cleared', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(100);
      const rows = ref<LinkCheckRow[]>([]);
      const progress = ref<BatchCheckProgress | null>(null);
      const { isHighThroughput } = useCheckStats({ scopedRows: computed(() => rows.value), checkRows: rows, progress });

      progress.value = { checked: 0, total: 100, current_url: '' };
      await nextTick();
      vi.setSystemTime(1100);
      progress.value = { checked: 20, total: 100, current_url: '' };
      await nextTick();
      expect(isHighThroughput.value).toBe(true);

      progress.value = null;
      await nextTick();

      expect(isHighThroughput.value).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useCheckStats — serviceList', () => {
  it('按图床统计数量并降序排列', () => {
    const rows = ref([
      makeRow({ serviceId: 'r2' }),
      makeRow({ serviceId: 'r2' }),
      makeRow({ serviceId: 'github' }),
    ]);
    const { serviceList } = useCheckStats({ scopedRows: computed(() => rows.value), checkRows: rows, progress: ref(null) });
    expect(serviceList.value[0].id).toBe('r2');
    expect(serviceList.value[0].count).toBe(2);
    expect(serviceList.value[1].id).toBe('github');
    expect(serviceList.value[1].count).toBe(1);
  });

  it('空 checkRows 时返回空列表', () => {
    const rows = ref<LinkCheckRow[]>([]);
    const { serviceList } = useCheckStats({ scopedRows: computed(() => rows.value), checkRows: rows, progress: ref(null) });
    expect(serviceList.value).toHaveLength(0);
  });
});

describe('useCheckStats — progressPercent', () => {
  it('progress 为 null 时返回 0', () => {
    const rows = ref<LinkCheckRow[]>([]);
    const { progressPercent } = useCheckStats({ scopedRows: computed(() => rows.value), checkRows: rows, progress: ref(null) });
    expect(progressPercent.value).toBe(0);
  });

  it('total 为 0 时返回 0', () => {
    const rows = ref<LinkCheckRow[]>([]);
    const progress = ref<BatchCheckProgress | null>({ checked: 0, total: 0, current_url: '' });
    const { progressPercent } = useCheckStats({ scopedRows: computed(() => rows.value), checkRows: rows, progress });
    expect(progressPercent.value).toBe(0);
  });

  it('正常进度百分比计算', () => {
    const rows = ref<LinkCheckRow[]>([]);
    const progress = ref<BatchCheckProgress | null>({ checked: 50, total: 100, current_url: '' });
    const { progressPercent } = useCheckStats({ scopedRows: computed(() => rows.value), checkRows: rows, progress });
    expect(progressPercent.value).toBe(50);
  });

  it('超过 100% 时截断为 100', () => {
    const rows = ref<LinkCheckRow[]>([]);
    const progress = ref<BatchCheckProgress | null>({ checked: 120, total: 100, current_url: '' });
    const { progressPercent } = useCheckStats({ scopedRows: computed(() => rows.value), checkRows: rows, progress });
    expect(progressPercent.value).toBe(100);
  });
});

describe('useCheckStats — progressTooltip', () => {
  it('progress 为 null 时显示"准备检测..."', () => {
    const rows = ref<LinkCheckRow[]>([]);
    const { progressTooltip } = useCheckStats({ scopedRows: computed(() => rows.value), checkRows: rows, progress: ref(null) });
    expect(progressTooltip.value).toBe('准备检测...');
  });

  it('有进度时显示已检测 / 总数', () => {
    const rows = ref<LinkCheckRow[]>([]);
    const progress = ref<BatchCheckProgress | null>({ checked: 30, total: 100, current_url: '' });
    const { progressTooltip } = useCheckStats({ scopedRows: computed(() => rows.value), checkRows: rows, progress });
    expect(progressTooltip.value).toContain('30');
    expect(progressTooltip.value).toContain('100');
  });

  it('结构化 tooltip 包含完成数、结果统计、速度、ETA 和失速提示', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(100);
      const rows = ref<LinkCheckRow[]>([
        makeRow({ checkResult: { link: '', is_valid: true, error_type: 'success', browser_might_work: false } }),
        makeRow({ checkResult: { link: '', is_valid: false, error_type: 'network', browser_might_work: false } }),
        makeRow({ checkResult: { link: '', is_valid: false, error_type: 'suspicious', browser_might_work: true } }),
      ]);
      const progress = ref<BatchCheckProgress | null>(null);
      const { progressTooltipDetails } = useCheckStats({ scopedRows: computed(() => rows.value), checkRows: rows, progress });

      progress.value = { checked: 0, total: 100, current_url: '' };
      await nextTick();
      vi.setSystemTime(1100);
      progress.value = { checked: 20, total: 100, current_url: '' };
      await nextTick();

      expect(progressTooltipDetails.value.items).toContainEqual({ label: '已完成', value: '20 / 100' });
      expect(progressTooltipDetails.value.items).toContainEqual({ label: '完成度', value: '20%' });
      expect(progressTooltipDetails.value.items).toContainEqual({ label: '正常', value: '1', tone: 'success' });
      expect(progressTooltipDetails.value.items).toContainEqual({ label: '失败', value: '1', tone: 'danger' });
      expect(progressTooltipDetails.value.items).toContainEqual({ label: '可疑', value: '1', tone: 'warning' });
      expect(progressTooltipDetails.value.items).toContainEqual({ label: '速度', value: '20/s' });
      expect(progressTooltipDetails.value.items).toContainEqual({ label: '预计剩余', value: '4s' });

      vi.advanceTimersByTime(10_000);
      await nextTick();

      expect(progressTooltipDetails.value.notes).toContain('正在等待较慢的域名响应');
    } finally {
      vi.useRealTimers();
    }
  });
});
