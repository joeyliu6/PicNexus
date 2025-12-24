/**
 * 历史记录 SQLite 数据库服务
 *
 * 使用 tauri-plugin-sql 提供的 SQLite 支持，实现高效的历史记录存储和查询
 * 支持 10 万条以上记录的分页加载和模糊搜索
 */

import Database from 'tauri-plugin-sql-api';
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
          link_check_summary TEXT
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
        primary_service, results, generated_link, link_check_status, link_check_summary
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
      ]
    );
    console.log(`[HistoryDB] 插入记录: ${item.id}`);
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
        primary_service = $5, results = $6, generated_link = $7, link_check_status = $8, link_check_summary = $9
      WHERE id = $10`,
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
        primary_service, results, generated_link, link_check_status, link_check_summary
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
   * 导出所有记录为 JSON 字符串
   */
  async exportToJSON(): Promise<string> {
    const db = await this.ensureInitialized();
    const rows = await db.select<HistoryItemRow[]>('SELECT * FROM history_items ORDER BY timestamp DESC');
    const items = rows.map((row) => this.rowToItem(row));
    return JSON.stringify(items, null, 2);
  }

  /**
   * 从 JSON 导入记录
   *
   * @param json JSON 字符串
   * @param mergeStrategy 合并策略：replace 覆盖，merge 合并（相同 ID 保留较新的）
   * @returns 导入的记录数
   */
  async importFromJSON(json: string, mergeStrategy: 'replace' | 'merge'): Promise<number> {
    const items = JSON.parse(json) as HistoryItem[];

    if (!Array.isArray(items)) {
      throw new Error('无效的 JSON 格式：期望数组');
    }

    const db = await this.ensureInitialized();

    if (mergeStrategy === 'replace') {
      await db.execute('DELETE FROM history_items');
    }

    let importedCount = 0;
    for (const item of items) {
      // 确保 ID 存在
      if (!item.id) {
        item.id = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
      }

      if (mergeStrategy === 'merge') {
        // 合并模式：检查是否存在，存在则比较时间戳
        const existing = await this.getById(item.id);
        if (existing && existing.timestamp >= item.timestamp) {
          continue; // 跳过较旧的记录
        }
      }

      await this.upsert(item);
      importedCount++;
    }

    console.log(`[HistoryDB] 导入完成: ${importedCount}/${items.length} 条`);
    return importedCount;
  }

  // ============================================
  // 数据转换
  // ============================================

  /**
   * 将 HistoryItem 转换为数据库行
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
    };
  }

  /**
   * 将数据库行转换为 HistoryItem
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
    };
  }
}

// 导出单例实例
export const historyDB = HistoryDatabase.getInstance();

// 导出类（用于类型检查）
export { HistoryDatabase };
