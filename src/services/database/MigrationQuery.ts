/**
 * 按 ID 批量取记录（图库详情缓存、补充备份用）
 */

import type Database from '@tauri-apps/plugin-sql';
import type { HistoryItem } from '@/config/types';
import { type HistoryItemRow, COLUMNS_SQL, rowToItem } from './DataTransformer';

/**
 * 按 ID 列表批量获取历史记录
 * 保留输入数组顺序
 */
export async function getItemsByIdsQuery(db: Database, ids: string[]): Promise<HistoryItem[]> {
  if (ids.length === 0) return [];

  const BATCH_SIZE = 500;
  const out: HistoryItem[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map((_, j) => `$${j + 1}`).join(',');
    const rows = await db.select<HistoryItemRow[]>(
      `SELECT ${COLUMNS_SQL} FROM history_items WHERE id IN (${placeholders})`,
      batch,
    );
    for (const r of rows) out.push(rowToItem(r));
  }
  // 按输入顺序重排（IN 的返回顺序不保证）
  const idx = new Map(ids.map((id, i) => [id, i]));
  out.sort((a, b) => (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0));
  return out;
}
