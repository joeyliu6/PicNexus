/**
 * 批量迁移查询
 *
 * 从 HistoryDatabase 提取的批量迁移筛选相关 SQL 操作
 */

import type Database from '@tauri-apps/plugin-sql';
import type { HistoryItem } from '../../config/types';
import { type HistoryItemRow, COLUMNS_SQL, rowToItem } from './DataTransformer';
import { createLogger } from '../../utils/logger';
import type { MigrateScope } from '../../types/batchMigrate';

const log = createLogger('MigrationQuery');

export type ServiceDistributionMode = 'successful' | 'valid-source';

function column(name: string, tableAlias?: string): string {
  return tableAlias ? `${tableAlias}.${name}` : name;
}

function normalizeServiceIds(hasServiceId?: string | string[]): string[] {
  if (Array.isArray(hasServiceId)) return hasServiceId;
  if (hasServiceId && hasServiceId !== 'all') return [hasServiceId];
  return [];
}

function pushSuccessfulServiceFilter(
  conditions: string[],
  params: (string | number)[],
  ids: string[],
  tableAlias?: string,
): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(id => { params.push(id); return `$${params.length}`; }).join(', ');
  conditions.push(
    `EXISTS (SELECT 1 FROM json_each(${column('successful_service_ids', tableAlias)}) AS _s WHERE _s.value IN (${placeholders}))`,
  );
}

function pushValidSourceFilter(
  conditions: string[],
  params: (string | number)[],
  ids: string[],
  tableAlias?: string,
): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(id => { params.push(id); return `$${params.length}`; }).join(', ');
  const linkStatus = column('link_check_status', tableAlias);
  const successIds = column('successful_service_ids', tableAlias);
  conditions.push(`
    EXISTS (
      SELECT 1 FROM json_each(${linkStatus}) AS _valid_src
      WHERE _valid_src.key IN (${placeholders})
        AND json_extract(_valid_src.value, '$.isValid') = 1
        AND EXISTS (
          SELECT 1 FROM json_each(${successIds}) AS _s_valid_src
          WHERE _s_valid_src.value = _valid_src.key
        )
    )
  `);
}

function pushRecoverableBrokenLinkFilter(conditions: string[], tableAlias?: string): void {
  const linkStatus = column('link_check_status', tableAlias);
  const successIds = column('successful_service_ids', tableAlias);
  conditions.push(`${linkStatus} IS NOT NULL`);
  conditions.push(`json_valid(${linkStatus}) = 1`);
  conditions.push(`
    EXISTS (
      SELECT 1 FROM json_each(${linkStatus}) AS _invalid
      WHERE json_extract(_invalid.value, '$.isValid') = 0
        AND COALESCE(json_extract(_invalid.value, '$.errorType'), '') != 'pending'
        AND EXISTS (
          SELECT 1 FROM json_each(${successIds}) AS _s_invalid
          WHERE _s_invalid.value = _invalid.key
        )
    )
  `);
  conditions.push(`
    EXISTS (
      SELECT 1 FROM json_each(${linkStatus}) AS _valid
      WHERE json_extract(_valid.value, '$.isValid') = 1
        AND EXISTS (
          SELECT 1 FROM json_each(${successIds}) AS _s_valid
          WHERE _s_valid.value = _valid.key
        )
    )
  `);
}

/**
 * 按成功上传的图床数量查询历史记录（用于批量迁移筛选）
 *
 * @param maxSuccessCount 最大成功图床数（如 1 表示「仅 1 个图床」，2 表示「≤ 2 个图床」）
 * @param serviceFilter 可选的来源图床过滤
 * @param timestampAfter 可选的时间范围过滤（仅返回该时间戳之后的记录）
 * @returns 符合条件的历史记录
 */
