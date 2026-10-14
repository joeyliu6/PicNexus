import { describe, it, expect } from 'vitest';
import { ref, computed } from 'vue';
import { useCheckStrategy } from '@/composables/link-check/useCheckStrategy';
import type { CheckStatsResult } from '@/composables/link-check/useCheckStats';
import type { StatusFilter } from '@/types/linkCheck';

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
