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
 * 把「所有图床上传均失败」那条聚合错误压成一句人能读的话
 *
 * `MultiServiceUploader` 抛出来的原文长这样（多行、带 serviceId、带尾注）：
 *
 * ```
 * 所有图床上传均失败：
 *   - webdav:msrlk...: WebDAV 错误: 路径不存在，请检查远程路径配置
 *
 * 请检查网络连接和服务配置
 * ```
 *
 * Why 需要它：`UploadExecutor` 原先在这一支里**把整段原文丢掉**，只弹一句
 * 「未能上传至任何图床」。原因明明在手里却不给——2026-08-20 真机验收时
 * 用户上传失败，界面一个字都没说为什么，最后是靠命令行跑同一份配置才知道是
 * 「路径不存在」。（队列卡片的 tooltip 里有，但那要鼠标悬停才看得见。）
 *
 * Why 不改 `MultiServiceUploader` 去抛结构化错误：那是高风险文件（见 AGENTS.md），
 * 而这里要的信息它已经写进消息里了，解析一下比改抛出契约划算得多。
 *
 * @returns 形如 `dufs 本地 · 路径不存在，请检查远程路径配置`；解析不出来返回空串
 */
export function summarizeAllServicesFailed(errorMsg: string): string {
  // 只认「两个空格 + 短横线」这种缩进条目，避免把尾注那行也吃进来
  const details: MigrateFailureDetail[] = [];
  for (const line of errorMsg.split(/\r?\n/u)) {
    const match = /^\s+-\s+(\S+?):\s*(.+)$/u.exec(line);
    if (!match) continue;
    const [, serviceId, rawReason] = match;
    const reason = cleanMigrateError(serviceId, rawReason.trim());
    if (reason) details.push({ serviceId, message: reason });
  }

  // 复用迁移那套拼法，两处的失败摘要读起来是同一个调子
  return formatMigrateFailureSummary(details);
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

