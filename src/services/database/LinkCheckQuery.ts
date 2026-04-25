import type Database from '@tauri-apps/plugin-sql';
import type { LinkCheckLiteRow } from './types';
import { createLogger } from '../../utils/logger';

const log = createLogger('LinkCheckQuery');

export async function getLinkCheckInvalidQuery(
  db: Database,
): Promise<LinkCheckLiteRow[]> {
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
      [batchSize, offset],
    );

    if (rows.length === 0) break;

    const filteredRows = rows.filter((row) => !loadedIds.has(row.id));
    if (filteredRows.length > 0) {
      yield filteredRows;
    }

    offset += batchSize;
    if (rows.length < batchSize) break;
  }
}

/**
 * 批量读取指定 id 的 link_check_status + results 上下文
 * 用于子集复检场景：写回前先 merge 已存在的其他图床状态，避免被误覆盖
 */
export async function getLinkCheckContextByIdsQuery(
  db: Database,
  ids: string[],
): Promise<Map<string, { results: string | null; linkCheckStatus: string | null }>> {
  const map = new Map<string, { results: string | null; linkCheckStatus: string | null }>();
  if (ids.length === 0) return map;

  const batchSize = 200;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const placeholders = batch.map((_, j) => `$${j + 1}`).join(',');
    const rows = await db.select<Array<{ id: string; results: string | null; link_check_status: string | null }>>(
      `SELECT id, results, link_check_status
       FROM history_items
       WHERE id IN (${placeholders})`,
      batch,
    );
    for (const row of rows) {
      map.set(row.id, { results: row.results, linkCheckStatus: row.link_check_status });
    }
  }
  return map;
}

export async function batchUpdateLinkCheckStatusQuery(
  db: Database,
  updates: Array<{
    id: string;
    linkCheckStatus: string;
    linkCheckSummary: string;
  }>,
): Promise<void> {
  if (updates.length === 0) return;
  const batchSize = 200;

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    const ids = batch.map((_, j) => `$${j + 1}`).join(',');
    const statusCases = batch
      .map((_, j) => `WHEN id = $${j + 1} THEN $${batch.length + j * 2 + 1}`)
      .join(' ');
    const summaryCases = batch
      .map((_, j) => `WHEN id = $${j + 1} THEN $${batch.length + j * 2 + 2}`)
      .join(' ');
    const params = [
      ...batch.map((update) => update.id),
      ...batch.flatMap((update) => [update.linkCheckStatus, update.linkCheckSummary]),
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
