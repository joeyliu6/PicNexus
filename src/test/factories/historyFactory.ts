import type { HistoryItem } from '../../config/types';
import type { UploadResult } from '../../uploaders/base/types';

let historySequence = 0;

export type HistoryResult = HistoryItem['results'][number];
export type LinkCheckStatusEntry = NonNullable<HistoryItem['linkCheckStatus']>[string];

export function resetHistoryFactorySequence(): void {
  historySequence = 0;
}

export function createHistoryUploadResult(
  overrides: Partial<UploadResult> = {},
): UploadResult {
  const serviceId = overrides.serviceId ?? 'jd';
  const fileKey = overrides.fileKey ?? `${serviceId}-key-001`;

  return {
    serviceId,
    fileKey,
    url: overrides.url ?? `https://img.example.com/${fileKey}.jpg`,
    size: overrides.size ?? 2048,
    ...overrides,
  };
}

export function createHistoryResult(
  overrides: Partial<HistoryResult> = {},
): HistoryResult {
  const serviceId = overrides.serviceId ?? overrides.result?.serviceId ?? 'jd';

  return {
    serviceId,
    status: overrides.status ?? 'success',
    result: overrides.result ?? createHistoryUploadResult({ serviceId }),
    error: overrides.error,
  };
}

export function createLinkCheckStatusEntry(
  overrides: Partial<LinkCheckStatusEntry> = {},
): LinkCheckStatusEntry {
  return {
    isValid: overrides.isValid ?? true,
    lastCheckTime: overrides.lastCheckTime ?? 1_700_000_000_000,
    statusCode: overrides.statusCode ?? 200,
    errorType: overrides.errorType ?? 'success',
    responseTime: overrides.responseTime ?? 120,
    error: overrides.error,
    browserMightWork: overrides.browserMightWork,
  };
}

export function createHistoryItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
  historySequence += 1;

  const id = overrides.id ?? `hist-${historySequence}`;
  const primaryService = overrides.primaryService ?? 'jd';
  const results = overrides.results ?? [createHistoryResult({ serviceId: primaryService })];
  const firstSuccess = results.find(result => result.status === 'success' && result.result);
  const generatedLink = overrides.generatedLink ?? firstSuccess?.result?.url ?? '';

  return {
    id,
    timestamp: overrides.timestamp ?? 1_700_000_000_000 + historySequence,
    localFileName: overrides.localFileName ?? `image-${historySequence}.jpg`,
    filePath: overrides.filePath ?? `/mock/images/image-${historySequence}.jpg`,
    primaryService,
    results,
    generatedLink,
    width: overrides.width ?? 1200,
    height: overrides.height ?? 800,
    aspectRatio: overrides.aspectRatio ?? 1.5,
    fileSize: overrides.fileSize ?? 2048,
    format: overrides.format ?? 'jpg',
    isFavorited: overrides.isFavorited,
    favoriteUpdatedAt: overrides.favoriteUpdatedAt,
    favoriteUpdatedBy: overrides.favoriteUpdatedBy,
    linkCheckStatus: overrides.linkCheckStatus,
    linkCheckSummary: overrides.linkCheckSummary,
    migrationSkip: overrides.migrationSkip,
  };
}

export function createHistoryItems(
  count: number,
  overrides:
    | Partial<HistoryItem>
    | ((index: number) => Partial<HistoryItem>) = {},
): HistoryItem[] {
  return Array.from({ length: count }, (_, index) => {
    const itemOverrides = typeof overrides === 'function' ? overrides(index) : overrides;
    return createHistoryItem(itemOverrides);
  });
}

export const createMockHistoryItem = createHistoryItem;
