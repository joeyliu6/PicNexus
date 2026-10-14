import { describe, expect, it } from 'vitest';
import { progressLabel } from '@/components/views/link-check/common/progressLabel';

describe('progressLabel', () => {
  it('带上「已处理 / 总数」', () => {
    expect(progressLabel('检测中', 12, 17)).toBe('检测中 12 / 17');
    expect(progressLabel('迁移中', 1200, 3400)).toBe('迁移中 1,200 / 3,400');
  });

  it('总数未知时只显示状态词；已处理数夹在 0..总数 之间', () => {
    expect(progressLabel('检测中', 0, 0)).toBe('检测中');
    expect(progressLabel('检测中', 20, 17)).toBe('检测中 17 / 17');
    expect(progressLabel('检测中', -1, 17)).toBe('检测中 0 / 17');
  });
});
