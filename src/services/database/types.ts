import type { HistoryItem, ServiceType } from '../../config/types';
import type { ImageMeta } from '../../types/image-meta';

export interface LinkCheckLiteRow {
  id: string;
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

export interface FavoritesMetaPageOptions {
  offset: number;
  limit: number;
  serviceFilter?: ServiceType | 'all';
  searchTerm?: string;
}

export interface FavoritesMetaPageResult {
  items: ImageMeta[];
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

export interface DayStatsFilter {
  serviceFilter?: ServiceType | 'all';
  searchTerm?: string;
  favoritesOnly?: boolean;
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

export type { HistoryItem, ServiceType };
