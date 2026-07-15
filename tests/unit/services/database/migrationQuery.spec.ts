import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getItemsByBackupCountQuery,
  getBackupCountStatsQuery,
  getServiceDistributionQuery,
  getItemsByIdsQuery,
  setMigrationSkipQuery,
} from '@/services/database/MigrationQuery';

function makeDb(): any {
  return {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockResolvedValue([]),
  };
}

function makeRow(id: string, timestamp = 1000): any {
  return {
    id, timestamp,
    local_file_name: id, local_file_name_lower: id.toLowerCase(),
    file_path: null, primary_service: 'weibo', results: '[]',
    generated_link: 'http://u', link_check_status: null,
    link_check_summary: null, link_check_skip: 0,
    width: 100, height: 100, aspect_ratio: 1, file_size: 1,
    format: 'png', color_type: 'rgb', has_alpha: 0, is_favorited: 0,
    success_count: 1, successful_service_ids: '["weibo"]', migration_skip: 0,
  };
}

describe('getItemsByBackupCountQuery', () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => { db = makeDb(); });

  it('最基本查询 - 只传 maxSuccessCount', async () => {
    db.select
      .mockResolvedValueOnce([{ cnt: 5 }])
      .mockResolvedValueOnce([makeRow('a'), makeRow('b')]);
    const result = await getItemsByBackupCountQuery(db, { maxSuccessCount: 1 });
    expect(result.total).toBe(5);
    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    const params = db.select.mock.calls[0][1];
    expect(params[0]).toBe(1);
  });

  it('serviceFilter=all 不加过滤', async () => {
    db.select
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([]);
    await getItemsByBackupCountQuery(db, { maxSuccessCount: 2, serviceFilter: 'all' });
    const params = db.select.mock.calls[0][1];
    expect(params).toEqual([2]);
  });

  it('serviceFilter 指定图床', async () => {
    db.select
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([]);
    await getItemsByBackupCountQuery(db, { maxSuccessCount: 2, serviceFilter: 'weibo' });
    const params = db.select.mock.calls[0][1];
    expect(params).toContain('weibo');
  });

  it('hasServiceId 字符串形式', async () => {
    db.select
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([]);
    await getItemsByBackupCountQuery(db, { maxSuccessCount: 2, hasServiceId: 'weibo' });
    const params = db.select.mock.calls[0][1];
    expect(params).toContain('weibo');
  });

  it('hasServiceId = all 忽略', async () => {
    db.select
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([]);
    await getItemsByBackupCountQuery(db, { maxSuccessCount: 2, hasServiceId: 'all' });
    const params = db.select.mock.calls[0][1];
    expect(params).toEqual([2]);
  });

  it('hasServiceId 数组形式', async () => {
    db.select
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([]);
    await getItemsByBackupCountQuery(db, { maxSuccessCount: 2, hasServiceId: ['weibo', 'r2'] });
    const params = db.select.mock.calls[0][1];
    expect(params).toContain('weibo');
    expect(params).toContain('r2');
  });

  it('timestampAfter 追加条件', async () => {
    db.select
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([]);
    await getItemsByBackupCountQuery(db, { maxSuccessCount: 1, timestampAfter: 123456 });
    const params = db.select.mock.calls[0][1];
    expect(params).toContain(123456);
  });

  it('可恢复图片范围只返回同时有问题链接和有效源的记录', async () => {
    db.select
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([]);

    await getItemsByBackupCountQuery(db, {
      maxSuccessCount: 3,
      scope: 'broken-with-valid-source',
      hasServiceId: ['r2'],
    });

    const sql = db.select.mock.calls[0][0];
    const params = db.select.mock.calls[0][1];
    expect(sql).toContain('link_check_status');
    expect(sql).toContain("$.isValid");
    expect(sql).toContain("$.errorType");
    expect(params).toEqual([3, 'r2']);
  });

  it('hasMore = false 当 offset+len >= total', async () => {
    db.select
      .mockResolvedValueOnce([{ cnt: 2 }])
      .mockResolvedValueOnce([makeRow('a'), makeRow('b')]);
    const result = await getItemsByBackupCountQuery(db, { maxSuccessCount: 1 });
    expect(result.hasMore).toBe(false);
  });

  it('total 为 0 不抛错', async () => {
    db.select
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const result = await getItemsByBackupCountQuery(db, { maxSuccessCount: 1 });
    expect(result.total).toBe(0);
  });
});

