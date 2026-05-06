import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getLinkCheckInvalidQuery,
  getLinkCheckRestStreamQuery,
  batchUpdateLinkCheckStatusQuery,
} from '../../../../services/database/LinkCheckQuery';

function makeDb(): any {
  return {
    execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    select: vi.fn().mockResolvedValue([]),
  };
}

describe('getLinkCheckInvalidQuery', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => { db = makeDb(); });

  it('SQL 包含未检测 summary / invalidLinks / uncheckedLinks 判断', async () => {
    await getLinkCheckInvalidQuery(db);
    const sql = db.select.mock.calls[0][0];
    expect(sql).toContain('link_check_summary IS NULL');
    expect(sql).toContain('invalidLinks');
    expect(sql).toContain('uncheckedLinks');
  });
});

describe('getLinkCheckRestStreamQuery', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => { db = makeDb(); });

  it('空结果立即结束', async () => {
    db.select.mockResolvedValue([]);
    const gen = getLinkCheckRestStreamQuery(db, new Set());
    const result = await gen.next();
    expect(result.done).toBe(true);
  });

  it('过滤已加载 id 后 yield 剩余', async () => {
    db.select.mockResolvedValueOnce([
      { id: 'a' } as any,
      { id: 'b' } as any,
    ]).mockResolvedValueOnce([]);
    const gen = getLinkCheckRestStreamQuery(db, new Set(['a']), 2);
    const { value } = await gen.next();
    expect(value).toEqual([{ id: 'b' }]);
  });

  it('满一批后继续下一批', async () => {
    const batch1 = Array.from({ length: 2 }, (_, i) => ({ id: `b${i}` } as any));
    const batch2 = Array.from({ length: 2 }, (_, i) => ({ id: `c${i}` } as any));
    db.select
      .mockResolvedValueOnce(batch1)
      .mockResolvedValueOnce(batch2)
      .mockResolvedValueOnce([]);
    const gen = getLinkCheckRestStreamQuery(db, new Set(), 2);
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
