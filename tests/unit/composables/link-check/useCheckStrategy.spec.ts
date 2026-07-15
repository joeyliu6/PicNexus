import { describe, it, expect } from 'vitest';
import { ref, computed } from 'vue';
import { useCheckStrategy } from '@/composables/link-check/useCheckStrategy';
import type { CheckStatsResult } from '@/composables/link-check/useCheckStats';
import type { StatusFilter, LinkCheckRow } from '@/types/linkCheck';

function makeStats(overrides: Partial<CheckStatsResult> = {}): CheckStatsResult {
  return {
    total: 10, valid: 5, invalid: 2, timeout: 1, suspicious: 1,
    unchecked: 1, checked: 9, problems: 4,
    ...overrides,
  };
}

function makeStrategy(statsOverrides?: Partial<CheckStatsResult>, filter: StatusFilter = null) {
  const stats = computed(() => makeStats(statsOverrides));
  const statusFilter = ref<StatusFilter>(filter);
  return { ...useCheckStrategy({ stats, statusFilter }), statusFilter };
}

// ─── smartCheckLabel ──────────────────────────────────────────────────────────

describe('smartCheckLabel', () => {
  it('全部未检测时显示"开始检测"', () => {
    const { smartCheckLabel } = makeStrategy({ total: 5, unchecked: 5 });
    expect(smartCheckLabel.value).toBe('开始检测');
  });

  it('部分未检测时显示"继续检测"', () => {
    const { smartCheckLabel } = makeStrategy({ total: 10, unchecked: 3, problems: 0 });
    expect(smartCheckLabel.value).toBe('继续检测');
  });

  it('全部已检测且有问题时显示"重检问题"（计数已挪到徽章）', () => {
    const { smartCheckLabel } = makeStrategy({ total: 10, unchecked: 0, problems: 3 });
    expect(smartCheckLabel.value).toBe('重检问题');
  });

  it('全部已检测且无问题时显示"重检全部"', () => {
    const { smartCheckLabel } = makeStrategy({ total: 5, unchecked: 0, problems: 0 });
    expect(smartCheckLabel.value).toBe('重检全部');
  });

  it('筛选器为 invalid 时显示"重检失效"', () => {
    const stats = computed(() => makeStats({ invalid: 4 }));
    const statusFilter = ref<StatusFilter>('invalid');
    const { smartCheckLabel } = useCheckStrategy({ stats, statusFilter });
    expect(smartCheckLabel.value).toBe('重检失效');
  });

  it('筛选器为 unchecked 时显示"开始检测"', () => {
    const stats = computed(() => makeStats({ unchecked: 7 }));
    const statusFilter = ref<StatusFilter>('unchecked');
    const { smartCheckLabel } = useCheckStrategy({ stats, statusFilter });
    expect(smartCheckLabel.value).toBe('开始检测');
  });

  it('筛选器为 problems 时显示"重检问题"', () => {
    const stats = computed(() => makeStats({ problems: 7 }));
    const statusFilter = ref<StatusFilter>('problems');
    const { smartCheckLabel } = useCheckStrategy({ stats, statusFilter });
    expect(smartCheckLabel.value).toBe('重检问题');
  });
});

// ─── resolveSmartCheck ────────────────────────────────────────────────────────

describe('resolveSmartCheck', () => {
  it('全部未检测时返回 check-all', () => {
    const { resolveSmartCheck } = makeStrategy({ total: 5, unchecked: 5 });
    expect(resolveSmartCheck()).toEqual({ action: 'check-all' });
  });

  it('有未检测时返回 check-subset + unchecked', () => {
    const { resolveSmartCheck } = makeStrategy({ total: 10, unchecked: 3, problems: 0 });
    expect(resolveSmartCheck()).toEqual({ action: 'check-subset', filter: 'unchecked' });
  });

  it('全检测有问题时返回 check-subset + problems', () => {
    const { resolveSmartCheck } = makeStrategy({ total: 10, unchecked: 0, problems: 3 });
    expect(resolveSmartCheck()).toEqual({ action: 'check-subset', filter: 'problems' });
  });

  it('全检测无问题时返回 check-all', () => {
    const { resolveSmartCheck } = makeStrategy({ total: 5, unchecked: 0, problems: 0 });
    expect(resolveSmartCheck()).toEqual({ action: 'check-all' });
  });

  it('筛选器为 invalid 时返回 check-subset + invalid', () => {
    const stats = computed(() => makeStats({ invalid: 2 }));
    const statusFilter = ref<StatusFilter>('invalid');
    const { resolveSmartCheck } = useCheckStrategy({ stats, statusFilter });
    expect(resolveSmartCheck()).toEqual({ action: 'check-subset', filter: 'invalid' });
  });

  it('筛选器为 problems 时返回 check-subset + problems', () => {
    const stats = computed(() => makeStats({ problems: 4 }));
    const statusFilter = ref<StatusFilter>('problems');
    const { resolveSmartCheck } = useCheckStrategy({ stats, statusFilter });
    expect(resolveSmartCheck()).toEqual({ action: 'check-subset', filter: 'problems' });
  });
});

