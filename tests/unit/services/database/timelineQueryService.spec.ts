import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getDayStatsQuery,
  getItemsByDayRangeQuery,
  getDayAspectRatiosByRangeQuery,
  getAllAspectRatiosQuery,
} from '@/services/database/TimelineQueryService';

function makeDb(): any {
  return {
    select: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
  };
}

describe('getDayStatsQuery', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => { db = makeDb(); });

  it('空 filter → 无 WHERE', async () => {
    await getDayStatsQuery(db);
    const sql = db.select.mock.calls[0][0] as string;
    expect(sql).not.toContain('WHERE');
    expect(db.select.mock.calls[0][1]).toEqual([]);
  });

  it('favoritesOnly → 加 is_favorited=1 条件', async () => {
    await getDayStatsQuery(db, { favoritesOnly: true } as any);
    const sql = db.select.mock.calls[0][0] as string;
    expect(sql).toContain('is_favorited = 1');
  });

  it('serviceFilter 指定具体图床', async () => {
    await getDayStatsQuery(db, { serviceFilter: 'weibo' } as any);
    const params = db.select.mock.calls[0][1];
    expect(params).toContain('weibo');
  });

  it('serviceFilter=all → 无图床过滤', async () => {
    await getDayStatsQuery(db, { serviceFilter: 'all' } as any);
    const params = db.select.mock.calls[0][1];
    expect(params).toEqual([]);
  });

  it('searchTerm 加 LIKE 条件 + 转义通配符', async () => {
    await getDayStatsQuery(db, { searchTerm: 'abc%' } as any);
    const params = db.select.mock.calls[0][1];
    expect(params[0]).toBe('%abc\\%%');
  });

  it('searchTerm 纯空白 → 不加 LIKE', async () => {
    await getDayStatsQuery(db, { searchTerm: '   ' } as any);
    const params = db.select.mock.calls[0][1];
    expect(params).toEqual([]);
  });

  it('多个 filter 组合', async () => {
    await getDayStatsQuery(db, {
      favoritesOnly: true,
      serviceFilter: 'r2',
      searchTerm: 'foo',
    } as any);
    const params = db.select.mock.calls[0][1];
    expect(params).toContain('r2');
    expect(params).toContain('%foo%');
  });

  it('映射 DB 行为 DayStats', async () => {
    db.select.mockResolvedValue([
      { year: 2026, month: 3, day: 15, count: 10, aspect_ratio_sum: 15.5, min_timestamp: 1, max_timestamp: 100 },
    ]);
    const result = await getDayStatsQuery(db);
    expect(result[0]).toEqual({
      year: 2026, month: 3, day: 15, count: 10, aspectRatioSum: 15.5,
      minTimestamp: 1, maxTimestamp: 100,
    });
  });
});

describe('getItemsByDayRangeQuery', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => { db = makeDb(); });

  it('传入 startTs / endTs 作为前两个参数', async () => {
    await getItemsByDayRangeQuery(db, 100, 200);
    const params = db.select.mock.calls[0][1];
    expect(params[0]).toBe(100);
    expect(params[1]).toBe(200);
  });

  it('映射 MetaRow 为 ImageMeta，包含 primary_service hit 的 fileKey', async () => {
    const results = JSON.stringify([
      { serviceId: 'weibo', status: 'success', result: { url: 'https://u', fileKey: 'key-weibo' } },
      { serviceId: 'r2', status: 'failed' },
    ]);
    db.select.mockResolvedValue([{
      id: 'i1', timestamp: 1000, local_file_name: 'a.png',
      aspect_ratio: 1.5, primary_service: 'weibo',
      generated_link: 'https://u', results, is_favorited: 1,
    }]);
    const metas = await getItemsByDayRangeQuery(db, 0, 2000);
    expect(metas[0]).toMatchObject({
      id: 'i1', timestamp: 1000, localFileName: 'a.png',
      aspectRatio: 1.5, primaryService: 'weibo',
      primaryUrl: 'https://u', primaryFileKey: 'key-weibo',
      isFavorited: true,
    });
  });

  it('results JSON 损坏 → primaryFileKey 为 undefined 不抛错', async () => {
    db.select.mockResolvedValue([{
      id: 'i1', timestamp: 1, local_file_name: '', aspect_ratio: 0,
      primary_service: 'weibo', generated_link: '', results: '{bad',
      is_favorited: 0,
    }]);
    const metas = await getItemsByDayRangeQuery(db, 0, 100);
    expect(metas[0].primaryFileKey).toBeUndefined();
  });

  it('aspect_ratio 为 0 → 兜底 1.0', async () => {
    db.select.mockResolvedValue([{
      id: 'i1', timestamp: 1, local_file_name: '', aspect_ratio: 0,
      primary_service: 'weibo', generated_link: '', results: '[]',
      is_favorited: 0,
    }]);
    const metas = await getItemsByDayRangeQuery(db, 0, 100);
    expect(metas[0].aspectRatio).toBe(1.0);
  });

  it('is_favorited=0 → false', async () => {
    db.select.mockResolvedValue([{
      id: 'i1', timestamp: 1, local_file_name: '', aspect_ratio: 1,
      primary_service: 'weibo', generated_link: '', results: '[]',
      is_favorited: 0,
    }]);
    const metas = await getItemsByDayRangeQuery(db, 0, 100);
    expect(metas[0].isFavorited).toBe(false);
  });

  it('filter 加入参数（timestamp 条件已占位 $1 $2）', async () => {
    await getItemsByDayRangeQuery(db, 0, 100, { serviceFilter: 'r2' } as any);
    const params = db.select.mock.calls[0][1];
    expect(params.slice(0, 2)).toEqual([0, 100]);
    expect(params).toContain('r2');
  });
});

describe('getDayAspectRatiosByRangeQuery', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => { db = makeDb(); });

  it('返回 id / timestamp / aspectRatio', async () => {
    db.select.mockResolvedValue([
      { id: 'a', timestamp: 1, aspect_ratio: 2.5 },
      { id: 'b', timestamp: 2, aspect_ratio: null },
    ]);
    const rows = await getDayAspectRatiosByRangeQuery(db, 0, 100);
    expect(rows[0]).toEqual({ id: 'a', timestamp: 1, aspectRatio: 2.5 });
    expect(rows[1].aspectRatio).toBe(1.0); // null 兜底 1.0
  });

  it('SQL 里用 timestamp >= $1 AND timestamp <= $2', async () => {
    await getDayAspectRatiosByRangeQuery(db, 10, 20);
    const sql = db.select.mock.calls[0][0] as string;
    expect(sql).toContain('timestamp >= $1');
    expect(sql).toContain('timestamp <= $2');
  });
});

describe('getAllAspectRatiosQuery', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => { db = makeDb(); });

  it('无 filter → 无 WHERE', async () => {
    await getAllAspectRatiosQuery(db);
    const sql = db.select.mock.calls[0][0] as string;
    expect(sql).not.toContain('WHERE');
  });

  it('favoritesOnly → 加 WHERE', async () => {
    await getAllAspectRatiosQuery(db, { favoritesOnly: true } as any);
    const sql = db.select.mock.calls[0][0] as string;
    expect(sql).toContain('WHERE');
  });

  it('空结果返回空数组', async () => {
    db.select.mockResolvedValue([]);
    expect(await getAllAspectRatiosQuery(db)).toEqual([]);
  });
});
