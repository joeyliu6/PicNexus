import { describe, expect, it } from 'vitest';
import { migrateResultSummary } from '@/components/views/link-check/migrate/utils';

const base = { successCount: 0, failedCount: 0, skippedCount: 0 };

describe('migrateResultSummary', () => {
  it('全部成功：绿色「全部完成」，带上本来就有的数量', () => {
    expect(migrateResultSummary({ ...base, successCount: 3, skippedCount: 1 }))
      .toEqual({ text: '全部完成 · 3 张已备份 · 1 张本来就有', tone: 'success' });
  });

  it('有失败：黄色，说清失败几张', () => {
    expect(migrateResultSummary({ ...base, successCount: 3, failedCount: 2 }))
      .toEqual({ text: '完成 · 3 张已备份 · 2 张失败', tone: 'warning' });
  });

  it('非正常结束要说原因', () => {
    expect(migrateResultSummary({ ...base, successCount: 1, pauseReason: 'user-cancelled' }).text).toBe('已取消 · 1 张已备份');
    expect(migrateResultSummary({ ...base, pauseReason: 'user-cancelled' }).text).toBe('已取消，没有图片被处理');
    expect(migrateResultSummary({ ...base, failedCount: 5, pauseReason: 'consecutive-failures' }))
      .toEqual({ text: '连续失败，已自动停下 · 5 张失败', tone: 'error' });
    expect(migrateResultSummary({ ...base, pauseReason: 'runtime-error' }).tone).toBe('error');
  });
});
