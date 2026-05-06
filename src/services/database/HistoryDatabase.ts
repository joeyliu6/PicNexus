/**
 * 历史记录 SQLite 数据库服务
 *
 * 使用 tauri-plugin-sql 提供的 SQLite 支持，实现高效的历史记录存储和查询
 * 支持 10 万条以上记录的分页加载和模糊搜索
 */

/* eslint-disable max-lines -- central database facade intentionally groups delegated query APIs */
import Database from '@tauri-apps/plugin-sql';
import type { HistoryItem, ServiceType } from '../../config/types';
import type { MigrateScope } from '../../types/batchMigrate';
import type { ImageMeta } from '../../types/image-meta';
import { extractMirrorServices } from '../../types/image-meta';
import { recomputeLinkCheckSummary } from '../../types/linkCheckSummary';
import { getHistoryDbPath } from '../../utils/appPaths';
import { createLogger } from '../../utils/logger';
import { getSyncDeviceId } from '../../utils/syncDeviceId';

// 子模块导入
import {
  type HistoryItemRow,
  ALL_COLUMNS, COLUMNS_SQL,
  rowValues, columnPlaceholders,
  itemToRow, rowToItem,
} from './DataTransformer';
import { setFavoriteQuery, batchSetFavoriteQuery, getFavoriteCountQuery, getFavoriteIdListQuery } from './FavoriteService';
import {
  getLinkCheckInvalidQuery,
  getLinkCheckRestStreamQuery,
  batchUpdateLinkCheckStatusQuery,
  getLinkCheckContextByIdsQuery,
} from './LinkCheckQuery';
import { addSyncLogQuery, getSyncLogsQuery, clearSyncLogsQuery } from './SyncLogService';
import {
  getItemsByBackupCountQuery,
  getBackupCountStatsQuery,
  getServiceDistributionQuery,
  getItemsByIdsQuery,
  setMigrationSkipQuery,
  type ServiceDistributionMode,
} from './MigrationQuery';
import {
  getDayStatsQuery,
  getItemsByDayRangeQuery,
  getDayAspectRatiosByRangeQuery,
  getAllAspectRatiosQuery,
  type AspectRatioRow,
} from './TimelineQueryService';
import { createTablesAndIndexes, runMigrations } from './SchemaManager';
import { ConnectionManager } from './ConnectionManager';
import { exportHistoryToJson, importHistoryFromJson } from './ImportExportService';

// 类型重新导出
import type {
  LinkCheckLiteRow, PageOptions, PageResult,
  SearchOptions, SearchResult, TimePeriodStats,
  FavoritesMetaPageOptions, FavoritesMetaPageResult,
  SyncLogOperation, SyncLogEntry,
  DayStats, DayStatsFilter,
} from './types';

interface MetaRow {
  id: string;
  timestamp: number;
  local_file_name: string;
  aspect_ratio: number;
  primary_service: string;
  generated_link: string;
  results: string;
  is_favorited: number;
}

export type {
  LinkCheckLiteRow, PageOptions, PageResult,
  SearchOptions, SearchResult, TimePeriodStats,
  FavoritesMetaPageOptions, FavoritesMetaPageResult,
  SyncLogOperation, SyncLogEntry,
  DayStats, DayStatsFilter,
};

const log = createLogger('HistoryDB');

/** 数据库文件名 */
const DB_PATH = () => getHistoryDbPath();

/** 每页加载数量 */
const PAGE_SIZE = 500;

/** 转义 LIKE 通配符，防止用户输入 % 或 _ 导致意外匹配；配合 `ESCAPE '\\'` 使用 */
function escapeLikePattern(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&');
}

/**
 * 历史记录数据库类
 *
 * 单例模式，确保全局只有一个数据库连接
 */
class HistoryDatabase {
  private static instance: HistoryDatabase | null = null;
  private readonly connection: ConnectionManager;

  private constructor() {
    this.connection = new ConnectionManager(DB_PATH, async (db) => {
      await createTablesAndIndexes(db);
      await runMigrations(db);
    });
  }

