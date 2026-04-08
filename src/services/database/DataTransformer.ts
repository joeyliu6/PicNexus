/**
 * 数据转换层
 *
 * HistoryItem ↔ 数据库行的双向转换，以及 SQL 辅助函数
 * 被 HistoryDatabase 主类和各子模块共同使用
 */

import type { HistoryItem, ServiceType } from '../../config/types';
import { createLogger } from '../../utils/logger';

const log = createLogger('DataTransformer');

/** 数据库行类型（与 SQL 表结构对应） */
export interface HistoryItemRow {
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
  success_count: number; // 成功上传的图床数量（冗余字段，加速查询）
  successful_service_ids: string; // JSON 数组字符串，如 '["jd","qiniu"]'（冗余字段，加速分布查询）
}

/** 所有列名（INSERT/UPDATE 统一使用，新增列只需改这里） */
export const ALL_COLUMNS = [
  'id', 'timestamp', 'local_file_name', 'local_file_name_lower', 'file_path',
  'primary_service', 'results', 'generated_link', 'link_check_status', 'link_check_summary',
  'width', 'height', 'aspect_ratio', 'file_size', 'format', 'color_type', 'has_alpha', 'is_favorited', 'success_count',
  'successful_service_ids',
] as const;

export const COLUMNS_SQL = ALL_COLUMNS.join(', ');
export const COLUMN_COUNT = ALL_COLUMNS.length;

/** 从 row 对象按 ALL_COLUMNS 顺序提取值数组 */
export function rowValues(row: HistoryItemRow): unknown[] {
  return ALL_COLUMNS.map(col => row[col]);
}

/** 生成 $1, $2, ..., $N 占位符，offset 为起始编号 */
export function columnPlaceholders(offset = 1): string {
  return ALL_COLUMNS.map((_, i) => `$${offset + i}`).join(', ');
}

/**
 * JSON 容错解析，防止数据损坏导致整个查询失败
 */
export function safeJsonParse<T>(json: string | null, fallback: T, field: string, id: string): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch (e) {
    log.error(`${field} JSON 解析失败: ${id}`, e);
    return fallback;
  }
}

/**
 * 将 HistoryItem 转换为数据库行
 * 注意：color_type 和 has_alpha 字段已废弃，使用默认值以保持向后兼容
 */
export function itemToRow(item: HistoryItem): HistoryItemRow {
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
    success_count: item.results.filter(r => r.status === 'success').length,
    successful_service_ids: JSON.stringify(
      item.results.filter(r => r.status === 'success').map(r => r.serviceId),
    ),
  };
}

/**
 * 将数据库行转换为 HistoryItem
 * 注意：color_type 和 has_alpha 字段已废弃，不再读取
 */
export function rowToItem(row: HistoryItemRow): HistoryItem {
  return {
    id: row.id,
    timestamp: row.timestamp,
    localFileName: row.local_file_name,
    filePath: row.file_path || undefined,
    primaryService: row.primary_service as ServiceType,
    results: safeJsonParse(row.results, [], 'results', row.id),
    generatedLink: row.generated_link,
    linkCheckStatus: safeJsonParse(row.link_check_status, undefined, 'linkCheckStatus', row.id),
    linkCheckSummary: safeJsonParse(row.link_check_summary, undefined, 'linkCheckSummary', row.id),
    // 图片元信息（简化版，移除了 colorType 和 hasAlpha）
    width: row.width,
    height: row.height,
    aspectRatio: row.aspect_ratio,
    fileSize: row.file_size,
    format: row.format,
    isFavorited: row.is_favorited === 1,
  };
}
