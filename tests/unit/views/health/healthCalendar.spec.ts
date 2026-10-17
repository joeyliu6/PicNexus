// 上传日历：一格一天、一次一年、四档蓝按当年非零日四分位、琥珀按当天失效张数、未来日期留空
import { describe, expect, it } from 'vitest';
import { getDayKey } from '@/utils/formatters';
import { buildCalendar, countByDay, defaultYear, yearPills } from '@/views/health/healthCalendar';

const day = (y: number, m: number, d: number) => getDayKey(new Date(y, m - 1, d).getTime());

describe('buildCalendar', () => {
  it('第一列从 1 月 1 日所在的那一周开始，行 = 周一到周日', () => {
    // 2023-01-01 是周日：落在第一列最后一行
    const cal = buildCalendar(2023, new Map(), new Map(), new Date(2024, 0, 1).getTime());
    expect(cal.weeks[0].slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(cal.weeks[0][6]?.key).toBe(day(2023, 1, 1));
    expect(cal.weeks[1][0]?.key).toBe(day(2023, 1, 2));
    expect(cal.weeks).toHaveLength(53);
  });

  it('366 天且 1 月 1 日是周日的年份画 54 列，12 月 31 日不被截掉', () => {
    // 2040-01-01 是周日，闰年
    const cal = buildCalendar(2040, new Map(), new Map(), new Date(2041, 0, 1).getTime());
    expect(cal.weeks).toHaveLength(54);
    const cells = cal.weeks.flat().filter(Boolean);
    expect(cells).toHaveLength(366);
    expect(cells.at(-1)?.key).toBe(day(2040, 12, 31));
  });

  it('普通年份 53 列', () => {
    // 2024-01-01 是周一
    expect(buildCalendar(2024, new Map(), new Map(), 0).weeks).toHaveLength(53);
  });

  it('上传量按当年非零日的四分位分四档（不超过下四分位 1 档…超过上四分位 4 档），没有上传是 0 档', () => {
    const uploads = new Map([[day(2023, 3, 1), 1], [day(2023, 3, 2), 2], [day(2023, 3, 3), 3], [day(2023, 3, 4), 4], [day(2023, 3, 5), 40]]);
    const cells = new Map(buildCalendar(2023, uploads, new Map(), Date.now()).weeks.flat().filter((c) => c !== null).map((c) => [c!.key, c!]));
    expect([1, 2, 3, 4, 5, 6].map((d) => cells.get(day(2023, 3, d))?.level)).toEqual([1, 1, 2, 3, 4, 0]);
  });

  it('当天上传的图里有失效：1 张浅、2 张及以上深', () => {
    const dead = new Map([[day(2023, 5, 22), 2], [day(2023, 2, 20), 1]]);
    const cells = buildCalendar(2023, new Map(), dead, Date.now()).weeks.flat();
    expect(cells.find((c) => c?.key === day(2023, 5, 22))?.bad).toBe(2);
    expect(cells.find((c) => c?.key === day(2023, 2, 20))?.bad).toBe(1);
  });

  it('今天之后的格子标为未来', () => {
    const cells = buildCalendar(2026, new Map(), new Map(), new Date(2026, 9, 16, 12).getTime()).weeks.flat();
    expect(cells.find((c) => c?.key === day(2026, 10, 16))?.future).toBe(false);
    expect(cells.find((c) => c?.key === day(2026, 10, 17))?.future).toBe(true);
  });

  it('月份标签落在该月 1 日所在的列', () => {
    const cal = buildCalendar(2023, new Map(), new Map(), 0);
    expect(cal.months[0]).toEqual({ month: 1, col: 0 });
    // 2023-02-01 是周三，第 31 天：(31 + 6) / 7 = 5
    expect(cal.months[1]).toEqual({ month: 2, col: 5 });
  });
});

describe('年份', () => {
  it('有上传的年份加上今年，最近 6 年平铺、其余进「更早」', () => {
    expect(yearPills([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2017], 2026))
      .toEqual({ shown: [2026, 2025, 2024, 2023, 2022, 2021], earlier: [2020, 2019, 2017] });
    expect(yearPills([], 2026)).toEqual({ shown: [2026], earlier: [] });
  });

  it('默认选最近一个有失效的年份，没有就选今年', () => {
    expect(defaultYear(new Map([[2020, 6], [2023, 4], [2024, 0]]), 2026)).toBe(2023);
    expect(defaultYear(new Map(), 2026)).toBe(2026);
  });

  it('按本地日期数', () => {
    const map = countByDay([new Date(2023, 4, 22, 1).getTime(), new Date(2023, 4, 22, 23).getTime()], (t) => t);
    expect(map.get(day(2023, 5, 22))).toBe(2);
  });
});
