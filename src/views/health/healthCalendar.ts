// 上传日历（HealthScreen.dc.html，交接说明 8.3）：一次看一年，7 行（周一到周日）× 53 / 54 列，一格一天。
// 颜色深浅 = 当天上传量（当年非零日的四分位），琥珀 = 当天上传的图里有失效（1 张浅、2 张及以上深）。纯函数。

import { getDayKey } from '@/utils/formatters';

export interface CalendarCell {
  /** getDayKey 的格式 */
  key: string;
  /** 当天 0 点（本地） */
  date: number;
  count: number;
  dead: number;
  /** 0 = 没有上传，1–4 = 四档蓝 */
  level: 0 | 1 | 2 | 3 | 4;
  /** 0 = 没有失效，1 = 1 张（浅琥珀），2 = 2 张及以上（深琥珀） */
  bad: 0 | 1 | 2;
  future: boolean;
}

export interface CalendarYear {
  year: number;
  /** 每列一周，每周 7 格（周一到周日）；不属于这一年的格子是 null */
  weeks: Array<Array<CalendarCell | null>>;
  /** 月份标签所在的列 */
  months: Array<{ month: number; col: number }>;
}

/** 周一 = 0 … 周日 = 6 */
function weekdayRow(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function quartiles(values: number[]): [number, number, number] {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.floor(p * (sorted.length - 1))] ?? 0;
  return [at(0.25), at(0.5), at(0.75)];
}

export function buildCalendar(
  year: number,
  uploadsByDay: ReadonlyMap<string, number>,
  deadByDay: ReadonlyMap<string, number>,
  now: number,
): CalendarYear {
  const jan1 = new Date(year, 0, 1);
  const offset = weekdayRow(jan1);
  const days = Math.round((new Date(year + 1, 0, 1).getTime() - jan1.getTime()) / 86_400_000);
  const columns = Math.ceil((offset + days) / 7);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  const yearCounts: number[] = [];
  for (let i = 0; i < days; i++) {
    const count = uploadsByDay.get(getDayKey(new Date(year, 0, 1 + i).getTime())) ?? 0;
    if (count > 0) yearCounts.push(count);
  }
  const [q1, q2, q3] = quartiles(yearCounts);
  const levelOf = (count: number): CalendarCell['level'] => {
    if (count <= 0) return 0;
    if (count <= q1) return 1;
    if (count <= q2) return 2;
    if (count <= q3) return 3;
    return 4;
  };

  const weeks: CalendarYear['weeks'] = Array.from({ length: columns }, () => Array<CalendarCell | null>(7).fill(null));
  for (let i = 0; i < days; i++) {
    const date = new Date(year, 0, 1 + i);
    const key = getDayKey(date.getTime());
    const count = uploadsByDay.get(key) ?? 0;
    const dead = deadByDay.get(key) ?? 0;
    const slot = offset + i;
    weeks[Math.floor(slot / 7)][slot % 7] = {
      key,
      date: date.getTime(),
      count,
      dead,
      level: levelOf(count),
      bad: dead >= 2 ? 2 : dead === 1 ? 1 : 0,
      future: date.getTime() > startOfToday,
    };
  }

  const months = Array.from({ length: 12 }, (_, month) => {
    const dayOfYear = Math.round((new Date(year, month, 1).getTime() - jan1.getTime()) / 86_400_000);
    return { month: month + 1, col: Math.floor((dayOfYear + offset) / 7) };
  });
  return { year, weeks, months };
}

/** 按本地日期数：每天上传几张、几张失效；每年同理 */
export function countByDay<T>(items: readonly T[], timeOf: (item: T) => number): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = getDayKey(timeOf(item));
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

export function countByYear<T>(items: readonly T[], timeOf: (item: T) => number): Map<number, number> {
  const map = new Map<number, number>();
  for (const item of items) {
    const year = new Date(timeOf(item)).getFullYear();
    map.set(year, (map.get(year) ?? 0) + 1);
  }
  return map;
}

/** 年份胶囊：有上传的年份加上今年，从新到旧最多 6 个平铺，其余进「更早」 */
export function yearPills(uploadYears: Iterable<number>, currentYear: number): { shown: number[]; earlier: number[] } {
  const years = [...new Set([...uploadYears, currentYear])].sort((a, b) => b - a);
  return { shown: years.slice(0, 6), earlier: years.slice(6) };
}

/** 默认年份：最近一个有失效图片的年份；没有问题时选今年 */
export function defaultYear(deadByYear: ReadonlyMap<number, number>, currentYear: number): number {
  let latest: number | null = null;
  for (const [year, n] of deadByYear) if (n > 0 && (latest === null || year > latest)) latest = year;
  return latest ?? currentYear;
}
