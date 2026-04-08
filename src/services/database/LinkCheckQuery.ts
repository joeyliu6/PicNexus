/**
 * 链接检测专用查询
 *
 * 从 HistoryDatabase 提取的链接检测相关 SQL 操作
 */

import type Database from '@tauri-apps/plugin-sql';
import type { LinkCheckLiteRow } from './types';
import { createLogger } from '../../utils/logger';

const log = createLogger('LinkCheckQuery');

/**
 * Phase 1：快速加载有失效/未检测链接的记录（通常几十~几百条）
 * 利用 link_check_summary 的 JSON 字段在 SQL 层过滤，避免全表扫描
 */
export async function getLinkCheckInvalidQuery(db: Database): Promise<LinkCheckLiteRow[]> {
  return db.select<LinkCheckLiteRow[]>(`
    SELECT id, local_file_name, primary_service, results, link_check_status
    FROM history_items
    WHERE link_check_summary IS NOT NULL
      AND (
        json_extract(link_check_summary, '$.invalidLinks') > 0
        OR json_extract(link_check_summary, '$.uncheckedLinks') > 0
      )
    ORDER BY timestamp DESC
  `);
}

/**
 * Phase 2：流式加载剩余记录（跳过 Phase 1 已加载的 ID）
 * 只查 5 个轻量字段，批大小 2000 减少查询次数
 */
export async function* getLinkCheckRestStreamQuery(
  db: Database,
  loadedIds: Set<string>,
  batchSize = 2000,
): AsyncGenerator<LinkCheckLiteRow[]> {
  let offset = 0;

  while (true) {
    const rows = await db.select<LinkCheckLiteRow[]>(
      `SELECT id, local_file_name, primary_service, results, link_check_status
       FROM history_items
       ORDER BY timestamp DESC
       LIMIT $1 OFFSET $2`,
      [batchSize, offset]
    );

    if (rows.length === 0) break;

    // 客户端过滤已加载的 ID
    const filtered = rows.filter((r) => !loadedIds.has(r.id));
    if (filtered.length > 0) {
      yield filtered;
    }

    offset += batchSize;
    if (rows.length < batchSize) break;
  }
}

/**
 * 批量更新链接检测状态（仅更新 link_check_status 和 link_check_summary 两列）
 * 每 200 条一批，避免单条逐次 update 导致的 O(n) 串行等待
 */
export async function batchUpdateLinkCheckStatusQuery(
  db: Database,
  updates: Array<{
    id: string;
    linkCheckStatus: string; // 已序列化的 JSON
    linkCheckSummary: string; // 已序列化的 JSON
  }>,
): Promise<void> {
  if (updates.length === 0) return;
  const BATCH_SIZE = 200;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    // 用 CASE/WHEN 在一条 SQL 中批量更新，大幅减少 IPC 往返
    const ids = batch.map((_, j) => `$${j + 1}`).join(',');
    const statusCases = batch.map((_, j) => `WHEN id = $${j + 1} THEN $${batch.length + j * 2 + 1}`).join(' ');
    const summaryCases = batch.map((_, j) => `WHEN id = $${j + 1} THEN $${batch.length + j * 2 + 2}`).join(' ');
    const params: (string)[] = [
      ...batch.map((u) => u.id),
      ...batch.flatMap((u) => [u.linkCheckStatus, u.linkCheckSummary]),
    ];
    await db.execute(
      `UPDATE history_items
       SET link_check_status = CASE ${statusCases} END,
           link_check_summary = CASE ${summaryCases} END
       WHERE id IN (${ids})`,
      params,
    );
  }
  log.info(`批量更新 ${updates.length} 条链接检测状态`);
}
