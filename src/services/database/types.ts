/**
 * 数据库服务层公共类型定义
 */

/** 链接检测专用轻量行类型（仅包含检测所需字段，减少 ~60% 数据传输） */
export interface LinkCheckLiteRow {
  id: string;
  local_file_name: string;
  primary_service: string;
  results: string; // JSON 字符串
  link_check_status: string | null; // JSON 字符串
}

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

// 从 config/types 导入以用于接口定义
import type { HistoryItem, ServiceType } from '../../config/types';
// 重新导出以方便子模块使用（避免循环引用，这里仅用 type）
export type { HistoryItem, ServiceType };
