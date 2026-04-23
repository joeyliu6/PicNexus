import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getLinkCheckInvalidQuery,
  getLinkCheckRestStreamQuery,
  batchUpdateLinkCheckStatusQuery,
  setLinkCheckSkipQuery,
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

  it('默认只查未跳过的', async () => {
    await getLinkCheckInvalidQuery(db);
    const sql = db.select.mock.calls[0][0];
    expect(sql).toContain('link_check_skip = 0');
  });

  it('onlySkipped=true → 查跳过的', async () => {
    await getLinkCheckInvalidQuery(db, { onlySkipped: true });
    const sql = db.select.mock.calls[0][0];
    expect(sql).toContain('link_check_skip = 1');
  });

  it('includeSkipped=true → 不过滤跳过', async () => {
    await getLinkCheckInvalidQuery(db, { includeSkipped: true });
    const sql = db.select.mock.calls[0][0];
    expect(sql).toContain('1 = 1');
  });

  it('SQL 包含 invalidLinks / uncheckedLinks 判断', async () => {
    await getLinkCheckInvalidQuery(db);
    const sql = db.select.mock.calls[0][0];
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

  it('onlySkipped 选项传给 SQL', async () => {
    db.select.mockResolvedValue([]);
    const gen = getLinkCheckRestStreamQuery(db, new Set(), 10, { onlySkipped: true });
    await gen.next();
    const sql = db.select.mock.calls[0][0];
    expect(sql).toContain('link_check_skip = 1');
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
  });

  it('大批量（> 200）分批', async () => {
    const updates = Array.from({ length: 450 }, (_, i) => ({
      id: `id${i}`, linkCheckStatus: 'x', linkCheckSummary: '{}',
    }));
    await batchUpdateLinkCheckStatusQuery(db, updates);
    expect(db.execute).toHaveBeenCalledTimes(3);
  });
});

describe('setLinkCheckSkipQuery', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => { db = makeDb(); });

  it('空数组返回 0', async () => {
    expect(await setLinkCheckSkipQuery(db, [], true)).toBe(0);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('skip=true → 1', async () => {
    await setLinkCheckSkipQuery(db, ['a'], true);
    expect(db.execute.mock.calls[0][1][0]).toBe(1);
  });

  it('skip=false → 0', async () => {
    await setLinkCheckSkipQuery(db, ['a'], false);
    expect(db.execute.mock.calls[0][1][0]).toBe(0);
  });

  it('累加 rowsAffected', async () => {
    db.execute.mockResolvedValueOnce({ rowsAffected: 3 }).mockResolvedValueOnce({ rowsAffected: 2 });
    const ids = Array.from({ length: 600 }, (_, i) => `id${i}`);
    const total = await setLinkCheckSkipQuery(db, ids, true);
    expect(total).toBe(5);
    expect(db.execute).toHaveBeenCalledTimes(2);
  });
});
