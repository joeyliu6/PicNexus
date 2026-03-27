/**
 * 历史记录 SQLite 数据库服务
 *
 * 使用 tauri-plugin-sql 提供的 SQLite 支持，实现高效的历史记录存储和查询
 * 支持 10 万条以上记录的分页加载和模糊搜索
 */

import Database from '@tauri-apps/plugin-sql';
import type { HistoryItem, ServiceType } from '../config/types';
import type { ImageMeta } from '../types/image-meta';
import { createLogger } from '../utils/logger';

const log = createLogger('HistoryDB');

/** 数据库文件名 */
const DB_PATH = 'sqlite:history.db';

/** 每页加载数量 */
const PAGE_SIZE = 500;

/** 分页查询选项 */
export interface PageOptions {
  page: number;
  pageSize?: number;
  serviceFilter?: ServiceType | 'all';
}

/** 分页查询结果 */
export interface PageResult {
  items: HistoryItem[];
  total: number;
  hasMore: boolean;
}

/** 搜索选项 */
export interface SearchOptions {
  serviceFilter?: ServiceType | 'all';
  limit?: number;
  offset?: number;
}

/** 搜索结果 */
export interface SearchResult {
  items: HistoryItem[];
  total: number;
  hasMore: boolean;
}

/** 时间段统计信息（用于时间轴显示） */
export interface TimePeriodStats {
  year: number;
  month: number;  // 0-11
  count: number;
  minTimestamp: number;
  maxTimestamp: number;
}

// ============================================
// 同步日志类型
// ============================================

export type SyncLogOperation =
  | 'export_settings_local'
  | 'import_settings_local'
  | 'export_history_local'
  | 'import_history_local'
  | 'upload_settings_cloud'
  | 'download_settings_cloud'
  | 'sync_settings'
  | 'upload_history_cloud'
  | 'download_history_cloud'
  | 'sync_history';

export interface SyncLogEntry {
  id: string;
  timestamp: number;
  operation: SyncLogOperation;
  result: 'success' | 'failed';
  details?: string;
  profileId?: string;
  profileName?: string;
}

/** 数据库行类型（与 SQL 表结构对应） */
interface HistoryItemRow {
  id: string;
  timestamp: number;
  local_file_name: string;
  local_file_name_lower: string;
  file_path: string | null;
  primary_service: string;
  results: string; // JSON 字符串
  generated_link: string;
  link_check_status: string | null; // JSON 字符串
  link_check_summary: string | null; // JSON 字符串
  // 图片元信息字段（用于 Justified Layout 布局）
  width: number;
  height: number;
  aspect_ratio: number;
  file_size: number;
  format: string;
  color_type: string;
  has_alpha: number; // SQLite 没有 boolean，使用 0/1
  is_favorited: number; // 0/1
}

/** 所有列名（INSERT/UPDATE 统一使用，新增列只需改这里） */
const ALL_COLUMNS = [
  'id', 'timestamp', 'local_file_name', 'local_file_name_lower', 'file_path',
  'primary_service', 'results', 'generated_link', 'link_check_status', 'link_check_summary',
  'width', 'height', 'aspect_ratio', 'file_size', 'format', 'color_type', 'has_alpha', 'is_favorited',
] as const;

const COLUMNS_SQL = ALL_COLUMNS.join(', ');
const COLUMN_COUNT = ALL_COLUMNS.length;

/** 从 row 对象按 ALL_COLUMNS 顺序提取值数组 */
function rowValues(row: HistoryItemRow): unknown[] {
  return ALL_COLUMNS.map(col => row[col]);
}

/** 生成 $1, $2, ..., $N 占位符，offset 为起始编号 */
function columnPlaceholders(offset = 1): string {
  return ALL_COLUMNS.map((_, i) => `$${offset + i}`).join(', ');
}

/**
 * 历史记录数据库类
 *
 * 单例模式，确保全局只有一个数据库连接
 */
