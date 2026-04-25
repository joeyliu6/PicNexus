export type StatusFilter =
  | 'invalid'
  | 'suspicious'
  | 'timeout'
  | 'unchecked'
  | 'valid'
  | 'all'
  | null;

export const SEVERITY: Record<string, number> = {
  http_4xx: 0,
  http_5xx: 1,
  network: 2,
  timeout: 3,
  suspicious: 4,
  success: 5,
};

export interface CheckLinkResult {
  link: string;
  is_valid: boolean;
  status_code?: number;
  error?: string;
  error_type: 'success' | 'http_4xx' | 'http_5xx' | 'timeout' | 'network' | 'suspicious';
  suggestion?: string;
  response_time?: number;
  detected_service?: string;
  browser_might_work: boolean;
  content_type?: string;
  content_length?: number;
}

export interface BatchCheckProgress {
  checked: number;
  total: number;
  current_url: string;
  current_result?: CheckLinkResult;
  /** 自上次广播以来累积的逐条结果，前端用它把状态实时 patch 到 checkRows */
  recent_results?: BatchCheckItemResult[];
}

export interface BatchCheckItemResult extends CheckLinkResult {
  history_id?: string;
  service_id?: string;
}

export interface BatchCheckResult {
  results: BatchCheckItemResult[];
  total: number;
  valid: number;
  invalid: number;
  timeout: number;
  suspicious: number;
  elapsed_ms: number;
  cancelled: boolean;
}

export interface BatchCheckRequest {
  links: BatchCheckRequestItem[];
  concurrency?: number;
  per_host_limit?: number;
  timeout_secs?: number;
}

export interface BatchCheckRequestItem {
  url: string;
  history_id?: string;
  service_id?: string;
  fallback_url?: string;
}

export interface LinkCheckRow {
  historyId: string;
  serviceId: string;
  url: string;
  rawUrl: string;
  fileName: string;
  fallbackUrl?: string;
  checkResult?: CheckLinkResult;
  recheckResult?: CheckLinkResult;
  recheckLoading?: boolean;
  recheckBadgeFading?: boolean;
  fadingOut?: boolean;
  pinnedSortWeight?: number;
}

export interface MdImageLink {
  originalText: string;
  url: string;
  altText: string;
  lineNumber: number;
  syntax: 'markdown' | 'html';
  context?: 'normal' | 'blockquote' | 'table';
  excluded?: boolean;
  checkResult?: CheckLinkResult;
  backupLinks?: MdBackupLink[];
  selectedBackup?: string;
}

export interface MdBackupLink {
  url: string;
  serviceId: string;
  checkResult?: CheckLinkResult;
}

export interface MdReplacement {
  originalUrl: string;
  newUrl: string;
  lineNumber: number;
}

export interface ServiceStat {
  serviceId: string;
  total: number;
  valid: number;
  invalid: number;
  unchecked: number;
  checked: number;
  healthRate: number;
}
