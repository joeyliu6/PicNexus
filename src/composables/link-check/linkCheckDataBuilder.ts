import type { HistoryItem, ServiceType, UserConfig } from '../../config/types';
import type { LinkCheckLiteRow } from '../../services/HistoryDatabase';
import type {
  BatchCheckRequestItem,
  BatchCheckResult,
  CheckLinkResult,
  LinkCheckRow,
} from '../../types/linkCheck';
import { applyLinkPrefix } from '../useCopyLink';

export function liteRowToItem(row: LinkCheckLiteRow): HistoryItem {
  const parsedResults = typeof row.results === 'string' ? JSON.parse(row.results) : row.results;
  const linkCheckStatus = row.link_check_status
    ? (typeof row.link_check_status === 'string'
      ? JSON.parse(row.link_check_status)
      : row.link_check_status)
    : undefined;

  return {
    id: row.id,
    timestamp: 0,
    localFileName: row.local_file_name,
    primaryService: row.primary_service as ServiceType,
    results: parsedResults,
    generatedLink: '',
    linkCheckStatus,
  };
}

export function buildCheckItemsSync(
  items: HistoryItem[],
  config: UserConfig,
): {
  requestItems: BatchCheckRequestItem[];
  rows: LinkCheckRow[];
} {
  const requestItems: BatchCheckRequestItem[] = [];
  const rows: LinkCheckRow[] = [];

  for (const item of items) {
    if (!item.results) continue;

    for (const result of item.results) {
      if (result.status !== 'success' || !result.result?.url) continue;

      const rawUrl = result.result.url;
      const finalUrl = applyLinkPrefix(rawUrl, result.serviceId, config);
      const rawGithubUrl = result.serviceId === 'github'
        ? ((result.result.metadata as Record<string, unknown>)?.rawUrl as string | undefined)
        : undefined;
      const fallbackUrl = rawGithubUrl && rawGithubUrl !== finalUrl ? rawGithubUrl : undefined;

      requestItems.push({
        url: finalUrl,
        history_id: item.id,
        service_id: result.serviceId,
        fallback_url: fallbackUrl,
      });

      rows.push({
        historyId: item.id,
        serviceId: result.serviceId,
        url: finalUrl,
        rawUrl,
        fileName: item.localFileName,
        fallbackUrl,
      });
    }
  }

  return { requestItems, rows };
}

export function restoreCheckStatus(rows: LinkCheckRow[], items: HistoryItem[]): void {
  const itemMap = new Map(items.map((item) => [item.id, item]));

  for (const row of rows) {
    const item = itemMap.get(row.historyId);
    if (!item?.linkCheckStatus?.[row.serviceId]) continue;

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

export function applyResultsToRows(rows: LinkCheckRow[], results: BatchCheckResult['results']): void {
  const rowMap = new Map(rows.map((row) => [`${row.url}::${row.historyId}`, row]));

  for (const itemResult of results) {
    const row = rowMap.get(`${itemResult.link}::${itemResult.history_id}`);
    if (row) row.checkResult = itemResult as CheckLinkResult;
  }
}
