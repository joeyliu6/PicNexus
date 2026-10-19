import type { HistoryItem, ServiceType } from '@/config/types';

export interface LinkCheckLiteRow {
  id: string;
  /** 上传时间（毫秒） */
  timestamp: number;
  local_file_name: string;
  primary_service: string;
  results: string;
  link_check_status: string | null;
}

export interface PageOptions {
  page: number;
  pageSize?: number;
  serviceFilter?: ServiceType | 'all';
}

export interface PageResult {
  items: HistoryItem[];
  total: number;
  hasMore: boolean;
}

export interface SearchOptions {
  serviceFilter?: ServiceType | 'all';
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  items: HistoryItem[];
  total: number;
  hasMore: boolean;
}

export interface TimePeriodStats {
  year: number;
  month: number;
  count: number;
  minTimestamp: number;
  maxTimestamp: number;
}

export interface DayStats {
  year: number;
  month: number;
  day: number;
  count: number;
  aspectRatioSum: number;
  minTimestamp: number;
  maxTimestamp: number;
}

/** 图库「状态」筛选的取值：复制链接失效 / 可能受限 / 尚未检测，以及只有 1 份 */
export type GalleryStatusFilter = 'dead' | 'limited' | 'unchecked' | 'single';

export interface DayStatsFilter {
  /** 复制时使用的图床（旧视图的筛选） */
  serviceFilter?: ServiceType | 'all';
  /** 图库「图床」筛选：这个图床上存有一份（不论是不是复制时使用的） */
  hostFilter?: string;
  /** 图库「状态」筛选：命中任意一项即可 */
  statusFilter?: readonly GalleryStatusFilter[];
  /** 图库「时间」筛选：只看这个时间之后上传的（毫秒） */
  since?: number;
  searchTerm?: string;
  favoritesOnly?: boolean;
  /** 别的图床上还有没有一份没被查出失效（图库「失效」分组，G06 / G07） */
  backup?: 'available' | 'none';
}

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
  | 'sync_history'
  | 'password_set'
  | 'password_change'
  | 'password_disable';

export interface SyncLogEntry {
  id: string;
  timestamp: number;
  operation: SyncLogOperation;
  result: 'success' | 'failed';
  details?: string;
  profileId?: string;
  profileName?: string;
}

export type { HistoryItem, ServiceType };
