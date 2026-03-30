// 链接检测功能类型定义
// 镜像 Rust link_checker.rs 中的结构体

/** 单条链接检测结果（对应 Rust CheckLinkResult） */
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

/** 批量检测进度（通过 Tauri 事件接收） */
export interface BatchCheckProgress {
  checked: number;
  total: number;
  current_url: string;
  current_result?: CheckLinkResult;
}

/** 批量检测单条结果（带关联信息） */
export interface BatchCheckItemResult extends CheckLinkResult {
  history_id?: string;
  service_id?: string;
}

/** 批量检测最终结果 */
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

/** 发送给 Rust 的批量检测请求 */
export interface BatchCheckRequest {
  links: BatchCheckRequestItem[];
  concurrency?: number;
  per_host_limit?: number;
  timeout_secs?: number;
}

/** 批量检测请求中的单条链接 */
export interface BatchCheckRequestItem {
  url: string;
  history_id?: string;
  service_id?: string;
}

/** 前端展示用的检测结果行 */
export interface LinkCheckRow {
  historyId: string;
  serviceId: string;
  url: string;
  rawUrl: string;
  fileName: string;
  checkResult?: CheckLinkResult;
}

/** MD 文件中的图片链接 */
export interface MdImageLink {
  /** 完整匹配文本 ![alt](url) 或 <img src="url"> */
  originalText: string;
  /** 图片 URL */
  url: string;
  /** alt 文本 */
  altText: string;
  /** 所在行号 */
  lineNumber: number;
  /** 语法类型 */
  syntax: 'markdown' | 'html';
  /** 链接所在的 Markdown 上下文 */
  context?: 'normal' | 'blockquote' | 'table';
  /** 用户标记排除（不参与检测） */
  excluded?: boolean;
  /** 检测结果 */
  checkResult?: CheckLinkResult;
  /** 可用的备用链接 */
  backupLinks?: MdBackupLink[];
  /** 用户选择的替换 URL */
  selectedBackup?: string;
}

/** MD 救援中的备用链接 */
export interface MdBackupLink {
  url: string;
  serviceId: string;
  checkResult?: CheckLinkResult;
}

/** MD 替换操作 */
export interface MdReplacement {
  originalUrl: string;
  newUrl: string;
  lineNumber: number;
}

/** 按图床分组的健康统计 */
export interface ServiceStat {
  serviceId: string;
  total: number;
  valid: number;
  invalid: number;
  unchecked: number;
  checked: number;
  healthRate: number;
}
