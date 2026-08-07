import { describe, it, expect, vi, beforeEach } from 'vitest';
import { batchUpdateDimensionsQuery } from '@/services/database/MetadataQuery';

function makeDb(): any {
  return {
    execute: vi.fn().mockImplementation((_sql: string, params: unknown[]) =>
      Promise.resolve({ rowsAffected: params.length / 4 }),
    ),
    select: vi.fn().mockResolvedValue([]),
  };
}

describe('batchUpdateDimensionsQuery', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => { db = makeDb(); });

  it('空数组直接返回，不发 SQL', async () => {
    const count = await batchUpdateDimensionsQuery(db, []);

    expect(count).toBe(0);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('一批记录合并成一条 UPDATE，而不是逐条发', async () => {
    const count = await batchUpdateDimensionsQuery(db, [
      { id: 'a', width: 100, height: 50, aspectRatio: 2 },
      { id: 'b', width: 300, height: 300, aspectRatio: 1 },
    ]);

    expect(count).toBe(2);
    expect(db.execute).toHaveBeenCalledTimes(1);

    const [sql] = db.execute.mock.calls[0];
    expect(sql).toContain('width = CASE');
    expect(sql).toContain('height = CASE');
    expect(sql).toContain('aspect_ratio = CASE');
    expect(sql).toContain('WHERE id IN ($1,$2)');
  });

  it('参数按 [全部 id, 每条的 width/height/aspectRatio] 排布，占位符与之对齐', async () => {
    await batchUpdateDimensionsQuery(db, [
      { id: 'a', width: 100, height: 50, aspectRatio: 2 },
      { id: 'b', width: 300, height: 300, aspectRatio: 1 },
    ]);

    const [sql, params] = db.execute.mock.calls[0];

    expect(params).toEqual(['a', 'b', 100, 50, 2, 300, 300, 1]);
    // 第 1 行的三个值是 $3/$4/$5，第 2 行是 $6/$7/$8——错位会把宽写进高
    expect(sql).toContain('WHEN id = $1 THEN $3');
    expect(sql).toContain('WHEN id = $2 THEN $6');
    expect(sql).toContain('WHEN id = $1 THEN $4');
    expect(sql).toContain('WHEN id = $2 THEN $7');
    expect(sql).toContain('WHEN id = $1 THEN $5');
    expect(sql).toContain('WHEN id = $2 THEN $8');
  });

  it('超过单批上限时拆成多条语句', async () => {
    const updates = Array.from({ length: 450 }, (_, i) => ({
      id: `id-${i}`,
      width: 10,
      height: 10,
      aspectRatio: 1,
    }));

    const count = await batchUpdateDimensionsQuery(db, updates);

    expect(count).toBe(450);
    expect(db.execute).toHaveBeenCalledTimes(3); // 200 + 200 + 50
  });

  it('返回实际 rowsAffected 总和，而不是请求条数', async () => {
    db.execute.mockResolvedValue({ rowsAffected: 1 });

    const count = await batchUpdateDimensionsQuery(db, [
      { id: 'a', width: 100, height: 50, aspectRatio: 2 },
      { id: 'missing', width: 200, height: 100, aspectRatio: 2 },
    ]);

    expect(count).toBe(1);
  });

  it('跨批失败时抛出错误，携带已提交行数和已处理条数', async () => {
    const updates = Array.from({ length: 250 }, (_, i) => ({
      id: `id-${i}`,
      width: 10,
      height: 10,
      aspectRatio: 1,
    }));
    db.execute
      .mockResolvedValueOnce({ rowsAffected: 200 })
      .mockRejectedValueOnce(new Error('database locked'));

    await expect(batchUpdateDimensionsQuery(db, updates)).rejects.toMatchObject({
      name: 'DimensionBatchUpdateError',
      committedRows: 200,
      processedEntries: 200,
    });
  });

  it('缺省宽高走 itemToRow 的同一套兜底（0/0/1），不写入 undefined', async () => {
    await batchUpdateDimensionsQuery(db, [
      { id: 'a' } as never,
    ]);

    const [, params] = db.execute.mock.calls[0];
    expect(params).toEqual(['a', 0, 0, 1]);
  });
});
