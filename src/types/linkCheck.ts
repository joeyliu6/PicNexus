export const SEVERITY: Record<string, number> = {
  http_4xx: 0,
  http_5xx: 1,
  network: 2,
  // 被本机出站策略拦下，与 network 同权重（漏了这条会被 ?? SEVERITY.success 兜底，
  // 把被拦链接按"成功"权重排到列表最底）
  blocked: 2,
  timeout: 3,
  suspicious: 4,
  // 3xx 跳转与 suspicious 同权重：都是「大概率还能看，但值得看一眼」
  // （同样漏了会被 ?? SEVERITY.success 兜底，排到列表最底）
  redirect: 4,
  success: 5,
};

export interface CheckLinkResult {
  link: string;
  is_valid: boolean;
  status_code?: number;
  error?: string;
  /**
   * `blocked` = 请求没发出去，被本机出站策略拦下；真实原因在 `error` 字段
   * `redirect` = 对端返回 3xx；检测器不跟随跳转是 SSRF 防护，浏览器会跟随，所以不算失效
   */
  error_type: 'success' | 'http_4xx' | 'http_5xx' | 'redirect' | 'timeout' | 'network' | 'suspicious' | 'blocked';
  suggestion?: string;
  response_time?: number;
  detected_service?: string;
  browser_might_work: boolean;
  content_type?: string;
  content_length?: number;
}

export interface BatchCheckProgress {
  batch_id?: string;
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
  batch_id?: string;
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
  batch_id?: string;
  concurrency?: number;
  per_host_limit?: number;
  timeout_secs?: number;
  /** 已确认明文 HTTP 主机名（fake-ip 逃生舱），漏传会让这批图床被误判「策略拦截」 */
  confirmed_http_hosts?: string[];
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
  /** 这一份是不是主链接（用户复制出去、写进文档的那条） */
  isPrimary?: boolean;
  /** 部分图床生成缩略图要用（如微博 pid） */
  fileKey?: string;
  checkResult?: CheckLinkResult;
  /** checkResult 是什么时候查出来的（毫秒时间戳）；结论卡的「N 天前检查」取全部行里最新的一个 */
  checkedAt?: number;
  recheckResult?: CheckLinkResult;
  recheckLoading?: boolean;
  fadingOut?: boolean;
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
