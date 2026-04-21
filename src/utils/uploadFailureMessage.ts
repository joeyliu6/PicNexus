import { getServiceDisplayName, getServiceAliases } from '../constants/serviceNames';
import type { MigrateFailureDetail } from '../types/batchMigrate';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimLeadingSeparators(value: string): string {
  return value.replace(/^[\s:：;；，,。.()（）-]+/u, '').trim();
}

function ensureTrailingPeriod(value: string): string {
  return /[。！？.!?]$/u.test(value) ? value : `${value}。`;
}

function buildPrefixPatterns(serviceName: string, aliases: string[]): RegExp[] {
  const namedPatterns = [serviceName, ...aliases]
    .map(name => name.trim())
    .filter(Boolean)
    .map(name => new RegExp(`^${escapeRegExp(name)}\\s*(?:图床)?\\s*上传失败\\s*`, 'iu'));

  return [
    ...namedPatterns,
    /^[a-z0-9_-]+\s*上传失败\s*/iu,
    /^上传失败\s*/iu,
    /^upload failed\s*/iu,
  ];
}

export function normalizeUploadFailureReason(
  serviceName: string,
  error?: string,
  aliases: string[] = []
): string {
  let reason = (error || '').trim();
  if (!reason) return '';

  const patterns = buildPrefixPatterns(serviceName, aliases);
  let previous = '';

  while (reason && reason !== previous) {
    previous = reason;
    for (const pattern of patterns) {
      reason = trimLeadingSeparators(reason.replace(pattern, ''));
    }
  }

  return reason;
}

export function buildUploadFailureTooltip(
  serviceName: string,
  error?: string,
  aliases: string[] = []
): string {
  const reason = normalizeUploadFailureReason(serviceName, error, aliases);
  if (!reason) {
    return `${serviceName}上传失败。点击右侧重试。`;
  }

  return `${serviceName}上传失败：${ensureTrailingPeriod(reason)}点击右侧重试。`;
}

/**
 * 清洗单条迁移错误消息（批量迁移专用）
 * - 有 serviceId 时用该图床的 displayName + aliases 剥掉 "xxx 上传失败:" 前缀
 * - 无 serviceId 时只剥通用前缀（"上传失败"/"upload failed"）
 */
export function cleanMigrateError(serviceId: string | undefined, raw: string): string {
  if (!raw) return '';
  if (!serviceId) return normalizeUploadFailureReason('', raw);
  return normalizeUploadFailureReason(getServiceDisplayName(serviceId), raw, getServiceAliases(serviceId));
}

/**
 * 把结构化 failure details 拼成易读摘要
 * 单条：`dispatch failure` 或 `Cloudflare R2 · dispatch failure`
 * 多条：用 `；` 分隔
 */
export function formatMigrateFailureSummary(details: MigrateFailureDetail[]): string {
  if (details.length === 0) return '';
  return details
    .map(d => d.serviceId ? `${getServiceDisplayName(d.serviceId)} · ${d.message}` : d.message)
    .join('；');
}

/**
 * 迁移错误友好分类 —— 把底层技术错误映射为用户能看懂的中文大类
 * 原始错误文本仍保留在 raw 字段里，UI 通过 tooltip 暴露给想看细节的用户
 */
export type MigrateErrorCategory =
  | '网络中断'
  | '请求超时'
  | '源图片失效'
  | '图床服务异常'
  | '格式不支持'
  | '权限不足'
  | '文件过大'
  | '未知错误';

interface ErrorPattern {
  pattern: RegExp;
  category: MigrateErrorCategory;
  /** 限定此规则仅适用于某种 errorType，不填则任何 errorType 都匹配 */
  scope?: 'download' | 'upload';
}

const MIGRATE_ERROR_PATTERNS: ErrorPattern[] = [
  // 下载类
  { pattern: /end of file before message length reached|connection (?:reset|refused|closed|aborted)|network (?:is )?unreachable|socket hang up/iu, category: '网络中断' },
  { pattern: /timed? ?out|deadline exceeded|timeout/iu, category: '请求超时' },
  { pattern: /\b40[34]\b|not found|forbidden/iu, category: '源图片失效', scope: 'download' },
  // 上传类
  { pattern: /\b(?:413|payload too large|file too large|request entity too large)\b/iu, category: '文件过大', scope: 'upload' },
  { pattern: /\b(?:401|403)\b|unauthorized|forbidden|token|invalid cookie|未登录|鉴权|认证失败/iu, category: '权限不足', scope: 'upload' },
  { pattern: /unsupported format|invalid image|unsupported media type|format not (?:supported|allowed)|\b415\b/iu, category: '格式不支持', scope: 'upload' },
  { pattern: /JSON 解析失败|invalid type|parse (?:error|failure)|\b5\d{2}\b|bad gateway|service unavailable|internal server error/iu, category: '图床服务异常', scope: 'upload' },
];

/**
 * 根据错误类型和原始错误消息，归类为用户能看懂的大类
 * - 匹配顺序按 MIGRATE_ERROR_PATTERNS 声明顺序（先匹配更具体的）
 * - 不命中任何规则 → '未知错误'
 */
export function categorizeMigrateError(
  errorType: 'download' | 'upload' | undefined,
  rawMessage: string,
): { category: MigrateErrorCategory; raw: string } {
  const raw = (rawMessage || '').trim();
  if (!raw) return { category: '未知错误', raw: '' };

  for (const rule of MIGRATE_ERROR_PATTERNS) {
    if (rule.scope && rule.scope !== errorType) continue;
    if (rule.pattern.test(raw)) return { category: rule.category, raw };
  }
  return { category: '未知错误', raw };
}

