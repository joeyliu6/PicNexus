import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatFileSize, formatRelativeTime } from '@/utils/formatters';

describe('formatFileSize', () => {
  it('0 字节返回 0 B', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('0 字节 + emptyText 选项', () => {
    expect(formatFileSize(0, { emptyText: '-' })).toBe('-');
  });

  it('1023 字节返回 1023 B', () => {
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('1024 字节返回 1.0 KB', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
  });

  it('1536 字节返回 1.5 KB', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('1MB 返回 1.0 MB', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
  });

  it('2.5MB 返回 2.5 MB', () => {
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });

  it('1GB 返回 1.0 GB', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.0 GB');
  });
});

describe('formatRelativeTime', () => {
  const NOW = 1_700_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('30 秒内 → 刚刚', () => {
    expect(formatRelativeTime(NOW - 30_000)).toBe('刚刚');
  });

  it('59 秒 → 刚刚', () => {
    expect(formatRelativeTime(NOW - 59_000)).toBe('刚刚');
  });

  it('5 分钟前 → 5分钟前', () => {
    expect(formatRelativeTime(NOW - 5 * 60_000)).toBe('5分钟前');
  });

  it('59 分钟前 → 59分钟前', () => {
    expect(formatRelativeTime(NOW - 59 * 60_000)).toBe('59分钟前');
  });

  it('2 小时前 → 2小时前', () => {
    expect(formatRelativeTime(NOW - 2 * 3_600_000)).toBe('2小时前');
  });

  it('23 小时前 → 23小时前', () => {
    expect(formatRelativeTime(NOW - 23 * 3_600_000)).toBe('23小时前');
  });

  it('3 天前 → 3天前', () => {
    expect(formatRelativeTime(NOW - 3 * 86_400_000)).toBe('3天前');
  });

  it('6 天前 → 6天前', () => {
    expect(formatRelativeTime(NOW - 6 * 86_400_000)).toBe('6天前');
  });

  it('超过 7 天 → 返回日期字符串', () => {
    const result = formatRelativeTime(NOW - 8 * 86_400_000);
    // 格式类似 "11/7" 或 "11月7日"，只验证是非空字符串
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe('刚刚');
    expect(result).not.toContain('分钟');
    expect(result).not.toContain('小时');
    expect(result).not.toContain('天');
  });
});
