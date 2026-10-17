/**
 * 时间轴按需加载专用查询
 *
 * - getDayStatsQuery：按日聚合，返回骨架数据（首屏 <50ms）
 * - getItemsByDayRangeQuery：按时间戳范围拉具体 metas（按需加载可见天）
 */

import type Database from '@tauri-apps/plugin-sql';
import type { CopyLinkHealth, ImageMeta } from '@/types/image-meta';
import { extractMirrorServices } from '@/types/image-meta';
import type { DayStats, DayStatsFilter, ServiceType } from './types';
import type { HistoryItem } from '@/config/types';
import { LONG_IMAGE_RATIO, SMALL_IMAGE_SIDE, WIDE_IMAGE_RATIO, layoutRatio } from '@/utils/imageDisplay';
import { createLogger } from '@/utils/logger';

const log = createLogger('TimelineQuery');

interface MetaRow {
  id: string;
  timestamp: number;
  local_file_name: string;
  aspect_ratio: number;
  primary_service: string;
  generated_link: string;
  results: string;
  is_favorited: number;
  copy_link_health: CopyLinkHealth;
  width: number | null;
  height: number | null;
  format: string | null;
}

function escapeLikePattern(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&');
}

/** 复制时使用的那个图床在 link_check_status 里的某个字段（复合 ID 含冒号，路径里要加引号） */
const copyLinkField = (field: string) => `json_extract(link_check_status, '$."' || primary_service || '".${field}')`;

/**
 * 复制链接的健康状况，取值见 CopyLinkHealth。
 * 没检测过、或检测还停在 pending 都算「尚未检测」；判失效但浏览器可能还能打开的算「可能受限」。
 */
export const COPY_LINK_HEALTH_SQL = `CASE
  WHEN ${copyLinkField('isValid')} IS NULL OR ${copyLinkField('errorType')} = 'pending' THEN 'unchecked'
  WHEN ${copyLinkField('isValid')} = 1 THEN 'ok'
  WHEN ${copyLinkField('browserMightWork')} = 1 THEN 'limited'
  ELSE 'dead'
END`;

/**
 * 格子的宽高比，与 utils/imageDisplay 的 layoutRatio 同一套规则（G13）：按天汇总只能在 SQL 里算。
 * 两边是否一致由 galleryFilters.spec 在真的 SQLite 上对照。
 */
const LAYOUT_RATIO_SQL = `CASE
  WHEN width > 0 AND height > 0 AND min(width, height) < ${SMALL_IMAGE_SIDE} THEN 1.0
  WHEN aspect_ratio > 0 AND aspect_ratio < ${1 / LONG_IMAGE_RATIO} THEN ${1 / LONG_IMAGE_RATIO}
  WHEN aspect_ratio > ${WIDE_IMAGE_RATIO} THEN ${WIDE_IMAGE_RATIO}.0
  WHEN aspect_ratio > 0 THEN aspect_ratio
  ELSE 1.0
END`;

/**
 * 把 DayStatsFilter 的各项筛选追加到 conditions/params。
 * 不处理 timestamp 范围（由调用方自行预置）。
 */
function appendFilterClause(
  filter: DayStatsFilter | undefined,
  conditions: string[],
  params: (string | number)[],
): void {
  const { serviceFilter = 'all', hostFilter, statusFilter, since, searchTerm, favoritesOnly } = filter ?? {};
  const next = (value: string | number) => { params.push(value); return `$${params.length}`; };
  if (favoritesOnly) conditions.push('is_favorited = 1');
  if (serviceFilter !== 'all') conditions.push(`primary_service = ${next(serviceFilter)}`);
  if (hostFilter) {
    conditions.push(`EXISTS (SELECT 1 FROM json_each(successful_service_ids) WHERE value = ${next(hostFilter)})`);
  }
  if (statusFilter?.length) {
    const health = statusFilter.filter((s) => s !== 'single');
    const anyOf = [
      ...(health.length ? [`(${COPY_LINK_HEALTH_SQL}) IN (${health.map(next).join(', ')})`] : []),
      ...(statusFilter.includes('single') ? ['success_count = 1'] : []),
    ];
    conditions.push(`(${anyOf.join(' OR ')})`);
  }
  if (since !== undefined) conditions.push(`timestamp >= ${next(since)}`);
  const trimmed = searchTerm?.trim().toLowerCase();
  if (trimmed) {
    conditions.push(`local_file_name_lower LIKE ${next(`%${escapeLikePattern(trimmed)}%`)} ESCAPE '\\'`);
  }
}