export async function getItemsByBackupCountQuery(
  db: Database,
  options: {
    maxSuccessCount: number;
    serviceFilter?: string;
    /** 筛选"在指定图床上有成功记录"的项目（基于 successful_service_ids），支持单个或多个 */
    hasServiceId?: string | string[];
    timestampAfter?: number;
    cursorTimestamp?: number;
    cursorId?: string;
    limit?: number;
    offset?: number;
    scope?: MigrateScope;
  },
): Promise<{ items: HistoryItem[]; total: number; hasMore: boolean }> {
  const {
    maxSuccessCount,
    serviceFilter,
    hasServiceId,
    timestampAfter,
    cursorTimestamp,
    cursorId,
    limit = 500,
    offset = 0,
    scope = 'all-backups',
  } = options;

  // 全部条件走索引 idx_success_count(success_count, timestamp DESC)
  // migration_skip = 0 过滤掉用户永久跳过的项
  const conditions: string[] = ['success_count > 0', 'migration_skip = 0', `success_count <= $1`];
  const params: (string | number)[] = [maxSuccessCount];

  if (serviceFilter && serviceFilter !== 'all') {
    params.push(serviceFilter);
    conditions.push(`primary_service = $${params.length}`);
  }

  if (scope === 'broken-with-valid-source') {
    pushRecoverableBrokenLinkFilter(conditions);
  }

  // hasServiceId 支持字符串或字符串数组。补救模式下它表示“可作为下载源的有效图床”。
  const ids = normalizeServiceIds(hasServiceId);
  if (scope === 'broken-with-valid-source') {
    pushValidSourceFilter(conditions, params, ids);
  } else {
    pushSuccessfulServiceFilter(conditions, params, ids);
  }

  if (timestampAfter) {
    params.push(timestampAfter);
    conditions.push(`timestamp >= $${params.length}`);
  }

  if (cursorTimestamp !== undefined && cursorId) {
    params.push(cursorTimestamp, cursorId);
    conditions.push(`(timestamp < $${params.length - 1} OR (timestamp = $${params.length - 1} AND id < $${params.length}))`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  // 总数查询（走索引，极快）
  const [countRow] = await db.select<{ cnt: number }[]>(
    `SELECT COUNT(*) AS cnt FROM history_items ${where}`, params
  );
  const total = countRow?.cnt ?? 0;

  // 分页查询（只传需要的行）
  const pageParams = [...params, limit, offset];
  const rows = await db.select<HistoryItemRow[]>(
    `SELECT ${COLUMNS_SQL} FROM history_items ${where}
     ORDER BY timestamp DESC, id DESC
     LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams
  );

  const items = rows.map(r => rowToItem(r));
  return { items, total, hasMore: offset + items.length < total };
}

/**
 * 获取备份数量统计摘要（用于迁移面板展示筛选维度）
 * 返回各备份数量区间的记录数
 */
export async function getBackupCountStatsQuery(
  db: Database,
): Promise<{ count1: number; count2: number; countAll: number }> {
  // 纯 SQL 聚合，走 idx_success_count 索引，<10ms
  const [row] = await db.select<{ count1: number; count2: number; countAll: number }[]>(`
    SELECT
      SUM(CASE WHEN success_count = 1 THEN 1 ELSE 0 END) AS count1,
      SUM(CASE WHEN success_count BETWEEN 1 AND 2 THEN 1 ELSE 0 END) AS count2,
      COUNT(*) AS countAll
    FROM history_items
    WHERE success_count > 0
  `);

  return { count1: row?.count1 ?? 0, count2: row?.count2 ?? 0, countAll: row?.countAll ?? 0 };
}

/**
 * 获取符合备份条件的记录中，各图床的已成功上传数量分布
 * 使用冗余列 successful_service_ids（轻量 JSON 数组）代替 json_each(results)（大 JSON 对象）
 */
export async function getServiceDistributionQuery(
  db: Database,
  options: {
    maxSuccessCount: number;
    serviceFilter?: string;
    /** 筛选"在指定图床上有成功记录"的项目（基于 successful_service_ids），支持单个或多个 */
    hasServiceId?: string | string[];
    /** 时间范围过滤（仅统计该时间戳之后的记录）— 与 getItemsByBackupCountQuery 保持一致 */
    timestampAfter?: number;
    scope?: MigrateScope;
    /** successful：统计已存在图床；valid-source：统计可作为补救下载源的有效图床 */
    distribution?: ServiceDistributionMode;
  },
): Promise<Map<string, number>> {
  const {
    maxSuccessCount,
    serviceFilter,
    hasServiceId,
    timestampAfter,
    scope = 'all-backups',
    distribution = 'successful',
  } = options;

  const conditions: string[] = ['h.success_count > 0', 'h.migration_skip = 0', `h.success_count <= $1`];
  const params: (string | number)[] = [maxSuccessCount];

  if (serviceFilter && serviceFilter !== 'all') {
    params.push(serviceFilter);
    conditions.push(`h.primary_service = $${params.length}`);
  }

  if (scope === 'broken-with-valid-source') {
    pushRecoverableBrokenLinkFilter(conditions, 'h');
  }

  const ids = normalizeServiceIds(hasServiceId);
  if (scope === 'broken-with-valid-source') {
    pushValidSourceFilter(conditions, params, ids, 'h');
  } else {
    pushSuccessfulServiceFilter(conditions, params, ids, 'h');
  }

  if (timestampAfter) {
    params.push(timestampAfter);
    conditions.push(`h.timestamp >= $${params.length}`);
  }

  const where = conditions.join(' AND ');

  const distributionSql = distribution === 'valid-source'
    ? `
      SELECT ls.key AS service_id, COUNT(*) AS cnt
      FROM history_items h, json_each(h.link_check_status) AS ls
      WHERE ${where}
        AND json_extract(ls.value, '$.isValid') = 1
        AND EXISTS (
          SELECT 1 FROM json_each(h.successful_service_ids) AS _s_dist
          WHERE _s_dist.value = ls.key
        )
      GROUP BY service_id
    `
    : `
      SELECT je.value AS service_id, COUNT(*) AS cnt
      FROM history_items h, json_each(h.successful_service_ids) AS je
      WHERE ${where}
      GROUP BY service_id
    `;

  const rows = await db.select<{ service_id: string; cnt: number }[]>(distributionSql, params);

  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.service_id, r.cnt);
  }
  return map;
}

/**
 * 按 ID 列表批量获取历史记录（阶段 3 单条重试用）
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

/**
 * 设置迁移跳过标志（单条）
 */
export async function setMigrationSkipQuery(db: Database, id: string, skip: boolean): Promise<void> {
  await db.execute(
    `UPDATE history_items SET migration_skip = $1 WHERE id = $2`,
    [skip ? 1 : 0, id],
  );
  log.debug(`设置迁移跳过: ${id} → ${skip}`);
}
