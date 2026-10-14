import { describe, expect, it } from 'vitest';
import { estimateText, remainingText } from '@/utils/durationText';

describe('durationText', () => {
  it('进行中说「还要多久」：不到一分钟不报秒数，超过一小时拆成小时和分钟', () => {
    expect(remainingText(40)).toBe('预计不到 1 分钟');
    expect(remainingText(150)).toBe('预计还要 3 分钟');
    expect(remainingText(3600)).toBe('预计还要 1 小时');
    expect(remainingText(5400)).toBe('预计还要 1 小时 30 分钟');
  });

  it('开始前说「大约多久」', () => {
    expect(estimateText(30)).toBe('1 分钟以内');
    expect(estimateText(572)).toBe('大约 10 分钟');
    expect(estimateText(7800)).toBe('大约 2 小时 10 分钟');
  });
});
