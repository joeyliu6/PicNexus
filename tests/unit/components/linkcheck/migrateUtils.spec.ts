import { describe, expect, it } from 'vitest';
import { buildMigrateProgressTooltip } from '@/components/views/linkcheck/migrate/utils';

describe('buildMigrateProgressTooltip', () => {
  it('汇总成功/失败/跳过、完成度、速度、剩余时间和并发数', () => {
    const tooltip = buildMigrateProgressTooltip({
      success: 4,
      failed: 1,
      skipped: 1,
      total: 10,
      avgBytesPerSec: 2 * 1024 * 1024,
      etaMs: 90_000,
      concurrentCount: 3,
      state: 'running',
    });

    expect(tooltip.title).toBe('批量迁移进度');
    expect(tooltip.items).toContainEqual({ label: '已处理', value: '6 / 10' });
    expect(tooltip.items).toContainEqual({ label: '完成度', value: '60%' });
    expect(tooltip.items).toContainEqual({ label: '成功', value: '4', tone: 'success' });
    expect(tooltip.items).toContainEqual({ label: '失败', value: '1', tone: 'danger' });
    expect(tooltip.items).toContainEqual({ label: '跳过', value: '1', tone: 'warning' });
    expect(tooltip.items).toContainEqual({ label: '平均速度', value: '2.0 MB/s' });
    expect(tooltip.items).toContainEqual({ label: '预计剩余', value: '1 分 30 秒' });
    expect(tooltip.items).toContainEqual({ label: '并发数', value: '3' });
  });

  it('取消中提示已写入数据会保留', () => {
    const tooltip = buildMigrateProgressTooltip({
      success: 1,
      failed: 0,
      skipped: 0,
      total: 5,
      avgBytesPerSec: 0,
      etaMs: null,
      concurrentCount: 1,
      state: 'cancelling',
    });

    expect(tooltip.notes?.[0]).toContain('已成功写入的数据会保留');
  });
});
