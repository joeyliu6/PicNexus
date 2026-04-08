/**
 * 同步日志服务
 *
 * 从 HistoryDatabase 提取的同步日志相关 SQL 操作
 */

import type Database from '@tauri-apps/plugin-sql';
import type { SyncLogEntry, SyncLogOperation } from './types';

/**
 * 写入一条同步操作日志，超出 20 条时自动删除最旧的
 */
export async function addSyncLogQuery(db: Database, entry: SyncLogEntry): Promise<void> {
  await db.execute(
    `INSERT INTO sync_log (id, timestamp, operation, result, details, profile_id, profile_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [entry.id, entry.timestamp, entry.operation, entry.result,
     entry.details ?? null, entry.profileId ?? null, entry.profileName ?? null]
  );
  // 只保留最新 20 条
  await db.execute(`
    DELETE FROM sync_log
    WHERE id NOT IN (
      SELECT id FROM sync_log ORDER BY timestamp DESC LIMIT 20
    )
  `);
}

/**
 * 读取同步日志，按时间倒序
 */
export async function getSyncLogsQuery(db: Database, limit = 20): Promise<SyncLogEntry[]> {
  const rows = await db.select<{
    id: string;
    timestamp: number;
    operation: string;
    result: string;
    details: string | null;
    profile_id: string | null;
    profile_name: string | null;
  }[]>(
    `SELECT id, timestamp, operation, result, details, profile_id, profile_name
     FROM sync_log ORDER BY timestamp DESC LIMIT $1`,
    [limit]
  );
  return rows.map(r => ({
    id: r.id,
    timestamp: r.timestamp,
    operation: r.operation as SyncLogOperation,
    result: r.result as 'success' | 'failed',
    details: r.details ?? undefined,
    profileId: r.profile_id ?? undefined,
    profileName: r.profile_name ?? undefined,
  }));
}

/**
 * 清空所有同步日志
 */
export async function clearSyncLogsQuery(db: Database): Promise<void> {
  await db.execute(`DELETE FROM sync_log`);
}