function rowToImageMeta(row: MetaRow): ImageMeta {
  let primaryFileKey: string | undefined;
  let mirrorServices: ImageMeta['mirrorServices'];
  try {
    const parsed = JSON.parse(row.results) as HistoryItem['results'];
    const mirrors = extractMirrorServices(parsed, row.primary_service);
    if (mirrors.length > 0) {
      primaryFileKey = mirrors[0].fileKey;
      mirrorServices = mirrors;
    }
  } catch {
    log.warn(`解析 results 失败: ${row.id}`);
  }
  return {
    id: row.id,
    timestamp: row.timestamp,
    localFileName: row.local_file_name || '',
    aspectRatio: row.aspect_ratio || 1.0,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    format: row.format ?? undefined,
    primaryService: row.primary_service as ServiceType,
    primaryUrl: row.generated_link,
    primaryFileKey,
    mirrorServices,
    isFavorited: row.is_favorited === 1,
    copyLinkHealth: row.copy_link_health,
  };
}

/**
 * 按日聚合统计（时间轴首屏骨架数据）
 *
 * 返回每天的 count + aspectRatioSum（格子比例之和，见 LAYOUT_RATIO_SQL），前端据此估算骨架天占位高度。
 */
export async function getDayStatsQuery(db: Database, filter?: DayStatsFilter): Promise<DayStats[]> {
  const params: (string | number)[] = [];
  const conditions: string[] = [];
  appendFilterClause(filter, conditions, params);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await db.select<{
    year: number; month: number; day: number;
    count: number; aspect_ratio_sum: number;
    min_timestamp: number; max_timestamp: number;
  }[]>(`
    SELECT
      CAST(strftime('%Y', timestamp / 1000, 'unixepoch', 'localtime') AS INTEGER) as year,
      CAST(strftime('%m', timestamp / 1000, 'unixepoch', 'localtime') AS INTEGER) - 1 as month,
      CAST(strftime('%d', timestamp / 1000, 'unixepoch', 'localtime') AS INTEGER) as day,
      COUNT(*) as count,
      SUM(${LAYOUT_RATIO_SQL}) as aspect_ratio_sum,
      MIN(timestamp) as min_timestamp,
      MAX(timestamp) as max_timestamp
    FROM history_items
    ${where}
    GROUP BY year,
      strftime('%m', timestamp / 1000, 'unixepoch', 'localtime'),
      strftime('%d', timestamp / 1000, 'unixepoch', 'localtime')
    ORDER BY year DESC, month DESC, day DESC
  `, params);

  return rows.map(row => ({
    year: row.year,
    month: row.month,
    day: row.day,
    count: row.count,
    aspectRatioSum: row.aspect_ratio_sum,
    minTimestamp: row.min_timestamp,
    maxTimestamp: row.max_timestamp,
  }));
}

/**
 * 按时间戳闭区间 [startTs, endTs] 拉取 ImageMeta（时间轴按需加载具体数据）
 *
 * 多天合并查询：startTs = Math.min(...days.map(d => d.minTimestamp))，endTs 同理。
 * 调用方按 dayKey 分桶回填 dayMetaCache。
 */
const SLOW_QUERY_WARN_MS = 800;

export async function getItemsByDayRangeQuery(
  db: Database,
  startTs: number,
  endTs: number,
  filter?: DayStatsFilter,
): Promise<ImageMeta[]> {
  const params: (string | number)[] = [startTs, endTs];
  const conditions: string[] = ['timestamp >= $1', 'timestamp <= $2'];
  appendFilterClause(filter, conditions, params);

  const t0 = performance.now();
  const rows = await db.select<MetaRow[]>(
    `SELECT id, timestamp, local_file_name, aspect_ratio, width, height, format,
            primary_service, generated_link, results, is_favorited,
            ${COPY_LINK_HEALTH_SQL} AS copy_link_health
     FROM history_items
     WHERE ${conditions.join(' AND ')}
     ORDER BY timestamp DESC, id DESC`,
    params,
  );
  const durationMs = Math.round(performance.now() - t0);
  if (durationMs > SLOW_QUERY_WARN_MS) {
    log.warn('getItemsByDayRange 慢查询', { startTs, endTs, rowCount: rows.length, durationMs });
  }

  return rows.map(rowToImageMeta);
}

/** 图库列表视图（GalleryScreen.dc.html G02）：点表头按这几列排序 */
export type GalleryListSortKey = 'time' | 'name' | 'size';

export interface GalleryListSort {
  key: GalleryListSortKey;
  descending: boolean;
}

/** 列表一行：网格那套 meta 再加「大小」 */
export interface GalleryListRow extends ImageMeta {
  fileSize?: number;
}

const LIST_SORT_SQL: Record<GalleryListSortKey, string> = {
  time: 'timestamp',
  name: 'local_file_name_lower',
  size: 'COALESCE(file_size, 0)',
};

