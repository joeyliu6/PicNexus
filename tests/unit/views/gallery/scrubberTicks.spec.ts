import { describe, expect, it } from 'vitest';
import { SCRUBBER_TICK_HEIGHT, scrubberTicks } from '@/views/gallery/scrubberTicks';

// GalleryScreen.dc.html 的刻度条：年份一行 34、月份一行 26；放得下就给最近几年列出有图的月份，
// 更早的年份只写年。当前所在的那个月（或那一年）用品牌色。

const month = (year: number, m: number) => ({ year, month: m });
const MONTHS = [
  month(2026, 9), month(2026, 8), month(2026, 7), month(2026, 5), month(2026, 2),
  month(2025, 11), month(2025, 8), month(2025, 4),
  month(2024, 6), month(2023, 1),
];

describe('scrubberTicks', () => {
  it('lists every month while there is room', () => {
    const ticks = scrubberTicks(MONTHS, 2000, { year: 2026, month: 9 });
    expect(ticks.map((t) => t.label)).toEqual(['2026', '10月', '9月', '8月', '6月', '3月', '2025', '12月', '9月', '5月', '2024', '7月', '2023', '2月']);
    expect(ticks.filter((t) => t.current).map((t) => t.label)).toEqual(['10月']);
  });

  it('keeps months for the newest years and collapses the rest to the year when space runs out', () => {
    const height = 4 * SCRUBBER_TICK_HEIGHT.year + 8 * SCRUBBER_TICK_HEIGHT.month;
    expect(scrubberTicks(MONTHS, height, { year: 2023, month: 1 }).map((t) => [t.label, t.current])).toEqual([
      ['2026', false], ['10月', false], ['9月', false], ['8月', false], ['6月', false], ['3月', false],
      ['2025', false], ['12月', false], ['9月', false], ['5月', false],
      ['2024', false], ['2023', true],
    ]);
  });

  it('marks the year itself when its months are not listed', () => {
    const ticks = scrubberTicks(MONTHS, 4 * SCRUBBER_TICK_HEIGHT.year, { year: 2025, month: 4 });
    expect(ticks.map((t) => t.label)).toEqual(['2026', '2025', '2024', '2023']);
    expect(ticks.find((t) => t.current)?.label).toBe('2025');
  });
});
