// 图库刻度条的刻度（GalleryScreen.dc.html）：年份一行 34、月份一行 26。
// 放得下就给最近几年列出有图的月份，更早的年份只写年；当前所在的月（月份没列出时就是那一年）用品牌色。

export const SCRUBBER_TICK_HEIGHT = { year: 34, month: 26 } as const;

export interface ScrubberTick {
  kind: 'year' | 'month';
  label: string;
  year: number;
  /** 0–11；年份刻度为 undefined */
  month?: number;
  current: boolean;
}

interface MonthKey {
  year: number;
  month: number;
}

/** @param months 有图的月份，新的在前 */
export function scrubberTicks(months: readonly MonthKey[], maxHeight: number, current: MonthKey | null): ScrubberTick[] {
  const years: number[] = [];
  const monthsOf = new Map<number, number[]>();
  for (const { year, month } of months) {
    if (!monthsOf.has(year)) { years.push(year); monthsOf.set(year, []); }
    monthsOf.get(year)!.push(month);
  }

  // 先放下所有年份，再从最近的一年起逐年展开月份，放不下就停
  let height = years.length * SCRUBBER_TICK_HEIGHT.year;
  const expanded = new Set<number>();
  for (const year of years) {
    const extra = monthsOf.get(year)!.length * SCRUBBER_TICK_HEIGHT.month;
    if (height + extra > maxHeight) break;
    height += extra;
    expanded.add(year);
  }

  const ticks: ScrubberTick[] = [];
  for (const year of years) {
    const isCurrentYear = current?.year === year;
    ticks.push({ kind: 'year', label: String(year), year, current: isCurrentYear && !expanded.has(year) });
    if (!expanded.has(year)) continue;
    for (const month of monthsOf.get(year)!) {
      ticks.push({ kind: 'month', label: `${month + 1}月`, year, month, current: isCurrentYear && current?.month === month });
    }
  }
  return ticks;
}
