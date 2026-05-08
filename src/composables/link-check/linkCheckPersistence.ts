// 链接检测持久化 —— DB 更新与 CSV 导出

import type { HistoryItem } from '../../config/types';
import { historyDB } from '../../services/HistoryDatabase';
import { createLogger } from '../../utils/logger';
import type {
  BatchCheckResult,
  LinkCheckRow,
} from '../../types/linkCheck';

const log = createLogger('LinkCheck');

type LinkCheckStatusMap = NonNullable<HistoryItem['linkCheckStatus']>;
type LinkCheckStatusEntry = LinkCheckStatusMap[string];
export type ErrorTypeUnion = LinkCheckStatusEntry['errorType'];

const VALID_ERROR_TYPES: readonly ErrorTypeUnion[] = [
  'success', 'http_4xx', 'http_5xx', 'timeout', 'network', 'suspicious', 'pending',
];

/** 把 Rust 端的 error_type 收敛到合法的持久化 union（未知值落到 'network'） */
export function normalizeErrorType(raw: string): ErrorTypeUnion {
  return (VALID_ERROR_TYPES as readonly string[]).includes(raw)
    ? (raw as ErrorTypeUnion)
    : 'network';
}

function safeParseStatus(raw: string | null): LinkCheckStatusMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed as LinkCheckStatusMap : {};
  } catch {
    return {};
  }
}

function countSuccessServices(rawResults: string | null): number {
  if (!rawResults) return 0;
  try {
    const parsed = JSON.parse(rawResults);
    if (!Array.isArray(parsed)) return 0;
    return parsed.filter((r) => r?.status === 'success' && r?.result?.url).length;
  } catch {
    return 0;
  }
}

/**
 * 批量检测完成后，更新 DB 中的 linkCheckStatus/linkCheckSummary
 *
 * 关键不变量：必须先读出 DB 里现有的 linkCheckStatus 再 merge，
 * 否则子集复检（如「重检失效链接」只跑了 weibo）会把同条历史里其他图床
 * （github / oss）的检测状态全部覆盖丢失。
 */
export async function updateHistoryCheckStatus(
  result: BatchCheckResult,
): Promise<void> {
  // 按 historyId 分组检测结果
  const grouped = new Map<string, typeof result.results>();
  for (const r of result.results) {
    if (!r.history_id) continue;
    const list = grouped.get(r.history_id) || [];
    list.push(r);
    grouped.set(r.history_id, list);
  }

  if (grouped.size === 0) {
    await historyDB.batchUpdateLinkCheckStatus([]);
    return;
  }

  // 读取现有 link_check_status / results 用于 merge + 准确计算 summary
  const ids = Array.from(grouped.keys());
  const contextMap = await historyDB.getLinkCheckContextByIds(ids);

  const updates: Array<{ id: string; linkCheckStatus: string; linkCheckSummary: string }> = [];
  const now = Date.now();

  for (const [historyId, checkResults] of grouped) {
    const context = contextMap.get(historyId);
    // 基于 DB 现状 merge：保留未参与本次检测的图床状态
    const merged: LinkCheckStatusMap = { ...safeParseStatus(context?.linkCheckStatus ?? null) };

    for (const cr of checkResults) {
      const sid = cr.service_id || 'unknown';
      merged[sid] = {
        isValid: cr.is_valid,
        lastCheckTime: now,
        statusCode: cr.status_code,
        errorType: normalizeErrorType(cr.error_type),
        responseTime: cr.response_time,
        error: cr.error || undefined,
        browserMightWork: cr.browser_might_work || undefined,
      };
    }

    // summary 应反映该历史项的完整状态（不是仅本次复检的子集）
    const totalLinks = countSuccessServices(context?.results ?? null) || Object.keys(merged).length;
    let validCount = 0;
    let invalidCount = 0;
    for (const entry of Object.values(merged)) {
      if (entry.isValid) validCount++;
      else invalidCount++;
    }
    const checkedCount = validCount + invalidCount;
    const uncheckedLinks = Math.max(0, totalLinks - checkedCount);

    const linkCheckSummary: NonNullable<HistoryItem['linkCheckSummary']> = {
      totalLinks,
      validLinks: validCount,
      invalidLinks: invalidCount,
      uncheckedLinks,
      lastCheckTime: now,
    };

    updates.push({
      id: historyId,
      linkCheckStatus: JSON.stringify(merged),
      linkCheckSummary: JSON.stringify(linkCheckSummary),
    });
  }

  try {
    await historyDB.batchUpdateLinkCheckStatus(updates);
  } catch (err) {
    log.error('批量更新检测状态失败', err);
    throw err;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CSV 导出
// ────────────────────────────────────────────────────────────────────────────

/**
 * CSV 公式注入防护：以 = + - @ 开头的单元格在 Excel/WPS 里会被当作公式执行
 * 用前置撇号让其退化为纯文本（行业通行做法）
 */
function guardFormulaInjection(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

const wrapQuoted = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** RFC 4180 字段转义：含 " / , / \n / \r 时整体加引号，内嵌 " 加倍 */
function csvEscape(value: string): string {
  const guarded = guardFormulaInjection(value);
  return /[",\r\n]/.test(guarded) ? wrapQuoted(guarded) : guarded;
}

/** 文件名 / URL 始终包引号（保留旧行为以兼容下游导入工具与既有测试），内部仍做完整转义 */
function csvAlwaysQuoted(value: string): string {
  return wrapQuoted(guardFormulaInjection(value));
}

function statusLabel(row: LinkCheckRow): string {
  const r = row.checkResult;
  if (!r) return '未检测';
  if (r.is_valid) return '有效';
  if (r.error_type === 'timeout') return '超时';
  if (r.error_type === 'suspicious' || r.browser_might_work) return '疑似异常';
  return '失效';
}

/**
 * 导出检测结果为 CSV
 *
 * - UTF-8 BOM 前缀：Windows Excel 不会乱码（项目中文优先，必须加）
 * - 字段全部走 csvEscape：防止文件名/URL 里的引号、逗号、换行打乱列
 * - 检测时间字段：取本条 checkResult 上的实际时间（如有），否则置空，不再用导出当下时间
 */
export function exportCsv(rows: LinkCheckRow[]): string {
  const headerCols = ['序号', '文件名', '图床', 'URL', '状态', 'HTTP 状态码', '响应时间（ms）', '检测时间'];
  const header = headerCols.map(csvEscape).join(',');

  const csvRows = rows.map((row, i) => {
    const r = row.checkResult;
    return [
      String(i + 1),
      csvAlwaysQuoted(row.fileName ?? ''),
      csvEscape(row.serviceId ?? ''),
      csvAlwaysQuoted(row.url ?? ''),
      csvEscape(statusLabel(row)),
      r?.status_code != null ? String(r.status_code) : '',
      r?.response_time != null ? String(r.response_time) : '',
      '', // 检测时间：当前 row 数据结构未携带 lastCheckTime，留空避免与导出当下时间混淆
    ].join(',');
  });

  // UTF-8 BOM：让 Windows Excel/WPS 正确识别中文编码（项目中文优先）
  return '﻿' + [header, ...csvRows].join('\n');
}