class HistoryDatabase {
  private db: Database | null = null;
  private static instance: HistoryDatabase | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): HistoryDatabase {
    if (!HistoryDatabase.instance) {
      HistoryDatabase.instance = new HistoryDatabase();
    }
    return HistoryDatabase.instance;
  }

  /**
   * 打开数据库连接并初始化表结构
   */
  async open(): Promise<void> {
    if (this.initialized && this.db) {
      return;
    }

    try {
      log.debug('正在打开数据库...');
      this.db = await Database.load(DB_PATH);

      // 创建表（如果不存在）
      await this.db.execute(`
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
      await this.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_timestamp ON history_items(timestamp DESC)
      `);
      await this.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_service ON history_items(primary_service)
      `);
      // 复合索引：覆盖 WHERE primary_service = ? ORDER BY timestamp DESC 查询
      await this.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_service_timestamp ON history_items(primary_service, timestamp DESC)
      `);
      await this.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_filename_lower ON history_items(local_file_name_lower)
      `);
      // 添加 file_path 索引，用于按文件路径快速查询
      await this.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_file_path ON history_items(file_path)
      `);

      // 创建同步日志表
      await this.db.execute(`
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
      await this.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_sync_log_timestamp ON sync_log(timestamp DESC)
      `);

      // 迁移：添加收藏字段（幂等操作，已存在则忽略）
      await this.migrateAddFavoriteColumn();

      this.initialized = true;
      log.debug('数据库初始化完成');
    } catch (error) {
      log.error('数据库初始化失败:', error);
      throw error;
    }
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
      this.initialized = false;
      this.initPromise = null;
    }
  }

  /**
   * 确保数据库已初始化
   */
  private async ensureInitialized(): Promise<Database> {
    if (!this.initialized || !this.db) {
      if (!this.initPromise) {
        this.initPromise = this.open();
      }
      await this.initPromise;
    }
    return this.db!;
  }

  /**
   * 迁移：添加 is_favorited 列（幂等）
   */
  private async migrateAddFavoriteColumn(): Promise<void> {
    try {
      // 检查列是否已存在
      const rows = await this.db!.select<{ name: string }[]>(
        `PRAGMA table_info(history_items)`
      );
      const hasColumn = rows.some(r => r.name === 'is_favorited');
      if (hasColumn) return;

      await this.db!.execute(
        `ALTER TABLE history_items ADD COLUMN is_favorited INTEGER NOT NULL DEFAULT 0`
      );
      await this.db!.execute(
        `CREATE INDEX IF NOT EXISTS idx_favorited ON history_items(is_favorited, timestamp DESC)`
      );
      log.info('迁移完成：添加 is_favorited 列');
    } catch (error) {
      log.error('迁移 is_favorited 列失败:', error);
      throw error;
    }
  }

  // ============================================
  // 收藏操作
  // ============================================

  /**
   * 设置收藏状态（单次 IPC，无需回读）
   */
  async setFavorite(id: string, favorited: boolean): Promise<void> {
    const db = await this.ensureInitialized();
    await db.execute(
      `UPDATE history_items SET is_favorited = $1 WHERE id = $2`,
      [favorited ? 1 : 0, id]
    );
    log.debug(`设置收藏: ${id} → ${favorited}`);
  }

  /**
   * 批量设置收藏状态
   */
  async batchSetFavorite(ids: string[], favorited: boolean): Promise<void> {
    if (ids.length === 0) return;
    const db = await this.ensureInitialized();
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
  async getFavoriteCount(): Promise<number> {
    const db = await this.ensureInitialized();
    const result = await db.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM history_items WHERE is_favorited = 1`
    );
    return result[0]?.count || 0;
  }

  // ============================================
  // CRUD 操作
  // ============================================

  /**
   * 插入一条历史记录
   */
  async insert(item: HistoryItem): Promise<void> {
    const db = await this.ensureInitialized();

    const row = this.itemToRow(item);
    await db.execute(
      `INSERT INTO history_items (${COLUMNS_SQL}) VALUES (${columnPlaceholders()})`,
      rowValues(row)
    );
    log.debug(`插入记录: ${item.id}`);
  }

  /**
   * 插入一条历史记录（忽略重复 ID）
   * 作为最后防线，处理极端情况下的 ID 冲突
   * @returns 是否成功插入（false 表示记录已存在，被跳过）
   */
  async insertOrIgnore(item: HistoryItem): Promise<boolean> {
    const db = await this.ensureInitialized();

    const row = this.itemToRow(item);
    const result = await db.execute(
      `INSERT OR IGNORE INTO history_items (${COLUMNS_SQL}) VALUES (${columnPlaceholders()})`,
      rowValues(row)
    );

    const inserted = result.rowsAffected > 0;
    if (inserted) {
      log.debug(`插入记录: ${item.id}`);
    } else {
      log.warn(`记录已存在，跳过插入: ${item.id}（可能存在竞态或 UUID 碰撞）`);
    }
    return inserted;
  }

  /**
   * 更新一条历史记录
   */
  async update(id: string, updates: Partial<HistoryItem>): Promise<void> {
    const db = await this.ensureInitialized();

    // 先获取现有记录
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error(`记录不存在: ${id}`);
    }

    // 合并更新
    const updated: HistoryItem = { ...existing, ...updates };
    const row = this.itemToRow(updated);

    // UPDATE: 跳过 id 列（第 0 个），用剩余列生成 SET 子句
    const updateCols = ALL_COLUMNS.slice(1);
    const setClause = updateCols.map((col, i) => `${col} = $${i + 1}`).join(', ');
    const updateValues = updateCols.map(col => row[col]);

    await db.execute(
      `UPDATE history_items SET ${setClause} WHERE id = $${updateCols.length + 1}`,
      [...updateValues, id]
    );
    log.debug(`更新记录: ${id}`);
  }

  /**
   * 插入或更新一条记录（UPSERT）
   */
  async upsert(item: HistoryItem): Promise<void> {
    const db = await this.ensureInitialized();
    const row = this.itemToRow(item);

    await db.execute(
      `INSERT OR REPLACE INTO history_items (${COLUMNS_SQL}) VALUES (${columnPlaceholders()})`,
      rowValues(row)
    );
  }

  /**
   * 删除一条历史记录
   */
  async delete(id: string): Promise<void> {
    const db = await this.ensureInitialized();
    await db.execute('DELETE FROM history_items WHERE id = $1', [id]);
    log.debug(`删除记录: ${id}`);
  }

  /**
   * 批量删除历史记录
   */
  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const db = await this.ensureInitialized();
    // 生成 $1, $2, $3... 占位符
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    await db.execute(`DELETE FROM history_items WHERE id IN (${placeholders})`, ids);
    log.info(`批量删除 ${ids.length} 条记录`);
  }

  /**
   * 清空所有历史记录
   */
  async clear(): Promise<void> {
    const db = await this.ensureInitialized();
    await db.execute('DELETE FROM history_items');
    log.info('已清空所有记录');
  }

  // ============================================
  // 查询操作
  // ============================================

  /**
   * 根据 ID 获取单条记录
   */
  async getById(id: string): Promise<HistoryItem | null> {
    const db = await this.ensureInitialized();
    const rows = await db.select<HistoryItemRow[]>('SELECT * FROM history_items WHERE id = $1', [id]);

    if (rows.length === 0) {
      return null;
    }
    return this.rowToItem(rows[0]);
  }

  /**
   * 根据文件路径查询单条历史记录
   * @param filePath 文件的本地路径
   * @returns 匹配的历史记录，或 null
   */
  async getByFilePath(filePath: string): Promise<HistoryItem | null> {
    const db = await this.ensureInitialized();
    const rows = await db.select<HistoryItemRow[]>(
      'SELECT * FROM history_items WHERE file_path = $1 LIMIT 1',
      [filePath]
    );
    return rows.length > 0 ? this.rowToItem(rows[0]) : null;
  }

  /**
   * 构建带 COUNT(*) OVER() 窗口函数的分页查询，单次查询同时获取总数和分页数据
   */
  private async queryWithTotal(
    db: Awaited<ReturnType<typeof this.ensureInitialized>>,
    baseWhere: string,
    baseParams: (string | number)[],
    serviceFilter: string,
    limit: number,
    offset: number,
  ): Promise<{ items: HistoryItem[]; total: number; hasMore: boolean }> {
    const params: (string | number)[] = [...baseParams];
    let whereClause = baseWhere;

    const nextParam = () => `$${params.length + 1}`;

    if (serviceFilter !== 'all') {
      whereClause += whereClause ? ` AND primary_service = ${nextParam()}` : `WHERE primary_service = ${nextParam()}`;
      params.push(serviceFilter);
    }

    const limitOffset = `LIMIT ${nextParam()}`;
    params.push(limit);
    const offsetClause = `OFFSET ${nextParam()}`;
    params.push(offset);

    const rows = await db.select<(HistoryItemRow & { _total: number })[]>(
      `SELECT *, COUNT(*) OVER() as _total FROM history_items ${whereClause} ORDER BY timestamp DESC ${limitOffset} ${offsetClause}`,
      params
    );

    const total = rows[0]?._total || 0;
    const items = rows.map((row) => this.rowToItem(row));
    const hasMore = offset + items.length < total;
    return { items, total, hasMore };
  }

  /**
   * 分页获取历史记录
   */
  async getPage(options: PageOptions): Promise<PageResult> {
    const db = await this.ensureInitialized();
    const { page, pageSize = PAGE_SIZE, serviceFilter = 'all' } = options;
    const offset = (page - 1) * pageSize;
    return this.queryWithTotal(db, '', [], serviceFilter, pageSize, offset);
  }

  /**
   * 搜索历史记录（文件名模糊搜索）
   */
  async search(keyword: string, options: SearchOptions = {}): Promise<SearchResult> {
    const db = await this.ensureInitialized();
    const { serviceFilter = 'all', limit = 100, offset = 0 } = options;
    const keywordLower = keyword.toLowerCase().trim();

    // 转义 LIKE 通配符，防止用户输入 % 或 _ 导致意外匹配
    const escaped = keywordLower.replace(/[%_\\]/g, '\\$&');

    const result = await this.queryWithTotal(
      db, `WHERE local_file_name_lower LIKE $1 ESCAPE '\\'`, [`%${escaped}%`],
      serviceFilter, limit, offset,
    );
    log.debug(`搜索 "${keyword}": 找到 ${result.total} 条，返回 ${result.items.length} 条`);
    return result;
  }

  /**
   * 获取记录总数
   */
  async getCount(serviceFilter?: ServiceType | 'all'): Promise<number> {
    const db = await this.ensureInitialized();

    let query = 'SELECT COUNT(*) as count FROM history_items';
    const params: string[] = [];

    if (serviceFilter && serviceFilter !== 'all') {
      query += ' WHERE primary_service = $1';
      params.push(serviceFilter);
    }

    const result = await db.select<{ count: number }[]>(query, params);
    return result[0]?.count || 0;
  }

  /**
   * 获取所有时间段的统计信息（轻量级查询）
   * 只返回每个月份的记录数，不返回完整记录数据
   * 用于时间轴侧边栏显示完整的时间范围
   *
   * @returns 按时间降序排列的月份统计列表
   */
  async getTimePeriodStats(): Promise<TimePeriodStats[]> {
    const db = await this.ensureInitialized();

    // 使用 SQL 聚合查询，按年月分组统计
    // SQLite 的 strftime 从 timestamp（毫秒）提取年月
    // 注意：必须使用 'localtime' 修饰符，否则 UTC 时区会导致跨年/跨月边界错误
    const rows = await db.select<{
      year: number;
      month: number;
      count: number;
      min_timestamp: number;
      max_timestamp: number;
    }[]>(`
      SELECT
        CAST(strftime('%Y', timestamp / 1000, 'unixepoch', 'localtime') AS INTEGER) as year,
        CAST(strftime('%m', timestamp / 1000, 'unixepoch', 'localtime') AS INTEGER) - 1 as month,
        COUNT(*) as count,
        MIN(timestamp) as min_timestamp,
        MAX(timestamp) as max_timestamp
      FROM history_items
      GROUP BY year, strftime('%m', timestamp / 1000, 'unixepoch', 'localtime')
      ORDER BY year DESC, month DESC
    `);



    return rows.map(row => ({
      year: row.year,
      month: row.month,
      count: row.count,
      minTimestamp: row.min_timestamp,
      maxTimestamp: row.max_timestamp,
    }));
  }

  /**
   * 获取所有图片的元数据（轻量级查询）
   *
   * 性能优化：
   * - 只查询布局和缩略图必需的字段
   * - 避免查询 linkCheckStatus/linkCheckSummary 等重型字段
   * - 简化 results 解析，只提取 primaryFileKey
   *
   * @returns 按时间降序排列的元数据列表
   */
  async getMetaList(): Promise<ImageMeta[]> {
    const db = await this.ensureInitialized();

    // 只查询必需字段
    const rows = await db.select<{
      id: string;
      timestamp: number;
      local_file_name: string;
      aspect_ratio: number;
      primary_service: string;
      generated_link: string;
      results: string;  // JSON 字符串
      is_favorited: number;
    }[]>(`
      SELECT
        id,
        timestamp,
        local_file_name,
        aspect_ratio,
        primary_service,
        generated_link,
        results,
        is_favorited
      FROM history_items
      ORDER BY timestamp DESC
    `);



    // 转换为 ImageMeta
    return rows.map(row => {
      // 提取主力图床的 fileKey（轻量级 JSON 解析）
      let primaryFileKey: string | undefined;
      try {
        const results = JSON.parse(row.results) as Array<{
          serviceId: string;
          status: string;
          result?: { fileKey?: string; url?: string };
        }>;
        const primaryResult = results.find(
          r => r.serviceId === row.primary_service && r.status === 'success'
        );
        primaryFileKey = primaryResult?.result?.fileKey;
      } catch (e) {
        log.warn(`解析 results 失败: ${row.id}`, e);
      }

      return {
        id: row.id,
        timestamp: row.timestamp,
        localFileName: row.local_file_name || '',
        aspectRatio: row.aspect_ratio || 1.0,
        primaryService: row.primary_service as ServiceType,
        primaryUrl: row.generated_link,
        primaryFileKey,
        isFavorited: row.is_favorited === 1,
      };
    });
  }

  /**
   * 从指定时间戳开始分页加载数据
   * 用于时间轴跳转功能，从目标月份开始加载
   *
   * @param fromTimestamp 起始时间戳（加载该时间戳之前的数据）
   * @param pageSize 每页数量
   * @returns 分页结果
   */
  async getPageFromTimestamp(fromTimestamp: number, pageSize: number = PAGE_SIZE): Promise<PageResult> {
    const db = await this.ensureInitialized();

    // 获取该时间戳之前（含）的总数
    const countResult = await db.select<{ count: number }[]>(
      'SELECT COUNT(*) as count FROM history_items WHERE timestamp <= $1',
      [fromTimestamp]
    );
    const countBefore = countResult[0]?.count || 0;

    // 获取全部总数
    const totalResult = await db.select<{ count: number }[]>(
      'SELECT COUNT(*) as count FROM history_items'
    );
    const total = totalResult[0]?.count || 0;

    // 从该时间戳开始，按时间降序获取数据
    const rows = await db.select<HistoryItemRow[]>(
      `SELECT * FROM history_items
       WHERE timestamp <= $1
       ORDER BY timestamp DESC
       LIMIT $2`,
      [fromTimestamp, pageSize]
    );

    const items = rows.map(row => this.rowToItem(row));
    // 该时间戳之前的数据是否已全部加载
    const hasMore = items.length < countBefore;



    return { items, total, hasMore };
  }

  /**
   * 流式读取所有记录（用于检测界面）
   *
   * @param batchSize 每批读取的数量
   * @yields 每批记录数组
   */
  async *getAllStream(batchSize = 1000): AsyncGenerator<HistoryItem[]> {
    const db = await this.ensureInitialized();
    let offset = 0;

    while (true) {
      const rows = await db.select<HistoryItemRow[]>(
        'SELECT * FROM history_items ORDER BY timestamp DESC LIMIT $1 OFFSET $2',
        [batchSize, offset]
      );

      if (rows.length === 0) {
        break;
      }

      yield rows.map((row) => this.rowToItem(row));
      offset += batchSize;

      // 如果返回的数量小于批大小，说明已经到末尾
      if (rows.length < batchSize) {
        break;
      }
    }
  }

  // ============================================
  // 导入导出
  // ============================================

  /**
   * 批量查询已存在的记录（用于 merge 策略优化）
   * 一次性查询所有指定 ID 的记录，避免 N+1 查询问题
   *
   * @param ids 要查询的 ID 列表
   * @returns 存在的记录的 id 和 timestamp 映射
   */
  private async getExistingRecords(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) {
      return new Map();
    }

    const db = await this.ensureInitialized();
    const result = new Map<string, number>();

    // 分批查询，每批 500 个 ID，避免 SQL 语句过长
    const BATCH_SIZE = 500;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batchIds = ids.slice(i, i + BATCH_SIZE);
      const placeholders = batchIds.map((_, idx) => `$${idx + 1}`).join(',');
      const rows = await db.select<{ id: string; timestamp: number }[]>(
        `SELECT id, timestamp FROM history_items WHERE id IN (${placeholders})`,
        batchIds
      );
      for (const row of rows) {
        result.set(row.id, row.timestamp);
      }
    }

    return result;
  }

  /**
   * 批量插入或更新记录（高性能批量操作）
   * 使用单条 SQL 语句插入多条记录，显著提升导入性能
   *
   * @param items 要插入的记录列表
   */
  private async batchUpsert(items: HistoryItem[]): Promise<void> {
    if (items.length === 0) return;

    const db = await this.ensureInitialized();

    const values: unknown[] = [];
    const rowPlaceholders: string[] = [];
    let paramIndex = 1;

    for (const item of items) {
      const row = this.itemToRow(item);
      rowPlaceholders.push(`(${columnPlaceholders(paramIndex)})`);
      paramIndex += COLUMN_COUNT;
      values.push(...rowValues(row));
    }

    await db.execute(
      `INSERT OR REPLACE INTO history_items (${COLUMNS_SQL}) VALUES ${rowPlaceholders.join(', ')}`,
      values
    );
  }

  /**
   * 导出所有记录为 JSON 字符串
   * 使用流式读取降低内存峰值压力
   */
  async exportToJSON(): Promise<string> {
    const items: HistoryItem[] = [];
    // 分批读取，每批 1000 条，降低内存峰值
    for await (const batch of this.getAllStream(1000)) {
      items.push(...batch);
    }
    return JSON.stringify(items, null, 2);
  }

  /**
   * 从 JSON 导入记录（高性能批量导入）
   *
   * 优化说明：
   * - 使用批量插入替代逐条插入，大幅提升性能
   * - merge 策略使用一次性查询替代 N+1 查询
   * - 支持进度回调，便于 UI 显示导入进度
   *
   * @param json JSON 字符串
   * @param mergeStrategy 合并策略：replace 覆盖，merge 合并（相同 ID 保留较新的）
   * @param onProgress 可选的进度回调 (current, total) => void
   * @returns 导入的记录数
   */
  async importFromJSON(
    json: string,
    mergeStrategy: 'replace' | 'merge',
    onProgress?: (current: number, total: number) => void
  ): Promise<number> {
    const parsed = JSON.parse(json);

    if (!Array.isArray(parsed)) {
      throw new Error('无效的 JSON 格式：期望数组');
    }

    // 校验每条记录的必需字段，过滤掉格式不合法的数据
    const items = (parsed as HistoryItem[]).filter(item => {
      if (!item || typeof item !== 'object') return false;
      if (typeof item.timestamp !== 'number' || item.timestamp <= 0) return false;
      if (typeof item.localFileName !== 'string' || !item.localFileName) return false;
      if (typeof item.primaryService !== 'string' || !item.primaryService) return false;
      if (typeof item.generatedLink !== 'string') return false;
      if (!Array.isArray(item.results)) return false;
      return true;
    });

    if (items.length === 0 && parsed.length > 0) {
      throw new Error('导入数据格式不匹配，请检查文件是否为 PicNexus 导出的历史记录');
    }

    if (items.length < parsed.length) {
      log.warn(`导入校验: ${parsed.length} 条中有 ${parsed.length - items.length} 条格式无效被跳过`);
    }

    const db = await this.ensureInitialized();
    const BATCH_SIZE = 500;

    // replace 策略：先清空所有记录
    if (mergeStrategy === 'replace') {
      await db.execute('DELETE FROM history_items');
    }

    // 预处理：确保所有记录都有 ID
    for (const item of items) {
      if (!item.id) {
        item.id = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
      }
    }

    // 确定需要导入的记录
    let itemsToImport: HistoryItem[];

    if (mergeStrategy === 'merge') {
      // merge 策略：一次性查询所有已存在的记录（消除 N+1 查询）
      const allIds = items.map((item) => item.id);
      const existingMap = await this.getExistingRecords(allIds);

      // 过滤出需要导入的记录（不存在或时间戳更新）
      itemsToImport = items.filter((item) => {
        const existingTimestamp = existingMap.get(item.id);
        return !existingTimestamp || item.timestamp > existingTimestamp;
      });

      log.info(`merge 策略: ${items.length} 条中有 ${itemsToImport.length} 条需要导入`);
    } else {
      itemsToImport = items;
    }

    // 分批插入
    let importedCount = 0;
    for (let i = 0; i < itemsToImport.length; i += BATCH_SIZE) {
      const batch = itemsToImport.slice(i, i + BATCH_SIZE);
      await this.batchUpsert(batch);
      importedCount += batch.length;

      // 触发进度回调
      onProgress?.(importedCount, itemsToImport.length);
    }

    log.info(`导入完成: ${importedCount}/${items.length} 条`);
    return importedCount;
  }

  // ============================================
  // 数据转换
  // ============================================

  /**
   * 将 HistoryItem 转换为数据库行
   * 注意：color_type 和 has_alpha 字段已废弃，使用默认值以保持向后兼容
   */
  private itemToRow(item: HistoryItem): HistoryItemRow {
    return {
      id: item.id,
      timestamp: item.timestamp,
      local_file_name: item.localFileName,
      local_file_name_lower: item.localFileName.toLowerCase(),
      file_path: item.filePath || null,
      primary_service: item.primaryService,
      results: JSON.stringify(item.results),
      generated_link: item.generatedLink,
      link_check_status: item.linkCheckStatus ? JSON.stringify(item.linkCheckStatus) : null,
      link_check_summary: item.linkCheckSummary ? JSON.stringify(item.linkCheckSummary) : null,
      // 图片元信息
      width: item.width ?? 0,
      height: item.height ?? 0,
      aspect_ratio: item.aspectRatio ?? 1,
      file_size: item.fileSize ?? 0,
      format: item.format ?? 'unknown',
      // 废弃字段，使用默认值保持向后兼容
      color_type: 'unknown',
      has_alpha: 0,
      is_favorited: item.isFavorited ? 1 : 0,
    };
  }

  // ============================================
  // 同步日志
  // ============================================

  /**
   * 写入一条同步操作日志，超出 20 条时自动删除最旧的
   */
  async addSyncLog(entry: SyncLogEntry): Promise<void> {
    const db = await this.ensureInitialized();
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
  async getSyncLogs(limit = 20): Promise<SyncLogEntry[]> {
    const db = await this.ensureInitialized();
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
  async clearSyncLogs(): Promise<void> {
    const db = await this.ensureInitialized();
    await db.execute(`DELETE FROM sync_log`);
  }

  /**
   * JSON 容错解析，防止数据损坏导致整个查询失败
   */
  private safeJsonParse<T>(json: string | null, fallback: T, field: string, id: string): T {
    if (!json) return fallback;
    try {
      return JSON.parse(json);
    } catch (e) {
      log.error(`${field} JSON 解析失败: ${id}`, e);
      return fallback;
    }
  }

  /**
   * 将数据库行转换为 HistoryItem
   * 注意：color_type 和 has_alpha 字段已废弃，不再读取
   */
  private rowToItem(row: HistoryItemRow): HistoryItem {
    return {
      id: row.id,
      timestamp: row.timestamp,
      localFileName: row.local_file_name,
      filePath: row.file_path || undefined,
      primaryService: row.primary_service as ServiceType,
      results: this.safeJsonParse(row.results, [], 'results', row.id),
      generatedLink: row.generated_link,
      linkCheckStatus: this.safeJsonParse(row.link_check_status, undefined, 'linkCheckStatus', row.id),
      linkCheckSummary: this.safeJsonParse(row.link_check_summary, undefined, 'linkCheckSummary', row.id),
      // 图片元信息（简化版，移除了 colorType 和 hasAlpha）
      width: row.width,
      height: row.height,
      aspectRatio: row.aspect_ratio,
      fileSize: row.file_size,
      format: row.format,
      isFavorited: row.is_favorited === 1,
    };
  }
}

// 导出单例实例
export const historyDB = HistoryDatabase.getInstance();

// 导出类（用于类型检查）
export { HistoryDatabase };
