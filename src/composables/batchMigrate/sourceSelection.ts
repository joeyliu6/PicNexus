import type { HistoryItem } from '../../config/types';

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
    .filter(({ result }) => result.status === 'success' && Boolean(result.result?.url));
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

export function getDefaultMigrateSource(
  item: HistoryItem,
  preferredServiceIds: string[] = [],
): MigrateSourceCandidate | null {
  return defaultMigrateSources(item, preferredServiceIds)[0] ?? null;
}

export function getRecoverableLinkInfo(
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