  /**
   * 获取单例实例
   */
  static getInstance(): HistoryDatabase {
    if (!HistoryDatabase.instance) {
      HistoryDatabase.instance = new HistoryDatabase();
    }
    return HistoryDatabase.instance;
  }

  // ============================================
  // 连接生命周期（委托 ConnectionManager）
  // ============================================

  /** 打开数据库连接并初始化表结构 */
  async open(): Promise<void> {
    return this.connection.open();
  }

  /** 关闭数据库连接 */
  async close(): Promise<void> {
    return this.connection.close();
  }

  /** 连接是否已首次打开（用于区分"未初始化"与"连接失效"） */
  isInitialized(): boolean {
    return this.connection.isInitialized();
  }

  /** 验证数据库连接有效性（轻量查询），供休眠恢复等场景外部调用 */
  async healthCheck(): Promise<void> {
    return this.connection.healthCheck();
  }

  /** 强制关闭并重新打开数据库连接 */
  async reconnect(): Promise<void> {
    return this.connection.reconnect();
  }

  // ============================================
  // 收藏操作（委托 FavoriteService）
  // ============================================

  async setFavorite(id: string, favorited: boolean): Promise<void> {
    const db = await this.connection.getDb();
    await setFavoriteQuery(db, id, favorited, {
      updatedAt: Date.now(),
      updatedBy: await getSyncDeviceId(),
    });
  }

  async batchSetFavorite(ids: string[], favorited: boolean): Promise<void> {
    const db = await this.connection.getDb();
    await batchSetFavoriteQuery(db, ids, favorited, {
      updatedAt: Date.now(),
      updatedBy: await getSyncDeviceId(),
    });
  }

  async getFavoriteCount(): Promise<number> {
    const db = await this.connection.getDb();
    return getFavoriteCountQuery(db);
  }

  /**
   * 获取所有收藏记录的 ID 列表
   * 轻量级查询：仅返回 ID，不触发 JSON.parse
   * 用于前端 favoriteSet 初始化
   */
  async getFavoriteIdList(): Promise<string[]> {
    const db = await this.connection.getDb();
    return getFavoriteIdListQuery(db);
  }

  // ============================================
  // CRUD 操作
  // ============================================

  /**
   * 插入一条历史记录
   */
  async insert(item: HistoryItem): Promise<void> {
    const db = await this.connection.getDb();

    const row = itemToRow(item);
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
    const db = await this.connection.getDb();

    const row = itemToRow(item);
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
    const db = await this.connection.getDb();

    // 先获取现有记录
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error(`记录不存在: ${id}`);
    }

    // 合并更新
    const updated: HistoryItem = { ...existing, ...updates };
    const row = itemToRow(updated);

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
   * 切换主服务到另一个已成功上传的镜像
   *
   * 仅改 primaryService + generatedLink，不动 results / linkCheckStatus。
   * 若目标镜像不存在或未成功上传则抛错；目标已是当前主服务则直接返回。
   */
  async switchPrimaryService(id: string, newServiceId: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error(`记录不存在: ${id}`);
    }
    if (existing.primaryService === newServiceId) {
      return;
    }

    const target = existing.results.find(
      r => r.serviceId === newServiceId && r.status === 'success'
    );
    if (!target?.result?.url) {
      throw new Error(`目标镜像不可用或未成功上传: ${newServiceId}`);
    }

