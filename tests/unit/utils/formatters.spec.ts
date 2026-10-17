import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  formatCalendarDate,
  formatCount,
  formatDayHeading,
  formatShortDateTime,
  formatDateCompact,
  formatFileSize,
  formatListTime,
  formatRelativeTime,
  formatSizeChange,
  formatTimestampCompact,
} from '@/utils/formatters';

// 交接说明 9：大数字千分位（张数、条数）
describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(12483)).toBe('12,483');
    expect(formatCount(1_048_576)).toBe('1,048,576');
    expect(formatCount(7)).toBe('7');
  });
});

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

  // 设计稿的写法：KB 取整（「386 KB」），MB 不到 10 留一位小数（「1.2 MB」），10 以上取整（「18 MB」）
  it('writes KB as whole numbers', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('2 KB');
    expect(formatFileSize(386 * 1024)).toBe('386 KB');
  });

  it('keeps one decimal below 10 MB and drops it above', () => {
    expect(formatFileSize(1.2 * 1024 * 1024)).toBe('1.2 MB');
    expect(formatFileSize(18 * 1024 * 1024)).toBe('18 MB');
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

// HomeScreen H03 / H05：压缩过的图写「1.2 MB → 410 KB」；没压小就只写原大小
describe('formatSizeChange', () => {
  it('shows the original and the compressed size', () => {
    expect(formatSizeChange(1.2 * 1024 * 1024, 410 * 1024)).toBe('1.2 MB → 410 KB');
  });

  it('shows only the original size when nothing got smaller', () => {
    expect(formatSizeChange(386 * 1024)).toBe('386 KB');
    expect(formatSizeChange(386 * 1024, 400 * 1024)).toBe('386 KB');
  });
});

// 图库详情的日期（GalleryScreen.dc.html）：今年写「10月14日」，往年带年份「2024年8月2日」；不写「昨天」
describe('formatCalendarDate', () => {
  const now = new Date(2026, 9, 15, 12).getTime();
  it('drops the year within this year and keeps it otherwise', () => {
    expect(formatCalendarDate(new Date(2026, 9, 14, 9).getTime(), now)).toBe('10月14日');
    expect(formatCalendarDate(new Date(2024, 7, 2, 21).getTime(), now)).toBe('2024年8月2日');
  });
});

// 图库列表的上传时间（GalleryScreen.dc.html G02）：「今天 14:22」「昨天 18:30」，更早写日期加时刻
describe('formatListTime', () => {
  const now = new Date(2026, 9, 15, 16).getTime();
  it('names today and yesterday, dates the rest', () => {
    expect(formatListTime(new Date(2026, 9, 15, 14, 22).getTime(), now)).toBe('今天 14:22');
    expect(formatListTime(new Date(2026, 9, 14, 18, 30).getTime(), now)).toBe('昨天 18:30');
    expect(formatListTime(new Date(2026, 9, 13, 9, 12).getTime(), now)).toBe('10月13日 09:12');
    expect(formatListTime(new Date(2024, 7, 2, 21, 40).getTime(), now)).toBe('2024年8月2日 21:40');
  });
});

describe('formatDateCompact / formatTimestampCompact', () => {
  it('月/日/时/分/秒都补零', () => {
    const date = new Date(2026, 0, 5, 9, 8, 7);

    expect(formatDateCompact(date)).toBe('20260105');
    expect(formatTimestampCompact(date)).toBe('20260105_090807');
  });

  it('两位数月日时分秒原样输出', () => {
    const date = new Date(2026, 10, 25, 23, 59, 59);

    expect(formatDateCompact(date)).toBe('20261125');
    expect(formatTimestampCompact(date)).toBe('20261125_235959');
  });

  it('紧凑时间戳的日期部分与 formatDateCompact 一致（md-rescue 备份名依赖此格式）', () => {
    const date = new Date(2026, 7, 13, 14, 30, 22);

    expect(formatTimestampCompact(date)).toBe(`${formatDateCompact(date)}_143022`);
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

  it('5 分钟前：数字和汉字之间留空格，和应用里其他「N 分钟前」一致', () => {
    expect(formatRelativeTime(NOW - 5 * 60_000)).toBe('5 分钟前');
  });

  it('59 分钟前', () => {
    expect(formatRelativeTime(NOW - 59 * 60_000)).toBe('59 分钟前');
  });

  it('2 小时前', () => {
    expect(formatRelativeTime(NOW - 2 * 3_600_000)).toBe('2 小时前');
  });

  it('23 小时前', () => {
    expect(formatRelativeTime(NOW - 23 * 3_600_000)).toBe('23 小时前');
  });

  it('3 天前', () => {
    expect(formatRelativeTime(NOW - 3 * 86_400_000)).toBe('3 天前');
  });

  it('6 天前', () => {
    expect(formatRelativeTime(NOW - 6 * 86_400_000)).toBe('6 天前');
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

describe('formatShortDateTime', () => {
  const now = new Date(2026, 9, 16, 14, 30).getTime();

  it('writes only the time for today and 昨天 for yesterday', () => {
    expect(formatShortDateTime(new Date(2026, 9, 16, 9, 5).getTime(), now)).toBe('09:05');
    expect(formatShortDateTime(new Date(2026, 9, 15, 18, 30).getTime(), now)).toBe('昨天 18:30');
  });

  it('writes the date for older records, with the year only when it differs', () => {
    expect(formatShortDateTime(new Date(2026, 8, 28, 10, 0).getTime(), now)).toBe('9月28日');
    expect(formatShortDateTime(new Date(2025, 4, 22, 10, 0).getTime(), now)).toBe('2025年5月22日');
  });
});

// GalleryScreen.dc.html 的日期标题：「今天 10月15日」「昨天 10月14日」，更早的只写日期
describe('formatDayHeading', () => {
  const now = new Date(2026, 9, 15, 9, 0).getTime();

  it('names today and yesterday and puts the date beside them', () => {
    expect(formatDayHeading(2026, 9, 15, now)).toEqual({ title: '今天', sub: '10月15日' });
    expect(formatDayHeading(2026, 9, 14, now)).toEqual({ title: '昨天', sub: '10月14日' });
  });

  it('writes older days as a full date', () => {
    expect(formatDayHeading(2026, 9, 13, now)).toEqual({ title: '2026年10月13日', sub: '' });
    expect(formatDayHeading(2025, 11, 31, now)).toEqual({ title: '2025年12月31日', sub: '' });
  });
});
