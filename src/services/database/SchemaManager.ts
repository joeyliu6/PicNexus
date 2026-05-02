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
      has_alpha INTEGER NOT NULL,
      is_favorited INTEGER NOT NULL DEFAULT 0,
      favorite_updated_at INTEGER NOT NULL DEFAULT 0,
      favorite_updated_by TEXT,
      success_count INTEGER NOT NULL DEFAULT 0,
      successful_service_ids TEXT NOT NULL DEFAULT '[]',
      migration_skip INTEGER NOT NULL DEFAULT 0,
      link_check_skip INTEGER NOT NULL DEFAULT 0
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
 *
 * 注意：tauri-plugin-sql 的 JS API 基于 sqlx 连接池，每次 execute/select 都会
 * 从池中临时借用一根连接用完即归还；BEGIN/COMMIT 无法跨多次调用保持在同一连接上，
 * 因此**不能用显式事务包裹**（详见 plugins-workspace issue #886）。
 *
 * 幂等保证：每个子迁移内部都通过 columnExists + IF NOT EXISTS 兜底，
 * 即使上次半途失败（列已加但索引/回填未完成），本次启动仍会补齐缺失步骤。
 */
export async function runMigrations(db: Database): Promise<void> {
  await migrateAddFavoriteColumn(db);
  await migrateAddFavoriteSyncColumns(db);
  await migrateAddSuccessCountColumn(db);
  await migrateAddSuccessfulServiceIdsColumn(db);
  await migrateAddMigrationSkipColumn(db);
  await migrateAddLinkCheckSkipColumn(db);
}

/**
 * 检查 history_items 表中某列是否已存在
 */
async function columnExists(db: Database, columnName: string): Promise<boolean> {
  const rows = await db.select<{ name: string }[]>('PRAGMA table_info(history_items)');
  return rows.some((r) => r.name === columnName);
}

function isDuplicateColumnError(error: unknown, columnName: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes('duplicate column name') && normalized.includes(columnName.toLowerCase());
}

async function addColumnIfMissing(db: Database, columnName: string, sql: string): Promise<boolean> {
  if (await columnExists(db, columnName)) return false;

  try {
    await db.execute(sql);
    return true;
  } catch (error) {
    if (isDuplicateColumnError(error, columnName)) {
      log.warn(`迁移跳过：${columnName} 列已存在`);
      return false;
    }
    throw error;
  }
}

/**
 * 迁移：添加 is_favorited 列（幂等）
 */
