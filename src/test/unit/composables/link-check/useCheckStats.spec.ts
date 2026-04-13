import { describe, it, expect } from 'vitest';
import { ref, computed } from 'vue';
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
});
