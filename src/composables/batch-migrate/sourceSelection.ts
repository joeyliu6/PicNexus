import type { HistoryItem } from '@/config/types';
import { isUsableMirror } from '@/utils/historyResults';

export interface MigrateSourceCandidate {
  serviceId: string;
  url: string;
  responseTime?: number;
  order: number;
}

export interface RecoverableLinkInfo {
  problemServiceIds: string[];
  validSources: MigrateSourceCandidate[];
  preferredSource: MigrateSourceCandidate;
}

function successfulResults(item: HistoryItem) {
  return item.results
    .map((result, order) => ({ result, order }))
    .filter(({ result }) => isUsableMirror(result));
}

function sortSources(
  sources: MigrateSourceCandidate[],
  item: HistoryItem,
  preferredServiceIds: string[] = [],
): MigrateSourceCandidate[] {
  const preferred = new Set(preferredServiceIds);
  return [...sources].sort((a, b) => {
    const aPreferred = preferred.has(a.serviceId) ? 1 : 0;
    const bPreferred = preferred.has(b.serviceId) ? 1 : 0;
    if (aPreferred !== bPreferred) return bPreferred - aPreferred;

    const aPrimary = a.serviceId === item.primaryService ? 1 : 0;
    const bPrimary = b.serviceId === item.primaryService ? 1 : 0;
    if (aPrimary !== bPrimary) return bPrimary - aPrimary;

    const aResponse = a.responseTime ?? Number.POSITIVE_INFINITY;
    const bResponse = b.responseTime ?? Number.POSITIVE_INFINITY;
    if (aResponse !== bResponse) return aResponse - bResponse;

    return a.order - b.order;
  });
}

function defaultMigrateSources(
  item: HistoryItem,
  preferredServiceIds: string[] = [],
): MigrateSourceCandidate[] {
  const sources = successfulResults(item)
    .map(({ result, order }) => ({
      serviceId: result.serviceId,
      url: result.result?.url ?? '',
      order,
    }))
    .filter(source => Boolean(source.url));

  const preferred = new Set(preferredServiceIds);
  const allowed = preferred.size > 0
    ? sources.filter(source => preferred.has(source.serviceId))
    : sources;

  return sortSources(allowed, item, preferredServiceIds);
}

/**
 * 补充备份（链接健康、图库）从哪几份下载：检测过且失效的那几份不试，免得「复制时使用」的那份失效时只试它、整张备份失败。
 * 失效按链接健康的口径：检测过、没通过、也不是「可能受限」（跳转 / 防盗链）；尚未检测、旧版本留下的排队中当作可用。
 * 返回空 = 每份都失效（调用方照常尝试，失败时写下载原因）。
 */
export function getBackupSourceIds(item: HistoryItem): string[] {
  return successfulResults(item)
    .map(({ result }) => result.serviceId)
    .filter((serviceId) => {
      const saved = item.linkCheckStatus?.[serviceId];
      if (!saved || saved.errorType === 'pending' || saved.isValid) return true;
      return saved.errorType === 'redirect' || saved.browserMightWork === true;
    });
}

function getRecoverableLinkInfo(
  item: HistoryItem,
  preferredServiceIds: string[] = [],
): RecoverableLinkInfo | null {
  const statuses = item.linkCheckStatus;
  if (!statuses) return null;

  const problemServiceIds: string[] = [];
  const validSources: MigrateSourceCandidate[] = [];

  for (const { result, order } of successfulResults(item)) {
    const status = statuses[result.serviceId];
    if (!status || status.errorType === 'pending') continue;

    if (status.isValid) {
      const url = result.result?.url;
      if (!url) continue;
      validSources.push({
        serviceId: result.serviceId,
        url,
        responseTime: status.responseTime,
        order,
      });
    } else {
      problemServiceIds.push(result.serviceId);
    }
  }

  if (problemServiceIds.length === 0 || validSources.length === 0) return null;

  const sortedSources = sortSources(validSources, item, preferredServiceIds);
  return {
    problemServiceIds,
    validSources: sortedSources,
    preferredSource: sortedSources[0],
  };
}

export function getSourceCandidatesForStatus(
  item: HistoryItem,
  sourceServiceId?: string,
  problemServiceIds?: string[],
  preferredSourceServiceIds: string[] = [],
): MigrateSourceCandidate[] {
  if (problemServiceIds && problemServiceIds.length > 0) {
    const preferred = sourceServiceId ? [sourceServiceId] : [];
    return getRecoverableLinkInfo(item, preferred)?.validSources ?? [];
  }

  const preferred = sourceServiceId
    ? [sourceServiceId, ...preferredSourceServiceIds.filter(id => id !== sourceServiceId)]
    : preferredSourceServiceIds;
  return defaultMigrateSources(item, preferred);
}
