/**
 * 时间轴按需加载专用查询
 *
 * - getDayStatsQuery：按日聚合，返回骨架数据（首屏 <50ms）
 * - getItemsByDayRangeQuery：按时间戳范围拉具体 metas（按需加载可见天）
 */

import type Database from '@tauri-apps/plugin-sql';
import type { ImageMeta } from '../../types/image-meta';
import type { DayStats, DayStatsFilter, ServiceType } from './types';
import { createLogger } from '../../utils/logger';

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
}

function escapeLikePattern(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&');
}

function rowToImageMeta(row: MetaRow): ImageMeta {
  let primaryFileKey: string | undefined;
  try {
    const parsed = JSON.parse(row.results) as Array<{
      serviceId: string;
      status: string;
      result?: { fileKey?: string };
    }>;
    const hit = parsed.find(r => r.serviceId === row.primary_service && r.status === 'success');
    primaryFileKey = hit?.result?.fileKey;
  } catch {
    log.warn(`解析 results 失败: ${row.id}`);
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
}

/**
 * 按日聚合统计（时间轴首屏骨架数据）
 *
 * 返回每天的 count + aspectRatioSum，前端用 count × avgCellHeight 做占位高度。
 */
export async function getDayStatsQuery(db: Database, filter?: DayStatsFilter): Promise<DayStats[]> {
  const { serviceFilter = 'all', searchTerm, favoritesOnly } = filter ?? {};
  const params: (string | number)[] = [];
  const conditions: string[] = [];
  const nextParam = () => `$${params.length + 1}`;

  if (favoritesOnly) conditions.push('is_favorited = 1');
  if (serviceFilter !== 'all') {
    conditions.push(`primary_service = ${nextParam()}`);
    params.push(serviceFilter);
  }
  const trimmed = searchTerm?.trim().toLowerCase();
  if (trimmed) {
    conditions.push(`local_file_name_lower LIKE ${nextParam()} ESCAPE '\\'`);
    params.push(`%${escapeLikePattern(trimmed)}%`);
  }

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
      SUM(COALESCE(aspect_ratio, 1.0)) as aspect_ratio_sum,
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
export async function getItemsByDayRangeQuery(
  db: Database,
  startTs: number,
  endTs: number,
  filter?: DayStatsFilter,
): Promise<ImageMeta[]> {
  const { serviceFilter = 'all', searchTerm, favoritesOnly } = filter ?? {};

  // $1 = startTs, $2 = endTs，后续 filter 条件从 $3 开始
  const params: (string | number)[] = [startTs, endTs];
  const conditions: string[] = ['timestamp >= $1', 'timestamp <= $2'];
  const nextParam = () => `$${params.length + 1}`;

  if (favoritesOnly) conditions.push('is_favorited = 1');
  if (serviceFilter !== 'all') {
    conditions.push(`primary_service = ${nextParam()}`);
    params.push(serviceFilter);
  }
  const trimmed = searchTerm?.trim().toLowerCase();
  if (trimmed) {
    conditions.push(`local_file_name_lower LIKE ${nextParam()} ESCAPE '\\'`);
    params.push(`%${escapeLikePattern(trimmed)}%`);
  }

  const rows = await db.select<MetaRow[]>(
    `SELECT id, timestamp, local_file_name, aspect_ratio,
            primary_service, generated_link, results, is_favorited
     FROM history_items
     WHERE ${conditions.join(' AND ')}
     ORDER BY timestamp DESC`,
    params,
  );

  return rows.map(rowToImageMeta);
}
