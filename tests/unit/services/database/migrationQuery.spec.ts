import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getItemsByIdsQuery } from '@/services/database/MigrationQuery';

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
