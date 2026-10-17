// 自动检测：开着、距上次检测满 N 天才到期；从没检测过不自动开始
import { describe, expect, it } from 'vitest';
import { autoCheckSettings, isAutoCheckDue, latestCheckedAt, nextCheckAt } from '@/views/health/autoCheck';

const DAY = 86_400_000;

describe('autoCheck', () => {
  it('默认开、每 7 天；配置缺字段时补默认值', () => {
    expect(autoCheckSettings(undefined)).toEqual({ enabled: true, intervalDays: 7 });
    expect(autoCheckSettings({ linkHealth: { docFolders: [], autoCheck: { enabled: false, intervalDays: 30 } } } as never)).toEqual({ enabled: false, intervalDays: 30 });
  });

  it('距上次检测满 N 天到期', () => {
    const settings = { enabled: true, intervalDays: 7 };
    expect(nextCheckAt(settings, 1000)).toBe(1000 + 7 * DAY);
    expect(isAutoCheckDue(settings, 1000, 1000 + 7 * DAY - 1)).toBe(false);
    expect(isAutoCheckDue(settings, 1000, 1000 + 7 * DAY)).toBe(true);
  });

  it('关着或从没检测过：不到期', () => {
    expect(isAutoCheckDue({ enabled: false, intervalDays: 1 }, 0, 10 * DAY)).toBe(false);
    expect(isAutoCheckDue({ enabled: true, intervalDays: 1 }, null, 10 * DAY)).toBe(false);
    expect(nextCheckAt({ enabled: true, intervalDays: 1 }, null)).toBeNull();
  });

  it('上次检测 = 全部结果里最新的一条', () => {
    expect(latestCheckedAt([{ checkedAt: 3 }, {}, { checkedAt: 9 }, { checkedAt: 4 }])).toBe(9);
    expect(latestCheckedAt([{}])).toBeNull();
  });
});
