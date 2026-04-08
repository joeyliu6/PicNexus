/**
 * 收藏操作服务
 *
 * 从 HistoryDatabase 提取的收藏相关 SQL 操作
 */

import type Database from '@tauri-apps/plugin-sql';
import { createLogger } from '../../utils/logger';

const log = createLogger('FavoriteService');

/**
 * 设置收藏状态（单次 IPC，无需回读）
 */
export async function setFavoriteQuery(db: Database, id: string, favorited: boolean): Promise<void> {
  await db.execute(
    `UPDATE history_items SET is_favorited = $1 WHERE id = $2`,
    [favorited ? 1 : 0, id]
  );
  log.debug(`设置收藏: ${id} → ${favorited}`);
}

/**
 * 批量设置收藏状态
 */
export async function batchSetFavoriteQuery(db: Database, ids: string[], favorited: boolean): Promise<void> {
  if (ids.length === 0) return;
  const BATCH_SIZE = 500;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map((_, j) => `$${j + 2}`).join(',');
    await db.execute(
      `UPDATE history_items SET is_favorited = $1 WHERE id IN (${placeholders})`,
      [favorited ? 1 : 0, ...batch]
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