    await this.update(id, {
      primaryService: newServiceId,
      generatedLink: target.result.url,
    });
    log.info(`切换主服务: ${id} → ${newServiceId}`);
  }

  /**
   * 从记录中删除某个镜像（从 results 数组移除该条目 + 清理 linkCheckStatus）
   *
   * 边界：
   * - 镜像是当前主服务 → 抛错，调用方需先 switchPrimaryService
   * - 删除后无剩余成功镜像 → 抛错，应改为删除整条记录
   */
  async removeMirror(id: string, serviceId: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error(`记录不存在: ${id}`);
    }

    const target = existing.results.find(r => r.serviceId === serviceId);
    if (!target) {
      throw new Error(`镜像不存在: ${serviceId}`);
    }

    if (existing.primaryService === serviceId) {
      throw new Error('无法删除当前主服务镜像，请先切换到其他镜像');
    }

    const newResults = existing.results.filter(r => r.serviceId !== serviceId);
    const remainingSuccess = newResults.filter(r => r.status === 'success').length;
    if (remainingSuccess === 0) {
      throw new Error('至少需要保留一条成功镜像，如需全删请直接删除整条记录');
    }

    const updates: Partial<HistoryItem> = { results: newResults };
    let newStatus = existing.linkCheckStatus;
    if (existing.linkCheckStatus && serviceId in existing.linkCheckStatus) {
      const { [serviceId]: _removed, ...rest } = existing.linkCheckStatus;
      newStatus = rest;
      updates.linkCheckStatus = rest;
    }

    // 与 useHistoryResultOps.stripServiceFromItem 保持一致：删镜像后同步 summary，
    // 否则已被剥掉的镜像还会继续计入 totalLinks/validLinks/invalidLinks，直到下次
    // 手动跑 link check 才被 linkCheckPersistence 覆盖
    const nextSummary = recomputeLinkCheckSummary(newResults, newStatus, existing.linkCheckSummary);
    if (nextSummary) {
      updates.linkCheckSummary = nextSummary;
    }

    await this.update(id, updates);
    log.info(`删除镜像: ${id} / ${serviceId}`);
  }

  /**
   * 插入或更新一条记录（UPSERT）
   */
  async upsert(item: HistoryItem): Promise<void> {
    const db = await this.connection.getDb();
    const row = itemToRow(item);

    await db.execute(
      `INSERT OR REPLACE INTO history_items (${COLUMNS_SQL}) VALUES (${columnPlaceholders()})`,
      rowValues(row)
    );
  }

  /**
   * 删除一条历史记录
   */
  async delete(id: string): Promise<void> {
    const db = await this.connection.getDb();
    await db.execute('DELETE FROM history_items WHERE id = $1', [id]);
    log.debug(`删除记录: ${id}`);
  }

  /**
   * 批量删除历史记录
   */
  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const db = await this.connection.getDb();
    // 生成 $1, $2, $3... 占位符
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    await db.execute(`DELETE FROM history_items WHERE id IN (${placeholders})`, ids);
    log.info(`批量删除 ${ids.length} 条记录`);
  }

  /**
   * 清空所有历史记录
   */
  async clear(): Promise<void> {
    const db = await this.connection.getDb();
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
    const db = await this.connection.getDb();
    const rows = await db.select<HistoryItemRow[]>('SELECT * FROM history_items WHERE id = $1', [id]);

    if (rows.length === 0) {
      return null;
    }
    return rowToItem(rows[0]);
  }

  /**
   * 根据文件路径查询单条历史记录
   * @param filePath 文件的本地路径
   * @returns 匹配的历史记录，或 null
   */
  async getByFilePath(filePath: string): Promise<HistoryItem | null> {
    const db = await this.connection.getDb();
    const rows = await db.select<HistoryItemRow[]>(
      'SELECT * FROM history_items WHERE file_path = $1 ORDER BY timestamp DESC LIMIT 1',
      [filePath]
    );
    return rows.length > 0 ? rowToItem(rows[0]) : null;
  }

  /**
   * 构建带 COUNT(*) OVER() 窗口函数的分页查询，单次查询同时获取总数和分页数据
   */
  private async queryWithTotal(
    db: Database,
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

    const countParams = [...params];
    const limitOffset = `LIMIT ${nextParam()}`;
    params.push(limit);
    const offsetClause = `OFFSET ${nextParam()}`;
    params.push(offset);

    const rows = await db.select<(HistoryItemRow & { _total: number })[]>(
      `SELECT *, COUNT(*) OVER() as _total FROM history_items ${whereClause} ORDER BY timestamp DESC ${limitOffset} ${offsetClause}`,
      params
    );

    let total = rows[0]?._total ?? 0;
    if (rows.length === 0 && offset > 0) {
      const countRows = await db.select<{ count: number }[]>(
        `SELECT COUNT(*) as count FROM history_items ${whereClause}`,
        countParams
      );
      total = countRows[0]?.count ?? 0;
    }
    const items = rows.map((row) => rowToItem(row));
    const hasMore = offset + items.length < total;
    return { items, total, hasMore };
  }

  /**
   * 分页获取历史记录
   */
  async getPage(options: PageOptions): Promise<PageResult> {
    const db = await this.connection.getDb();
    const { page, pageSize = PAGE_SIZE, serviceFilter = 'all' } = options;
    const offset = (page - 1) * pageSize;
    return this.queryWithTotal(db, '', [], serviceFilter, pageSize, offset);
  }

  /**
   * 搜索历史记录（文件名模糊搜索）
   */
  async search(keyword: string, options: SearchOptions = {}): Promise<SearchResult> {
    const db = await this.connection.getDb();
    const { serviceFilter = 'all', limit = 100, offset = 0 } = options;
    const keywordLower = keyword.toLowerCase().trim();
    const escaped = escapeLikePattern(keywordLower);

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
    const db = await this.connection.getDb();

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
   * 获取图库总览（单次查询同时取总数/去重图床数/最近一次时间戳）
   *
   * 用于文档修复 idle 态的「图库总览卡」展示信任锚点
   */
  async getSummary(): Promise<{ totalImages: number; distinctServices: number; lastUpdatedAt: number | null }> {
    const db = await this.connection.getDb();
    const rows = await db.select<{ total: number; services: number; lastAt: number | null }[]>(
      `SELECT
        COUNT(*) AS total,
        COUNT(DISTINCT primary_service) AS services,
        MAX(timestamp) AS lastAt
      FROM history_items`,
    );
    const row = rows[0];
    return {
      totalImages: row?.total ?? 0,
      distinctServices: row?.services ?? 0,
      lastUpdatedAt: row?.lastAt ?? null,
    };
  }

  /**
   * 按 primary_service 分组统计每个图床的图片数量
   * 用于浏览视图的图床下拉筛选展示分布
   */
  async getServiceCounts(): Promise<Array<{ id: string; count: number }>> {
    const db = await this.connection.getDb();
    const rows = await db.select<{ id: string; count: number }[]>(
      `SELECT primary_service AS id, COUNT(*) AS count
       FROM history_items
       WHERE primary_service IS NOT NULL AND primary_service <> ''
       GROUP BY primary_service
       ORDER BY count DESC`,
    );
    return rows;
  }

  // ============================================
  // 批量迁移查询（委托 MigrationQuery）
  // ============================================

  async getItemsByBackupCount(options: {
    maxSuccessCount: number;
    serviceFilter?: string;
    hasServiceId?: string | string[];
    timestampAfter?: number;
    cursorTimestamp?: number;
    cursorId?: string;
    limit?: number;
    offset?: number;
    scope?: MigrateScope;
  }): Promise<{ items: HistoryItem[]; total: number; hasMore: boolean }> {
    const db = await this.connection.getDb();
    return getItemsByBackupCountQuery(db, options);
  }

  async getBackupCountStats(): Promise<{ count1: number; count2: number; countAll: number }> {
    const db = await this.connection.getDb();
    return getBackupCountStatsQuery(db);
  }

  async getServiceDistribution(options: {
    maxSuccessCount: number;
    serviceFilter?: string;
    hasServiceId?: string | string[];
    timestampAfter?: number;
    scope?: MigrateScope;
    distribution?: ServiceDistributionMode;
  }): Promise<Map<string, number>> {
    const db = await this.connection.getDb();
    return getServiceDistributionQuery(db, options);
  }

  async getItemsByIds(ids: string[]): Promise<HistoryItem[]> { return getItemsByIdsQuery(await this.connection.getDb(), ids); }
  async setMigrationSkip(id: string, skip: boolean): Promise<void> { await setMigrationSkipQuery(await this.connection.getDb(), id, skip); }

  /**
   * 获取所有时间段的统计信息（轻量级查询）
   * 只返回每个月份的记录数，不返回完整记录数据
   * 用于时间轴侧边栏显示完整的时间范围
   *
   * @returns 按时间降序排列的月份统计列表
   */
  async getTimePeriodStats(): Promise<TimePeriodStats[]> {
    const db = await this.connection.getDb();

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

  /** 按日聚合统计（时间轴首屏骨架数据，委托 TimelineQueryService） */
  async getDayStats(filter?: DayStatsFilter): Promise<DayStats[]> {
    const db = await this.connection.getDb();
    return getDayStatsQuery(db, filter);
  }

  /** 按时间戳闭区间拉取 ImageMeta（时间轴按需加载，委托 TimelineQueryService） */
  async getItemsByDayRange(startTs: number, endTs: number, filter?: DayStatsFilter): Promise<ImageMeta[]> {
    const db = await this.connection.getDb();
    return getItemsByDayRangeQuery(db, startTs, endTs, filter);
  }

  /** 按时间戳闭区间只拉 aspect_ratio 列（跳转前懒加载预取降级路径） */
  async getDayAspectRatiosByRange(
    startTs: number,
    endTs: number,
    filter?: DayStatsFilter,
  ): Promise<AspectRatioRow[]> {
    const db = await this.connection.getDb();
    return getDayAspectRatiosByRangeQuery(db, startTs, endTs, filter);
  }

  /** 全量拉 aspect_ratio（v7 时间轴挂载后台预取，超阈值时 useTimelineDayPagination 会跳过） */
  async getAllAspectRatios(filter?: DayStatsFilter): Promise<AspectRatioRow[]> {
    const db = await this.connection.getDb();
    return getAllAspectRatiosQuery(db, filter);
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
    const db = await this.connection.getDb();

    const rows = await db.select<MetaRow[]>(`
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

    return rows.map(row => this.rowToImageMeta(row));
  }

  /**
   * 按 ID 批量查询元数据（`WHERE id IN (...)` 一次性返回）
   *
   * 用于表格视图批量复制：选中条目可能跨页，不能从内存列表过滤取得。
   * 与 deleteMany 保持同样的 IN 占位符模式。
   * ORDER BY timestamp DESC 保持与 getMetaList 一致的顺序，避免批量复制
   * 粘贴后的链接顺序因 DB 自然顺序而不可预测。
   */
  async getMetasByIds(ids: string[]): Promise<ImageMeta[]> {
    if (ids.length === 0) return [];
    const db = await this.connection.getDb();
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const rows = await db.select<MetaRow[]>(
      `SELECT id, timestamp, local_file_name, aspect_ratio,
              primary_service, generated_link, results, is_favorited
       FROM history_items WHERE id IN (${placeholders})
       ORDER BY timestamp DESC`,
      ids,
    );
    return rows.map(row => this.rowToImageMeta(row));
  }

  /** 收藏元数据分页查询（服务端过滤 + LIMIT/OFFSET，避免前端全量加载） */
  async getFavoritesMetaPage(options: FavoritesMetaPageOptions): Promise<FavoritesMetaPageResult> {
    const db = await this.connection.getDb();
    const { offset, limit, serviceFilter = 'all', searchTerm } = options;

    const params: (string | number)[] = [];
    let whereClause = 'WHERE is_favorited = 1';
    const nextParam = () => `$${params.length + 1}`;

    if (serviceFilter !== 'all') {
      whereClause += ` AND primary_service = ${nextParam()}`;
      params.push(serviceFilter);
    }

    const trimmed = searchTerm?.trim().toLowerCase();
    if (trimmed) {
      whereClause += ` AND local_file_name_lower LIKE ${nextParam()} ESCAPE '\\'`;
      params.push(`%${escapeLikePattern(trimmed)}%`);
    }

    const limitPh = nextParam();
    params.push(limit);
    const offsetPh = nextParam();
    params.push(offset);

    const rows = await db.select<(MetaRow & { _total: number })[]>(
      `SELECT
        id, timestamp, local_file_name, aspect_ratio,
        primary_service, generated_link, results, is_favorited,
        COUNT(*) OVER() as _total
      FROM history_items
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ${limitPh} OFFSET ${offsetPh}`,
      params,
    );

    const total = rows[0]?._total ?? 0;
    const items = rows.map(row => this.rowToImageMeta(row));
    const hasMore = offset + items.length < total;
    return { items, total, hasMore };
  }

  private rowToImageMeta(row: MetaRow): ImageMeta {
    let primaryFileKey: string | undefined;
    let mirrorServices: ImageMeta['mirrorServices'];
    try {
      const results = JSON.parse(row.results) as HistoryItem['results'];
      const mirrors = extractMirrorServices(results, row.primary_service);
      if (mirrors.length > 0) {
        primaryFileKey = mirrors[0].fileKey;
        mirrorServices = mirrors;
      }
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
      mirrorServices,
      isFavorited: row.is_favorited === 1,
    };
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
    const db = await this.connection.getDb();

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

    const items = rows.map(row => rowToItem(row));
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
    const db = await this.connection.getDb();
    let offset = 0;

    while (true) {
      const rows = await db.select<HistoryItemRow[]>(
        'SELECT * FROM history_items ORDER BY timestamp DESC LIMIT $1 OFFSET $2',
        [batchSize, offset]
      );

      if (rows.length === 0) {
        break;
      }

      yield rows.map((row) => rowToItem(row));
      offset += batchSize;

      // 如果返回的数量小于批大小，说明已经到末尾
      if (rows.length < batchSize) {
        break;
      }
    }
  }

  // ============================================
  // 链接检测专用轻量查询（委托 LinkCheckQuery）
  // ============================================

  async getLinkCheckInvalid(): Promise<LinkCheckLiteRow[]> {
    const db = await this.connection.getDb();
    return getLinkCheckInvalidQuery(db);
  }

  async *getLinkCheckRestStream(
    loadedIds: Set<string>,
    batchSize = 2000,
  ): AsyncGenerator<LinkCheckLiteRow[]> {
    const db = await this.connection.getDb();
    yield* getLinkCheckRestStreamQuery(db, loadedIds, batchSize);
  }

  async batchUpdateLinkCheckStatus(
    updates: Array<{
      id: string;
      linkCheckStatus: string;
      linkCheckSummary: string;
    }>,
  ): Promise<void> {
    const db = await this.connection.getDb();
    await batchUpdateLinkCheckStatusQuery(db, updates);
  }

  /**
   * 批量读取指定 id 的 link_check_status + results 原始 JSON 字符串
   * 子集复检在写回前用它 merge，避免覆盖未参与本批的图床状态
   */
  async getLinkCheckContextByIds(
    ids: string[],
  ): Promise<Map<string, { results: string | null; linkCheckStatus: string | null }>> {
    const db = await this.connection.getDb();
    return getLinkCheckContextByIdsQuery(db, ids);
  }

  // ============================================
  // 导入导出（委托 ImportExportService）
  // ============================================

  /**
   * 导出所有记录为 JSON 字符串
   * 使用流式读取降低内存峰值压力
   */
  async exportToJSON(): Promise<string> {
    return exportHistoryToJson((batchSize) => this.getAllStream(batchSize));
  }

  /**
   * 从 JSON 导入记录（高性能批量导入）
   *
   * @param json JSON 字符串
   * @param mergeStrategy 合并策略：replace 覆盖，merge 合并（相同 ID 保留较新的）
   * @param onProgress 可选的进度回调 (current, total) => void
   * @returns 导入的记录数
   */
  async importFromJSON(
    json: string,
    mergeStrategy: 'replace' | 'merge',
    onProgress?: (current: number, total: number) => void,
  ): Promise<number> {
    const db = await this.connection.getDb();
    return importHistoryFromJson(db, json, mergeStrategy, onProgress);
  }

  // ============================================
  // 同步日志（委托 SyncLogService）
  // ============================================

  async addSyncLog(entry: SyncLogEntry): Promise<void> {
    const db = await this.connection.getDb();
    await addSyncLogQuery(db, entry);
  }

  async getSyncLogs(limit = 20): Promise<SyncLogEntry[]> {
    const db = await this.connection.getDb();
    return getSyncLogsQuery(db, limit);
  }

  async clearSyncLogs(): Promise<void> {
    const db = await this.connection.getDb();
    await clearSyncLogsQuery(db);
  }
}

// 导出单例实例
export const historyDB = HistoryDatabase.getInstance();

// 导出类（用于类型检查）
export { HistoryDatabase };
