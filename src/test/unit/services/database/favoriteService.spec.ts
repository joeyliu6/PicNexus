import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setFavoriteQuery,
  batchSetFavoriteQuery,
  getFavoriteCountQuery,
  getFavoriteIdListQuery,
} from '../../../../services/database/FavoriteService';

function makeDb(): any {
  return {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockResolvedValue([]),
  };
}

describe('FavoriteService', () => {
  let db: ReturnType<typeof makeDb>;
  const meta = { updatedAt: 1234, updatedBy: 'device-a' };

  beforeEach(() => {
    db = makeDb();
  });

  describe('setFavoriteQuery', () => {
    it('收藏 → is_favorited=1', async () => {
      await setFavoriteQuery(db, 'id1', true, meta);
      expect(db.execute).toHaveBeenCalledWith(
        expect.stringContaining('is_favorited = $1'),
        [1, 1234, 'device-a', 'id1'],
      );
    });

    it('取消收藏 → is_favorited=0', async () => {
      await setFavoriteQuery(db, 'id1', false, meta);
      expect(db.execute).toHaveBeenCalledWith(expect.any(String), [0, 1234, 'device-a', 'id1']);
    });
  });

  describe('batchSetFavoriteQuery', () => {
    it('空数组直接返回', async () => {
      await batchSetFavoriteQuery(db, [], true, meta);
      expect(db.execute).not.toHaveBeenCalled();
    });

    it('小批量一次 UPDATE', async () => {
      await batchSetFavoriteQuery(db, ['a', 'b', 'c'], true, meta);
      expect(db.execute).toHaveBeenCalledTimes(1);
      const call = db.execute.mock.calls[0];
      expect(call[1]).toEqual([1, 1234, 'device-a', 'a', 'b', 'c']);
      expect(call[0]).toContain('is_favorited != $1');
    });

    it('超过 500 条时分批', async () => {
      const ids = Array.from({ length: 1200 }, (_, i) => `id${i}`);
      await batchSetFavoriteQuery(db, ids, false, meta);
      // 1200 / 500 = 3 批
      expect(db.execute).toHaveBeenCalledTimes(3);
    });
  });

  describe('getFavoriteCountQuery', () => {
    it('返回 count', async () => {
      db.select.mockResolvedValue([{ count: 7 }]);
      expect(await getFavoriteCountQuery(db)).toBe(7);
    });

    it('空结果返回 0', async () => {
      db.select.mockResolvedValue([]);
      expect(await getFavoriteCountQuery(db)).toBe(0);
    });

    it('count 为 null 时返回 0', async () => {
      db.select.mockResolvedValue([{ count: null }]);
      expect(await getFavoriteCountQuery(db)).toBe(0);
    });
  });

  describe('getFavoriteIdListQuery', () => {
    it('把 rows 映射为 id 数组', async () => {
      db.select.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      expect(await getFavoriteIdListQuery(db)).toEqual(['a', 'b']);
    });

    it('uses id DESC to stabilize identical timestamps', async () => {
      await getFavoriteIdListQuery(db);
      expect(db.select.mock.calls[0][0]).toContain('ORDER BY timestamp DESC, id DESC');
    });
  });
});
