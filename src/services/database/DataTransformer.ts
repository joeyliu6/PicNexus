import type { HistoryItem, ServiceType } from '../../config/types';
import { createLogger } from '../../utils/logger';

const log = createLogger('DataTransformer');

export interface HistoryItemRow {
  id: string;
  timestamp: number;
  local_file_name: string;
  local_file_name_lower: string;
  file_path: string | null;
  primary_service: string;
  results: string;
  generated_link: string;
  link_check_status: string | null;
  link_check_summary: string | null;
  link_check_skip: number;
  width: number;
  height: number;
  aspect_ratio: number;
  file_size: number;
  format: string;
  color_type: string;
  has_alpha: number;
  is_favorited: number;
  success_count: number;
  successful_service_ids: string;
  migration_skip: number;
}

export const ALL_COLUMNS = [
  'id',
  'timestamp',
  'local_file_name',
  'local_file_name_lower',
  'file_path',
  'primary_service',
  'results',
  'generated_link',
  'link_check_status',
  'link_check_summary',
  'link_check_skip',
  'width',
  'height',
  'aspect_ratio',
  'file_size',
  'format',
  'color_type',
  'has_alpha',
  'is_favorited',
  'success_count',
  'successful_service_ids',
  'migration_skip',
] as const;

export const COLUMNS_SQL = ALL_COLUMNS.join(', ');
export const COLUMN_COUNT = ALL_COLUMNS.length;

export function rowValues(row: HistoryItemRow): unknown[] {
  return ALL_COLUMNS.map((col) => row[col]);
}

export function columnPlaceholders(offset = 1): string {
  return ALL_COLUMNS.map((_, i) => `$${offset + i}`).join(', ');
}

export function safeJsonParse<T>(json: string | null, fallback: T, field: string, id: string): T {
  if (!json) return fallback;

  try {
    return JSON.parse(json);
  } catch (e) {
    log.error(`${field} JSON parse failed: ${id}`, e);
    return fallback;
  }
}

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
    // 列保留但功能已废弃：始终写 0；前端模型不再读出 linkCheckSkip
    link_check_skip: 0,
    width: item.width ?? 0,
    height: item.height ?? 0,
    aspect_ratio: item.aspectRatio ?? 1,
    file_size: item.fileSize ?? 0,
    format: item.format ?? 'unknown',
    color_type: 'unknown',
    has_alpha: 0,
    is_favorited: item.isFavorited ? 1 : 0,
    success_count: item.results.filter((result) => result.status === 'success').length,
    successful_service_ids: JSON.stringify(
      item.results.filter((result) => result.status === 'success').map((result) => result.serviceId),
    ),
    migration_skip: item.migrationSkip ? 1 : 0,
  };
}

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
    width: row.width,
    height: row.height,
    aspectRatio: row.aspect_ratio,
    fileSize: row.file_size,
    format: row.format,
    isFavorited: row.is_favorited === 1,
    migrationSkip: row.migration_skip === 1,
  };
}
