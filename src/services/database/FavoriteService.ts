/**
 * 收藏操作服务
 *
 * 从 HistoryDatabase 提取的收藏相关 SQL 操作
 */

import type Database from '@tauri-apps/plugin-sql';
import { createLogger } from '../../utils/logger';

const log = createLogger('FavoriteService');

export interface FavoriteChangeMeta {
  updatedAt: number;
  updatedBy: string;
}

/**
 * 设置收藏状态（单次 IPC，无需回读）
 */
export async function setFavoriteQuery(
  db: Database,
  id: string,
  favorited: boolean,
  meta: FavoriteChangeMeta,
): Promise<void> {
  await db.execute(
    `UPDATE history_items
     SET is_favorited = $1, favorite_updated_at = $2, favorite_updated_by = $3
     WHERE id = $4 AND is_favorited != $1`,
    [favorited ? 1 : 0, meta.updatedAt, meta.updatedBy, id]
  );
  log.debug(`设置收藏: ${id} → ${favorited}`);
}

/**
 * 批量设置收藏状态
 */
export async function batchSetFavoriteQuery(
  db: Database,
  ids: string[],
  favorited: boolean,
  meta: FavoriteChangeMeta,
): Promise<void> {
  if (ids.length === 0) return;
  const BATCH_SIZE = 500;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map((_, j) => `$${j + 4}`).join(',');
    await db.execute(
      `UPDATE history_items
       SET is_favorited = $1, favorite_updated_at = $2, favorite_updated_by = $3
       WHERE id IN (${placeholders}) AND is_favorited != $1`,
      [favorited ? 1 : 0, meta.updatedAt, meta.updatedBy, ...batch]
    );
  }
  log.info(`批量${favorited ? '收藏' : '取消收藏'} ${ids.length} 条记录`);
}

/**
 * 获取收藏总数
 */
export async function getFavoriteCountQuery(db: Database): Promise<number> {
  const result = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM history_items WHERE is_favorited = 1`
  );
  return result[0]?.count || 0;
}

/**
 * 获取所有收藏记录的 ID 列表（轻量级，仅 ID，无 JSON.parse）
 * 用于前端 favoriteSet 初始化，代替全量加载 metas
 */
export async function getFavoriteIdListQuery(db: Database): Promise<string[]> {
  const result = await db.select<{ id: string }[]>(
    `SELECT id FROM history_items WHERE is_favorited = 1 ORDER BY timestamp DESC, id DESC`
  );
  return result.map(r => r.id);
}