describe('getBackupCountStatsQuery', () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => { db = makeDb(); });

  it('返回三个统计值', async () => {
    db.select.mockResolvedValue([{ count1: 10, count2: 20, countAll: 50 }]);
    expect(await getBackupCountStatsQuery(db)).toEqual({ count1: 10, count2: 20, countAll: 50 });
  });

  it('空结果全部为 0', async () => {
    db.select.mockResolvedValue([]);
    expect(await getBackupCountStatsQuery(db)).toEqual({ count1: 0, count2: 0, countAll: 0 });
  });
});

describe('getServiceDistributionQuery', () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => { db = makeDb(); });

  it('分组聚合转 Map', async () => {
    db.select.mockResolvedValue([
      { service_id: 'weibo', cnt: 10 },
      { service_id: 'r2', cnt: 5 },
    ]);
    const map = await getServiceDistributionQuery(db, { maxSuccessCount: 1 });
    expect(map.get('weibo')).toBe(10);
    expect(map.get('r2')).toBe(5);
  });

  it('serviceFilter / hasServiceId / timestampAfter 组合', async () => {
    db.select.mockResolvedValue([]);
    await getServiceDistributionQuery(db, {
      maxSuccessCount: 2,
      serviceFilter: 'weibo',
      hasServiceId: ['r2', 'aliyun'],
      timestampAfter: 5000,
    });
    const params = db.select.mock.calls[0][1];
    expect(params).toContain('weibo');
    expect(params).toContain('r2');
    expect(params).toContain('aliyun');
    expect(params).toContain(5000);
  });

  it('hasServiceId=all 忽略', async () => {
    db.select.mockResolvedValue([]);
    await getServiceDistributionQuery(db, { maxSuccessCount: 1, hasServiceId: 'all' });
    const params = db.select.mock.calls[0][1];
    expect(params).toEqual([1]);
  });

  it('可恢复图片来源分布统计有效下载源，而不是全部已存在图床', async () => {
    db.select.mockResolvedValue([
      { service_id: 'r2', cnt: 2 },
      { service_id: 'github', cnt: 1 },
    ]);

    const map = await getServiceDistributionQuery(db, {
      maxSuccessCount: 999,
      scope: 'broken-with-valid-source',
      distribution: 'valid-source',
    });

    const sql = db.select.mock.calls[0][0];
    expect(sql).toContain('json_each(h.link_check_status) AS ls');
    expect(sql).toContain('ls.key AS service_id');
    expect(sql).toContain("$.isValid");
    expect(map.get('r2')).toBe(2);
    expect(map.get('github')).toBe(1);
  });
});

describe('getItemsByIdsQuery', () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => { db = makeDb(); });

  it('空数组直接返回空', async () => {
    expect(await getItemsByIdsQuery(db, [])).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('保留输入顺序', async () => {
    db.select.mockResolvedValue([makeRow('b'), makeRow('a'), makeRow('c')]);
    const result = await getItemsByIdsQuery(db, ['a', 'b', 'c']);
    expect(result.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('超过 500 条时分批', async () => {
    const ids = Array.from({ length: 1200 }, (_, i) => `id${i}`);
    db.select.mockResolvedValue([]);
    await getItemsByIdsQuery(db, ids);
    expect(db.select).toHaveBeenCalledTimes(3);
  });
});

describe('setMigrationSkipQuery', () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => { db = makeDb(); });

  it('skip=true → 1', async () => {
    await setMigrationSkipQuery(db, 'id1', true);
    expect(db.execute).toHaveBeenCalledWith(expect.any(String), [1, 'id1']);
  });

  it('skip=false → 0', async () => {
    await setMigrationSkipQuery(db, 'id1', false);
    expect(db.execute).toHaveBeenCalledWith(expect.any(String), [0, 'id1']);
  });
});
