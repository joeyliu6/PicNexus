import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getLinkCheckStreamQuery,
  batchUpdateLinkCheckStatusQuery,
} from '@/services/database/LinkCheckQuery';

function makeDb(): any {
  return {
    execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    select: vi.fn().mockResolvedValue([]),
  };
}

describe('getLinkCheckStreamQuery', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => { db = makeDb(); });

  it('空结果立即结束', async () => {
    db.select.mockResolvedValue([]);
    const gen = getLinkCheckStreamQuery(db);
    const result = await gen.next();
    expect(result.done).toBe(true);
    expect(db.select.mock.calls[0][0]).toContain('ORDER BY timestamp DESC, id DESC');
  });

  it('读出时间列：日历按上传时间分天', async () => {
    db.select.mockResolvedValueOnce([{ id: 'a', timestamp: 5 } as any]);
    const { value } = await getLinkCheckStreamQuery(db, 2).next();
    expect(value).toEqual([{ id: 'a', timestamp: 5 }]);
    expect(db.select.mock.calls[0][0]).toContain('timestamp');
  });

  it('用上一批最后一行的 (timestamp, id) 作为下一批游标，而不是 OFFSET', async () => {
    db.select
      .mockResolvedValueOnce([
        { id: 'a', timestamp: 300 } as any,
        { id: 'b', timestamp: 200 } as any,
      ])
      .mockResolvedValueOnce([]);

    const gen = getLinkCheckStreamQuery(db, 2);
    for await (const _rows of gen) { /* 跑到流结束 */ }

    // 首批没有游标，只带 limit
    expect(db.select.mock.calls[0][1]).toEqual([2]);

    // 次批必须从上一批末尾接着取：用 OFFSET 的话大表上每页都要重扫前面所有行
    const [sql, params] = db.select.mock.calls[1];
    expect(sql).not.toContain('OFFSET');
    expect(params).toEqual([200, 'b', 2]);
  });

  it('满一批后继续下一批', async () => {
    const batch1 = Array.from({ length: 2 }, (_, i) => ({ id: `b${i}` } as any));
    const batch2 = Array.from({ length: 2 }, (_, i) => ({ id: `c${i}` } as any));
    db.select
      .mockResolvedValueOnce(batch1)
      .mockResolvedValueOnce(batch2)
      .mockResolvedValueOnce([]);
    const gen = getLinkCheckStreamQuery(db, 2);
    const results: any[] = [];
    for await (const rows of gen) results.push(rows);
    expect(results).toHaveLength(2);
  });
});

describe('batchUpdateLinkCheckStatusQuery', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => { db = makeDb(); });

  it('空数组直接返回', async () => {
    await batchUpdateLinkCheckStatusQuery(db, []);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('小批量 → 一次 UPDATE', async () => {
    await batchUpdateLinkCheckStatusQuery(db, [
      { id: 'a', linkCheckStatus: 'invalid', linkCheckSummary: '{}' },
      { id: 'b', linkCheckStatus: 'valid', linkCheckSummary: '{}' },
    ]);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute.mock.calls[0][0]).toContain('UPDATE history_items');
    expect(db.execute.mock.calls[0][0]).not.toContain('BEGIN');
    expect(db.execute.mock.calls[0][0]).not.toContain('COMMIT');
  });

  it('大批量（> 200）分批', async () => {
    const updates = Array.from({ length: 450 }, (_, i) => ({
      id: `id${i}`, linkCheckStatus: 'x', linkCheckSummary: '{}',
    }));
    await batchUpdateLinkCheckStatusQuery(db, updates);
    expect(db.execute).toHaveBeenCalledTimes(3);
  });

  it('任一批更新失败时抛出错误', async () => {
    const err = new Error('database locked');
    db.execute.mockRejectedValueOnce(err);

    await expect(batchUpdateLinkCheckStatusQuery(db, [
      { id: 'a', linkCheckStatus: 'invalid', linkCheckSummary: '{}' },
    ])).rejects.toThrow('database locked');

    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