// ─── 行状态展示函数 ────────────────────────────────────────────────────────────

describe('statusDotColor', () => {
  const { statusDotColor } = makeStrategy();

  it('未检测时返回 tertiary 颜色', () => {
    const row: LinkCheckRow = { historyId: 'h1', serviceId: 'r2', url: '', rawUrl: '', fileName: '' };
    expect(statusDotColor(row)).toBe('var(--text-tertiary)');
  });

  it('有效时返回 success 颜色', () => {
    const row: LinkCheckRow = {
      historyId: 'h1', serviceId: 'r2', url: '', rawUrl: '', fileName: '',
      checkResult: { link: '', is_valid: true, error_type: 'success', browser_might_work: false },
    };
    expect(statusDotColor(row)).toBe('var(--success)');
  });

  it('超时时返回 warning 颜色', () => {
    const row: LinkCheckRow = {
      historyId: 'h1', serviceId: 'r2', url: '', rawUrl: '', fileName: '',
      checkResult: { link: '', is_valid: false, error_type: 'timeout', browser_might_work: false },
    };
    expect(statusDotColor(row)).toBe('var(--warning)');
  });

  it('失效时返回 error 颜色', () => {
    const row: LinkCheckRow = {
      historyId: 'h1', serviceId: 'r2', url: '', rawUrl: '', fileName: '',
      checkResult: { link: '', is_valid: false, error_type: 'http_4xx', browser_might_work: false },
    };
    expect(statusDotColor(row)).toBe('var(--error)');
  });
});

describe('errorLabel', () => {
  const { errorLabel } = makeStrategy();

  it('未检测时返回 —', () => {
    const row: LinkCheckRow = { historyId: 'h1', serviceId: 'r2', url: '', rawUrl: '', fileName: '' };
    expect(errorLabel(row)).toBe('—');
  });

  it('有效且有状态码时返回状态码字符串', () => {
    const row: LinkCheckRow = {
      historyId: 'h1', serviceId: 'r2', url: '', rawUrl: '', fileName: '',
      checkResult: { link: '', is_valid: true, status_code: 200, error_type: 'success', browser_might_work: false },
    };
    expect(errorLabel(row)).toBe('200');
  });

  it('超时时返回"超时"', () => {
    const row: LinkCheckRow = {
      historyId: 'h1', serviceId: 'r2', url: '', rawUrl: '', fileName: '',
      checkResult: { link: '', is_valid: false, error_type: 'timeout', browser_might_work: false },
    };
    expect(errorLabel(row)).toBe('超时');
  });

  it('失效时返回"失效"', () => {
    const row: LinkCheckRow = {
      historyId: 'h1', serviceId: 'r2', url: '', rawUrl: '', fileName: '',
      checkResult: { link: '', is_valid: false, error_type: 'http_4xx', browser_might_work: false },
    };
    expect(errorLabel(row)).toBe('失效');
  });

  it('recheckResult 优先于 checkResult', () => {
    const row: LinkCheckRow = {
      historyId: 'h1', serviceId: 'r2', url: '', rawUrl: '', fileName: '',
      checkResult: { link: '', is_valid: false, error_type: 'http_4xx', browser_might_work: false },
      recheckResult: { link: '', is_valid: true, status_code: 200, error_type: 'success', browser_might_work: false },
    };
    expect(errorLabel(row)).toBe('200');
  });
});

describe('recheckLabel', () => {
  const { recheckLabel } = makeStrategy();

  it('有效时返回"可用"', () => {
    expect(recheckLabel({ link: '', is_valid: true, error_type: 'success', browser_might_work: false })).toBe('可用');
  });

  it('超时时返回"超时"', () => {
    expect(recheckLabel({ link: '', is_valid: false, error_type: 'timeout', browser_might_work: false })).toBe('超时');
  });

  it('网络错误时返回"断连"', () => {
    expect(recheckLabel({ link: '', is_valid: false, error_type: 'network', browser_might_work: false })).toBe('断连');
  });

  it('失效时返回"失效"', () => {
    expect(recheckLabel({ link: '', is_valid: false, error_type: 'http_4xx', browser_might_work: false })).toBe('失效');
  });
});
