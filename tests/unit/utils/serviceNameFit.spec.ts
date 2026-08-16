import { describe, expect, it } from 'vitest';
import {
  COMPACT_LABEL_WIDTH,
  estimateServiceNameWidth,
  mayTruncateServiceName,
  serviceNameTooltip,
} from '@/utils/serviceNameFit';
import { SERVICE_DISPLAY_NAMES } from '@/constants/serviceNames';

describe('estimateServiceNameWidth', () => {
  it('中英文分别计宽', () => {
    expect(estimateServiceNameWidth('abcd')).toBe(24);   // 4 * 6
    expect(estimateServiceNameWidth('微博')).toBe(22);    // 2 * 11
    expect(estimateServiceNameWidth('R2 云')).toBe(29);   // 'R2 ' = 18 + '云' = 11
  });

  it('空串宽度为 0', () => {
    expect(estimateServiceNameWidth('')).toBe(0);
  });
});

describe('mayTruncateServiceName', () => {
  it('所有内置图床名都放得下，不会触发前置全名', () => {
    for (const name of Object.values(SERVICE_DISPLAY_NAMES)) {
      expect(mayTruncateServiceName(name), `${name} 不应被判为会截断`).toBe(false);
    }
  });

  it('超长的自定义 profile 名判为会截断', () => {
    expect(mayTruncateServiceName('我家里那台群晖 NAS 上的 WebDAV 图床')).toBe(true);
    expect(mayTruncateServiceName('my-really-long-s3-profile-name-for-truncation-testing')).toBe(true);
  });

  it('恰好等于上限不算截断，超一点才算', () => {
    const exact = 'a'.repeat(COMPACT_LABEL_WIDTH / 6);
    expect(mayTruncateServiceName(exact)).toBe(false);
    expect(mayTruncateServiceName(exact + 'a')).toBe(true);
  });

  it('可传入更宽的一档（设置页芯片 120px）', () => {
    const name = 'a'.repeat(18); // 108px
    expect(mayTruncateServiceName(name)).toBe(true);
    expect(mayTruncateServiceName(name, 120)).toBe(false);
  });
});

describe('serviceNameTooltip', () => {
  it('名字放得下时只给原文案，不重复名字', () => {
    expect(serviceNameTooltip('微博', '点击复制链接')).toBe('点击复制链接');
  });

  it('名字放得下且没有原文案时不显示 tooltip', () => {
    expect(serviceNameTooltip('微博')).toBeUndefined();
    expect(serviceNameTooltip('微博', null)).toBeUndefined();
    expect(serviceNameTooltip('微博', '')).toBeUndefined();
  });

  it('名字放不下时前置全名', () => {
    const long = '我家里那台群晖 NAS 上的 WebDAV 图床';
    expect(serviceNameTooltip(long, '点击复制链接')).toBe(`${long} · 点击复制链接`);
  });

  it('名字放不下且没有原文案时，tooltip 就是全名', () => {
    const long = '我家里那台群晖 NAS 上的 WebDAV 图床';
    expect(serviceNameTooltip(long)).toBe(long);
  });

  it('放宽上限后同一个名字会从"前置"变回"不前置"', () => {
    const name = 'a'.repeat(18); // 108px
    expect(serviceNameTooltip(name, '点击复制链接')).toBe(`${name} · 点击复制链接`);
    expect(serviceNameTooltip(name, '点击复制链接', 120)).toBe('点击复制链接');
  });
});