/** 列表视图的一页：与网格同一套筛选，按 sort 排序（同值时按 id 定序，翻页不重不漏） */
export async function getListPageQuery(
  db: Database,
  filter: DayStatsFilter | undefined,
  sort: GalleryListSort,
  offset: number,
  limit: number,
): Promise<GalleryListRow[]> {
  const params: (string | number)[] = [];
  const conditions: string[] = [];
  appendFilterClause(filter, conditions, params);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const direction = sort.descending ? 'DESC' : 'ASC';
  params.push(limit, offset);

  const rows = await db.select<Array<MetaRow & { file_size: number | null }>>(
    `SELECT id, timestamp, local_file_name, aspect_ratio, width, height, format,
            primary_service, generated_link, results, is_favorited, file_size,
            ${COPY_LINK_HEALTH_SQL} AS copy_link_health
     FROM history_items
     ${where}
     ORDER BY ${LIST_SORT_SQL[sort.key]} ${direction}, id ${direction}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return rows.map((row) => ({ ...rowToImageMeta(row), fileSize: row.file_size ?? undefined }));
}

/** aspect_ratio 预取记录（骨架 justifiedLayout 的输入 + 增量更新按 id 定位） */
export interface AspectRatioRow {
  id: string;
  timestamp: number;
  /** 格子的宽高比（G13 换算后，与真图排版同一个值，见 utils/imageDisplay 的 layoutRatio） */
  aspectRatio: number;
}

type RatioRow = { id: string; timestamp: number; aspect_ratio: number | null; width: number | null; height: number | null };

const toAspectRatioRow = (r: RatioRow): AspectRatioRow => ({
  id: r.id,
  timestamp: r.timestamp,
  aspectRatio: layoutRatio({ aspectRatio: r.aspect_ratio ?? 1.0, width: r.width, height: r.height }),
});

/**
 * 按时间戳闭区间只拉 aspect_ratio 列（skeleton 天预取，供按真实比例跑 justifiedLayout）
 *
 * 相比 getItemsByDayRangeQuery:
 * - 只取 id + timestamp + aspect_ratio + 宽高（不拉 results JSON，查询快 3-5 倍）
 * - 不做 ImageMeta 组装，直接返回原始值
 * - filter 条件与 getItemsByDayRange 完全一致，保证顺序与真图 layout 同序
 * - id 用于增量删除场景的精准移除
 */
export async function getDayAspectRatiosByRangeQuery(
  db: Database,
  startTs: number,
  endTs: number,
  filter?: DayStatsFilter,
): Promise<AspectRatioRow[]> {
  const params: (string | number)[] = [startTs, endTs];
  const conditions: string[] = ['timestamp >= $1', 'timestamp <= $2'];
  appendFilterClause(filter, conditions, params);

  const rows = await db.select<RatioRow[]>(
    // 和 getItemsByDayRangeQuery 必须完全同序（包括 timestamp 相等时的 tiebreaker），
    // 否则 skeleton 按比例 layout 与真图 layout 位置不一致，图片加载时会闪一下
    `SELECT id, timestamp, aspect_ratio, width, height
     FROM history_items
     WHERE ${conditions.join(' AND ')}
     ORDER BY timestamp DESC, id DESC`,
    params,
  );

  return rows.map(toAspectRatioRow);
}

/**
 * 全量拉 aspect_ratio（v7 预取路径，timeline 首次挂载时在后台跑）
 *
 * 与 getDayAspectRatiosByRangeQuery 相同的 filter 和 ORDER BY，只是没有 timestamp 范围。
 * 返回行数 ≤ MAX_PRELOAD_THRESHOLD，调用方（useTimelineDayPagination）在 dayStats 返回后
 * 检查 totalCount，超阈值则跳过此查询走懒加载降级。
 */
export async function getAllAspectRatiosQuery(
  db: Database,
  filter?: DayStatsFilter,
): Promise<AspectRatioRow[]> {
  const params: (string | number)[] = [];
  const conditions: string[] = [];
  appendFilterClause(filter, conditions, params);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await db.select<RatioRow[]>(
    `SELECT id, timestamp, aspect_ratio, width, height
     FROM history_items
     ${where}
     ORDER BY timestamp DESC, id DESC`,
    params,
  );

  return rows.map(toAspectRatioRow);
}

/** 当前筛选下的全部 id，新的在前（G04「Ctrl/⌘ A 全选当前结果」：不只是已经加载出来的那几天） */
export async function getIdsQuery(db: Database, filter: DayStatsFilter | undefined): Promise<string[]> {
  const params: (string | number)[] = [];
  const conditions: string[] = [];
  appendFilterClause(filter, conditions, params);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.select<Array<{ id: string }>>(
    `SELECT id FROM history_items ${where} ORDER BY timestamp DESC, id DESC`,
    params,
  );
  return rows.map((row) => row.id);
}
