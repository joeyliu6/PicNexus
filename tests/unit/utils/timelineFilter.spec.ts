import { describe, it, expect } from 'vitest';
import { filterMonthPoints } from '@/utils/timelineFilter';
import type { TimePeriodStats } from '@/services/database/types';

// mock helper：补齐 TimePeriodStats 的 minTimestamp/maxTimestamp 字段
// 这两个字段不影响 filterMonthPoints 行为，测试里统一填 0 即可。
function period(year: number, month: number, count: number): TimePeriodStats {
  return { year, month, count, minTimestamp: 0, maxTimestamp: 0 };
}

describe('filterMonthPoints', () => {
  it('空数据返回空数组', () => {
    expect(filterMonthPoints([], new Set(), 800)).toEqual([]);
  });

  it('容器高度为 0 返回空数组', () => {
    const periods = [period(2024, 0, 10)];
    expect(filterMonthPoints(periods, new Set(), 0)).toEqual([]);
  });

  it('单个月份返回单个点', () => {
    const periods = [period(2024, 5, 10)];
    const result = filterMonthPoints(periods, new Set(), 800);

    expect(result).toHaveLength(1);
    expect(result[0].year).toBe(2024);
    expect(result[0].month).toBe(5);
    expect(result[0].label).toBe('2024年6月');
  });

  it('边界点始终保留', () => {
    const periods = [
      period(2024, 11, 100),
      period(2024, 6, 1),  // 低密度但不是边界
      period(2024, 0, 100),
    ];
    const result = filterMonthPoints(periods, new Set(), 800);

    // 第一个和最后一个必须存在
    const ids = result.map(p => p.id);
    expect(ids).toContain('2024-11');
    expect(ids).toContain('2024-0');
  });

  it('已加载月份标记为 isLoaded', () => {
    const periods = [period(2024, 3, 10)];
    const loaded = new Set(['2024-3']);
    const result = filterMonthPoints(periods, loaded, 800);

    expect(result[0].isLoaded).toBe(true);
  });

  it('未加载月份标记为 isLoaded: false', () => {
    const periods = [period(2024, 3, 10)];
    const result = filterMonthPoints(periods, new Set(), 800);

    expect(result[0].isLoaded).toBe(false);
  });

  it('多月份结果按位置排序', () => {
    const periods = [
      period(2024, 6, 50),
      period(2024, 3, 50),
      period(2024, 0, 50),
    ];
    const result = filterMonthPoints(periods, new Set(), 800);

    for (let i = 1; i < result.length; i++) {
      expect(result[i].position).toBeGreaterThanOrEqual(result[i - 1].position);
    }
  });

  it('count 属性正确传递', () => {
    const periods = [period(2024, 3, 42)];
    const result = filterMonthPoints(periods, new Set(), 800);

    expect(result[0].count).toBe(42);
  });
});
