// 链接检测数据构建 —— 纯函数，不依赖单例状态

import type { HistoryItem, UserConfig, ServiceType } from '../../config/types';
import { applyLinkPrefix } from '../useCopyLink';
import type { LinkCheckLiteRow } from '../../services/HistoryDatabase';
import type {
  BatchCheckRequestItem,
  LinkCheckRow,
  CheckLinkResult,
  BatchCheckResult,
} from '../../types/linkCheck';

/** 将轻量行转为 buildCheckItemsSync 所需的最小 HistoryItem */
export function liteRowToItem(row: LinkCheckLiteRow): HistoryItem {
  const parsed = typeof row.results === 'string' ? JSON.parse(row.results) : row.results;
  const linkCheckStatus = row.link_check_status
    ? (typeof row.link_check_status === 'string' ? JSON.parse(row.link_check_status) : row.link_check_status)
    : undefined;
  return {
    id: row.id,
    localFileName: row.local_file_name,
    primaryService: row.primary_service as ServiceType,
    results: parsed,
    linkCheckStatus,
    // 以下字段不影响链接检测逻辑，填默认值
    timestamp: 0,
    generatedLink: '',
  };
}

/**
 * 从 HistoryItem 列表构建待检测 URL（同步版，需提前加载 config）
 * 对微博链接自动拼接当前前缀配置
 */
export function buildCheckItemsSync(items: HistoryItem[], config: UserConfig): {
  requestItems: BatchCheckRequestItem[];
  rows: LinkCheckRow[];
} {
  const requestItems: BatchCheckRequestItem[] = [];
  const rows: LinkCheckRow[] = [];

  for (const item of items) {
    if (!item.results) continue;
    for (const r of item.results) {
      if (r.status !== 'success' || !r.result?.url) continue;

      const rawUrl = r.result.url;
      const finalUrl = applyLinkPrefix(rawUrl, r.serviceId, config);
      // GitHub CDN 启用时：metadata.rawUrl 是原始 raw.githubusercontent.com URL
      // finalUrl 经模板转换后与 rawUrl 不同，用 rawUrl 作为 fallback
      const ghRaw = r.serviceId === 'github'
        ? ((r.result.metadata as Record<string, unknown>)?.rawUrl as string | undefined)
        : undefined;
      const fallbackUrl = (ghRaw && ghRaw !== finalUrl) ? ghRaw : undefined;

      requestItems.push({
        url: finalUrl,
        history_id: item.id,
        service_id: r.serviceId,
        fallback_url: fallbackUrl,
      });

      rows.push({
        historyId: item.id,
        serviceId: r.serviceId,
        url: finalUrl,
        rawUrl,
        fileName: item.localFileName,
        fallbackUrl,
      });
    }
  }

  return { requestItems, rows };
}

/** 恢复已有的检测状态（用 Map O(1) 查找） */
export function restoreCheckStatus(rows: LinkCheckRow[], items: HistoryItem[]): void {
  const itemMap = new Map(items.map((i) => [i.id, i]));
  for (const row of rows) {
    const item = itemMap.get(row.historyId);
    if (item?.linkCheckStatus?.[row.serviceId]) {
      const saved = item.linkCheckStatus[row.serviceId];
      row.checkResult = {
        link: row.url,
        is_valid: saved.isValid,
        status_code: saved.statusCode,
        error_type: saved.errorType === 'pending' ? 'network' : saved.errorType,
        response_time: saved.responseTime,
        error: saved.error,
        browser_might_work: false,
      };
    }
  }
}

/** 将检测结果关联到 rows（用 Map O(1) 查找替代 .find() O(n)） */
export function applyResultsToRows(rows: LinkCheckRow[], results: BatchCheckResult['results']): void {
  const rowMap = new Map(rows.map((r) => [`${r.url}::${r.historyId}`, r]));
  for (const itemResult of results) {
    const row = rowMap.get(`${itemResult.link}::${itemResult.history_id}`);
    if (row) row.checkResult = itemResult as CheckLinkResult;
  }
}
