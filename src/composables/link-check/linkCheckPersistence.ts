// 链接检测持久化 —— DB 更新与 CSV 导出

import type { HistoryItem } from '../../config/types';
import { historyDB } from '../../services/HistoryDatabase';
import { createLogger } from '../../utils/logger';
import type {
  BatchCheckResult,
  LinkCheckRow,
} from '../../types/linkCheck';

const log = createLogger('LinkCheck');

/**
 * 批量检测完成后，更新 DB 中的 linkCheckStatus/linkCheckSummary
 * 使用 batchUpdateLinkCheckStatus 批量写入，避免逐条 update 的 O(n) 串行等待
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

  // 构建批量更新数据
  const updates: Array<{ id: string; linkCheckStatus: string; linkCheckSummary: string }> = [];
  const now = Date.now();

  for (const [historyId, checkResults] of grouped) {
    const linkCheckStatus: NonNullable<HistoryItem['linkCheckStatus']> = {};
    for (const cr of checkResults) {
      const sid = cr.service_id || 'unknown';
      linkCheckStatus[sid] = {
        isValid: cr.is_valid,
        lastCheckTime: now,
        statusCode: cr.status_code,
        errorType: cr.error_type as 'success' | 'http_4xx' | 'http_5xx' | 'timeout' | 'network' | 'pending',
        responseTime: cr.response_time,
        error: cr.error || undefined,
      };
    }

    const totalLinks = checkResults.length;
    const validCount = checkResults.filter((r) => r.is_valid).length;

    const linkCheckSummary: NonNullable<HistoryItem['linkCheckSummary']> = {
      totalLinks,
      validLinks: validCount,
      invalidLinks: totalLinks - validCount,
      uncheckedLinks: 0,
      lastCheckTime: now,
    };

    updates.push({
      id: historyId,
      linkCheckStatus: JSON.stringify(linkCheckStatus),
      linkCheckSummary: JSON.stringify(linkCheckSummary),
    });
  }

  try {
    await historyDB.batchUpdateLinkCheckStatus(updates);
  } catch (err) {
    log.error('批量更新检测状态失败', err);
  }
}

/**
 * 导出检测结果为 CSV
 */
export function exportCsv(rows: LinkCheckRow[]): string {
  const header = '序号,文件名,图床,URL,状态,HTTP状态码,响应时间(ms),检测时间';
  const csvRows = rows.map((row, i) => {
    const r = row.checkResult;
    const status = r
      ? r.is_valid ? '有效' : r.error_type === 'timeout' ? '超时' : r.error_type === 'suspicious' ? '疑似异常' : '失效'
      : '未检测';
    return [
      i + 1,
      `"${row.fileName}"`,
      row.serviceId,
      `"${row.url}"`,
      status,
      r?.status_code || '',
      r?.response_time || '',
      new Date().toISOString(),
    ].join(',');
  });

  return [header, ...csvRows].join('\n');
}
