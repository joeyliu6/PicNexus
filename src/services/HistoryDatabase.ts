/**
 * 历史记录 SQLite 数据库服务
 *
 * 使用 tauri-plugin-sql 提供的 SQLite 支持，实现高效的历史记录存储和查询
 * 支持 10 万条以上记录的分页加载和模糊搜索
 */

import Database from '@tauri-apps/plugin-sql';
import type { HistoryItem, ServiceType } from '../config/types';

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
      console.log('[HistoryDB] 正在打开数据库...');
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
      await this.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_filename_lower ON history_items(local_file_name_lower)
      `);
      // 添加 file_path 索引，用于按文件路径快速查询
      await this.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_file_path ON history_items(file_path)
      `);

      this.initialized = true;
      console.log('[HistoryDB] 数据库初始化完成');
    } catch (error) {
      console.error('[HistoryDB] 数据库初始化失败:', error);
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
      console.log('[HistoryDB] 数据库已关闭');
    }
  }

  /**
   * 确保数据库已初始化
   */
  private async ensureInitialized(): Promise<Database> {
    if (!this.initialized || !this.db) {
      await this.open();
    }
    return this.db!;
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
      `INSERT INTO history_items (
        id, timestamp, local_file_name, local_file_name_lower, file_path,
        primary_service, results, generated_link, link_check_status, link_check_summary,
        width, height, aspect_ratio, file_size, format, color_type, has_alpha
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        row.id,
        row.timestamp,
        row.local_file_name,
        row.local_file_name_lower,
        row.file_path,
        row.primary_service,
        row.results,
        row.generated_link,
        row.link_check_status,
        row.link_check_summary,
        row.width,
        row.height,
        row.aspect_ratio,
        row.file_size,
        row.format,
        row.color_type,
        row.has_alpha,
      ]
    );
    console.log(`[HistoryDB] 插入记录: ${item.id}`);
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
      `INSERT OR IGNORE INTO history_items (
        id, timestamp, local_file_name, local_file_name_lower, file_path,
        primary_service, results, generated_link, link_check_status, link_check_summary,
        width, height, aspect_ratio, file_size, format, color_type, has_alpha
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        row.id,
        row.timestamp,
        row.local_file_name,
        row.local_file_name_lower,
        row.file_path,
        row.primary_service,
        row.results,
        row.generated_link,
        row.link_check_status,
        row.link_check_summary,
        row.width,
        row.height,
        row.aspect_ratio,
        row.file_size,
        row.format,
        row.color_type,
        row.has_alpha,
      ]
    );

    const inserted = result.rowsAffected > 0;
    if (inserted) {
      console.log(`[HistoryDB] 插入记录: ${item.id}`);
    } else {
      console.warn(`[HistoryDB] ⚠️ 记录已存在，跳过插入: ${item.id}（可能存在竞态或 UUID 碰撞）`);
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

    await db.execute(
      `UPDATE history_items SET
        timestamp = $1, local_file_name = $2, local_file_name_lower = $3, file_path = $4,
        primary_service = $5, results = $6, generated_link = $7, link_check_status = $8, link_check_summary = $9,
        width = $10, height = $11, aspect_ratio = $12, file_size = $13, format = $14, color_type = $15, has_alpha = $16
      WHERE id = $17`,
      [
        row.timestamp,
        row.local_file_name,
        row.local_file_name_lower,
        row.file_path,
        row.primary_service,
        row.results,
        row.generated_link,
        row.link_check_status,
        row.link_check_summary,
        row.width,
        row.height,
        row.aspect_ratio,
        row.file_size,
        row.format,
        row.color_type,
        row.has_alpha,
        id,
      ]
    );
    console.log(`[HistoryDB] 更新记录: ${id}`);
  }

  /**
   * 插入或更新一条记录（UPSERT）
   */
  async upsert(item: HistoryItem): Promise<void> {
    const db = await this.ensureInitialized();
    const row = this.itemToRow(item);

    await db.execute(
      `INSERT OR REPLACE INTO history_items (
        id, timestamp, local_file_name, local_file_name_lower, file_path,
        primary_service, results, generated_link, link_check_status, link_check_summary,
        width, height, aspect_ratio, file_size, format, color_type, has_alpha
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        row.id,
        row.timestamp,
        row.local_file_name,
        row.local_file_name_lower,
        row.file_path,
        row.primary_service,
        row.results,
        row.generated_link,
        row.link_check_status,
        row.link_check_summary,
        row.width,
        row.height,
        row.aspect_ratio,
        row.file_size,
        row.format,
        row.color_type,
        row.has_alpha,
      ]
    );
  }

  /**
   * 删除一条历史记录
   */
  async delete(id: string): Promise<void> {
    const db = await this.ensureInitialized();
    await db.execute('DELETE FROM history_items WHERE id = $1', [id]);
    console.log(`[HistoryDB] 删除记录: ${id}`);
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
    console.log(`[HistoryDB] 批量删除 ${ids.length} 条记录`);
  }

  /**
   * 清空所有历史记录
   */
  async clear(): Promise<void> {
    const db = await this.ensureInitialized();
    await db.execute('DELETE FROM history_items');
    console.log('[HistoryDB] 已清空所有记录');
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
   * 分页获取历史记录
   */
  async getPage(options: PageOptions): Promise<PageResult> {
    const db = await this.ensureInitialized();
    const { page, pageSize = PAGE_SIZE, serviceFilter = 'all' } = options;
    const offset = (page - 1) * pageSize;

    let whereClause = '';
    const countParams: (string | number)[] = [];
    const selectParams: (string | number)[] = [];

    if (serviceFilter !== 'all') {
      whereClause = 'WHERE primary_service = $1';
      countParams.push(serviceFilter);
      selectParams.push(serviceFilter, pageSize, offset);
    } else {
      selectParams.push(pageSize, offset);
    }

    // 获取总数
    const countResult = await db.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM history_items ${whereClause}`,
      countParams
    );
    const total = countResult[0]?.count || 0;

    // 获取分页数据
    const selectWhereClause = serviceFilter !== 'all' ? 'WHERE primary_service = $1' : '';
    const limitOffset = serviceFilter !== 'all' ? 'LIMIT $2 OFFSET $3' : 'LIMIT $1 OFFSET $2';
    const rows = await db.select<HistoryItemRow[]>(
      `SELECT * FROM history_items ${selectWhereClause} ORDER BY timestamp DESC ${limitOffset}`,
      selectParams
    );

    const items = rows.map((row) => this.rowToItem(row));
    const hasMore = offset + items.length < total;

    return { items, total, hasMore };
  }

  /**
   * 搜索历史记录（文件名模糊搜索）
   */
  async search(keyword: string, options: SearchOptions = {}): Promise<SearchResult> {
    const db = await this.ensureInitialized();
    const { serviceFilter = 'all', limit = 100, offset = 0 } = options;
    const keywordLower = keyword.toLowerCase().trim();

    let whereClause = 'WHERE local_file_name_lower LIKE $1';
    const countParams: (string | number)[] = [`%${keywordLower}%`];
    const selectParams: (string | number)[] = [`%${keywordLower}%`];

    if (serviceFilter !== 'all') {
      whereClause += ' AND primary_service = $2';
      countParams.push(serviceFilter);
      selectParams.push(serviceFilter, limit, offset);
    } else {
      selectParams.push(limit, offset);
    }

    // 获取匹配总数
    const countResult = await db.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM history_items ${whereClause}`,
      countParams
    );
    const total = countResult[0]?.count || 0;

    // 获取搜索结果
    const limitOffset = serviceFilter !== 'all' ? 'LIMIT $3 OFFSET $4' : 'LIMIT $2 OFFSET $3';
    const rows = await db.select<HistoryItemRow[]>(
      `SELECT * FROM history_items ${whereClause} ORDER BY timestamp DESC ${limitOffset}`,
      selectParams
    );

    const items = rows.map((row) => this.rowToItem(row));
    const hasMore = offset + items.length < total;

    console.log(`[HistoryDB] 搜索 "${keyword}": 找到 ${total} 条，返回 ${items.length} 条`);
    return { items, total, hasMore };
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

    // 构建批量插入的 SQL
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    for (const item of items) {
      const row = this.itemToRow(item);
      // 生成占位符 ($1, $2, ..., $17)
      const rowPlaceholders = [];
      for (let j = 0; j < 17; j++) {
        rowPlaceholders.push(`$${paramIndex++}`);
      }
      placeholders.push(`(${rowPlaceholders.join(', ')})`);

      values.push(
        row.id,
        row.timestamp,
        row.local_file_name,
        row.local_file_name_lower,
        row.file_path,
        row.primary_service,
        row.results,
        row.generated_link,
        row.link_check_status,
        row.link_check_summary,
        row.width,
        row.height,
        row.aspect_ratio,
        row.file_size,
        row.format,
        row.color_type,
        row.has_alpha
      );
    }

    await db.execute(
      `INSERT OR REPLACE INTO history_items (
        id, timestamp, local_file_name, local_file_name_lower, file_path,
        primary_service, results, generated_link, link_check_status, link_check_summary,
        width, height, aspect_ratio, file_size, format, color_type, has_alpha
      ) VALUES ${placeholders.join(', ')}`,
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
    const items = JSON.parse(json) as HistoryItem[];

    if (!Array.isArray(items)) {
      throw new Error('无效的 JSON 格式：期望数组');
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

      console.log(
        `[HistoryDB] merge 策略: ${items.length} 条中有 ${itemsToImport.length} 条需要导入`
      );
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

    console.log(`[HistoryDB] 导入完成: ${importedCount}/${items.length} 条`);
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
    };
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
      results: JSON.parse(row.results),
      generatedLink: row.generated_link,
      linkCheckStatus: row.link_check_status ? JSON.parse(row.link_check_status) : undefined,
      linkCheckSummary: row.link_check_summary ? JSON.parse(row.link_check_summary) : undefined,
      // 图片元信息（简化版，移除了 colorType 和 hasAlpha）
      width: row.width,
      height: row.height,
      aspectRatio: row.aspect_ratio,
      fileSize: row.file_size,
      format: row.format,
    };
  }
}

// 导出单例实例
export const historyDB = HistoryDatabase.getInstance();

// 导出类（用于类型检查）
export { HistoryDatabase };