async function migrateAddFavoriteColumn(db: Database): Promise<void> {
  try {
    if (await addColumnIfMissing(
      db,
      'is_favorited',
      `ALTER TABLE history_items ADD COLUMN is_favorited INTEGER NOT NULL DEFAULT 0`
    )) {
      log.info('迁移完成：添加 is_favorited 列');
    }
    // 索引创建与列添加解耦：若上次迁移半途失败（列已加但索引未建），本次仍可补建
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_favorited ON history_items(is_favorited, timestamp DESC)`
    );
  } catch (error) {
    log.error('迁移 is_favorited 列失败:', error);
    throw error;
  }
}

async function migrateAddFavoriteSyncColumns(db: Database): Promise<void> {
  try {
    await addColumnIfMissing(
      db,
      'favorite_updated_at',
      `ALTER TABLE history_items ADD COLUMN favorite_updated_at INTEGER NOT NULL DEFAULT 0`
    );
    await addColumnIfMissing(
      db,
      'favorite_updated_by',
      `ALTER TABLE history_items ADD COLUMN favorite_updated_by TEXT`
    );

    // 只给已有收藏记录建立 legacy 版本。未收藏旧记录保持 0，避免压制其他设备的旧收藏。
    await db.execute(`
      UPDATE history_items
      SET
        favorite_updated_at = CASE
          WHEN favorite_updated_at IS NULL OR favorite_updated_at <= 0 THEN timestamp
          ELSE favorite_updated_at
        END,
        favorite_updated_by = CASE
          WHEN favorite_updated_by IS NULL OR favorite_updated_by = '' THEN 'legacy'
          ELSE favorite_updated_by
        END
      WHERE is_favorited = 1
    `);
  } catch (error) {
    log.error('迁移收藏同步字段失败:', error);
    throw error;
  }
}

/**
 * 迁移：添加 success_count 列（幂等）
 * 冗余存储"成功上传图床数"，避免查询时全表 JSON 解析
 */
async function migrateAddSuccessCountColumn(db: Database): Promise<void> {
  try {
    if (await addColumnIfMissing(
      db,
      'success_count',
      `ALTER TABLE history_items ADD COLUMN success_count INTEGER NOT NULL DEFAULT 0`
    )) {

      // 回填：用 SQLite 原生 json_each 在 DB 层完成，不经过 JS
      // WHERE json_valid 防御：若某行 results 被第三方工具污染成非法 JSON，
      // json_each 会让整条 UPDATE 失败；过滤掉坏行后其他正常行仍能正确回填。
      await db.execute(`
        UPDATE history_items SET success_count = (
          SELECT COUNT(*) FROM json_each(results) AS je
          WHERE je.value ->> 'status' = 'success'
        ) WHERE json_valid(results) = 1
      `);

      log.info('迁移完成：添加 success_count 列并回填');
    }
    // 复合索引：同时覆盖筛选（success_count）和排序（timestamp DESC）
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_success_count ON history_items(success_count, timestamp DESC)`
    );
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
    const added = await addColumnIfMissing(
      db,
      'successful_service_ids',
      `ALTER TABLE history_items ADD COLUMN successful_service_ids TEXT NOT NULL DEFAULT '[]'`
    );
    if (!added) return;

    // 回填：用 SQLite 原生 json_group_array 在 DB 层完成
    // WHERE json_valid 防御非法 JSON 行（详见 migrateAddSuccessCountColumn 注释）
    await db.execute(`
      UPDATE history_items SET successful_service_ids = (
        SELECT COALESCE(json_group_array(je.value ->> 'serviceId'), '[]')
        FROM json_each(results) AS je
        WHERE je.value ->> 'status' = 'success'
      ) WHERE json_valid(results) = 1
    `);

    log.info('迁移完成：添加 successful_service_ids 列并回填');
  } catch (error) {
    log.error('迁移 successful_service_ids 列失败:', error);
    throw error;
  }
}

/**
 * 迁移：添加 migration_skip 列（幂等）
 * 批量迁移失败项手动「跳过」写入此字段，下次扫描不再入队
 */
async function migrateAddMigrationSkipColumn(db: Database): Promise<void> {
  try {
    if (await addColumnIfMissing(
      db,
      'migration_skip',
      `ALTER TABLE history_items ADD COLUMN migration_skip INTEGER NOT NULL DEFAULT 0`
    )) {
      log.info('迁移完成：添加 migration_skip 列');
    }
    // 复合索引：覆盖 WHERE migration_skip = 0 AND ... ORDER BY timestamp DESC
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_migration_skip ON history_items(migration_skip, timestamp DESC)`
    );
  } catch (error) {
    log.error('迁移 migration_skip 列失败:', error);
    throw error;
  }
}

async function migrateAddLinkCheckSkipColumn(db: Database): Promise<void> {
  try {
    if (await addColumnIfMissing(
      db,
      'link_check_skip',
      `ALTER TABLE history_items ADD COLUMN link_check_skip INTEGER NOT NULL DEFAULT 0`
    )) {
      log.info('迁移完成：添加 link_check_skip 列');
    }
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_link_check_skip ON history_items(link_check_skip, timestamp DESC)`
    );
  } catch (error) {
    log.error('迁移 link_check_skip 列失败', error);
    throw error;
  }
}
