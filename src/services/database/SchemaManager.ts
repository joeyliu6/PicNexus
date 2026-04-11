/**
 * Schema 管理器
 *
 * 从 HistoryDatabase 提取的表/索引/迁移逻辑，全部幂等。
 * - createTablesAndIndexes: 建表 + 建索引（IF NOT EXISTS）
 * - runMigrations: 执行所有 schema 版本迁移（ALTER TABLE / 回填 / 建新索引）
 *
 * 约束：SQL 语句与原 HistoryDatabase.open() 完全一致，仅迁移位置。
 */

import type Database from '@tauri-apps/plugin-sql';
import { createLogger } from '../../utils/logger';

const log = createLogger('SchemaManager');

/**
 * 创建 history_items / sync_log 表及所有索引（幂等）
 */
export async function createTablesAndIndexes(db: Database): Promise<void> {
  // 创建表（如果不存在）
  await db.execute(`
    CREATE TABLE IF NOT EXISTS history_items (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      local_file_name TEXT NOT NULL,
      local_file_name_lower TEXT NOT NULL,
      file_path TEXT,
      primary_service TEXT NOT NULL,
      results TEXT NOT NULL,
      generated_link TEXT NOT NULL,
      link_check_status TEXT,
      link_check_summary TEXT,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      aspect_ratio REAL NOT NULL,
      file_size INTEGER NOT NULL,
      format TEXT NOT NULL,
      color_type TEXT NOT NULL,
      has_alpha INTEGER NOT NULL
    )
  `);

  // 创建索引
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_timestamp ON history_items(timestamp DESC)
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_service ON history_items(primary_service)
  `);
  // 复合索引：覆盖 WHERE primary_service = ? ORDER BY timestamp DESC 查询
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_service_timestamp ON history_items(primary_service, timestamp DESC)
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_filename_lower ON history_items(local_file_name_lower)
  `);
  // 添加 file_path 索引，用于按文件路径快速查询
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_file_path ON history_items(file_path)
  `);

  // 创建同步日志表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      operation TEXT NOT NULL,
      result TEXT NOT NULL,
      details TEXT,
      profile_id TEXT,
      profile_name TEXT
    )
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_sync_log_timestamp ON sync_log(timestamp DESC)
  `);
}

/**
 * 运行所有 schema 迁移（幂等，按顺序执行）
 */
export async function runMigrations(db: Database): Promise<void> {
  await migrateAddFavoriteColumn(db);
  await migrateAddSuccessCountColumn(db);
  await migrateAddSuccessfulServiceIdsColumn(db);
}

/**
 * 检查 history_items 表中某列是否已存在
 */
async function columnExists(db: Database, columnName: string): Promise<boolean> {
  const rows = await db.select<{ name: string }[]>('PRAGMA table_info(history_items)');
  return rows.some((r) => r.name === columnName);
}

/**
 * 迁移：添加 is_favorited 列（幂等）
 */
async function migrateAddFavoriteColumn(db: Database): Promise<void> {
  try {
    if (await columnExists(db, 'is_favorited')) return;

    await db.execute(
      `ALTER TABLE history_items ADD COLUMN is_favorited INTEGER NOT NULL DEFAULT 0`
    );
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_favorited ON history_items(is_favorited, timestamp DESC)`
    );
    log.info('迁移完成：添加 is_favorited 列');
  } catch (error) {
    log.error('迁移 is_favorited 列失败:', error);
    throw error;
  }
}

/**
 * 迁移：添加 success_count 列（幂等）
 * 冗余存储"成功上传图床数"，避免查询时全表 JSON 解析
 */
async function migrateAddSuccessCountColumn(db: Database): Promise<void> {
  try {
    if (await columnExists(db, 'success_count')) return;

    await db.execute(
      `ALTER TABLE history_items ADD COLUMN success_count INTEGER NOT NULL DEFAULT 0`
    );

    // 回填：用 SQLite 原生 json_each 在 DB 层完成，不经过 JS
    await db.execute(`
      UPDATE history_items SET success_count = (
        SELECT COUNT(*) FROM json_each(results) AS je
        WHERE je.value ->> 'status' = 'success'
      )
    `);

    // 复合索引：同时覆盖筛选（success_count）和排序（timestamp DESC）
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_success_count ON history_items(success_count, timestamp DESC)`
    );

    log.info('迁移完成：添加 success_count 列并回填');
  } catch (error) {
    log.error('迁移 success_count 列失败:', error);
    throw error;
  }
}

/**
 * 迁移：添加 successful_service_ids 列（幂等）
 * 冗余存储"成功上传到了哪些图床"的 JSON 数组，避免 getServiceDistribution 全表 json_each
 */
async function migrateAddSuccessfulServiceIdsColumn(db: Database): Promise<void> {
  try {
    if (await columnExists(db, 'successful_service_ids')) return;

    await db.execute(
      `ALTER TABLE history_items ADD COLUMN successful_service_ids TEXT NOT NULL DEFAULT '[]'`
    );

    // 回填：用 SQLite 原生 json_group_array 在 DB 层完成
    await db.execute(`
      UPDATE history_items SET successful_service_ids = (
        SELECT COALESCE(json_group_array(je.value ->> 'serviceId'), '[]')
        FROM json_each(results) AS je
        WHERE je.value ->> 'status' = 'success'
      )
    `);

    log.info('迁移完成：添加 successful_service_ids 列并回填');
  } catch (error) {
    log.error('迁移 successful_service_ids 列失败:', error);
    throw error;
  }
}
