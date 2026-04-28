import type {
  BatchCheckItemResult,
  BatchCheckProgress,
  BatchCheckResult,
  CheckLinkResult,
  LinkCheckRow,
} from '../../types/linkCheck';
import type { LinkCheckLiteRow } from '../../services/database/types';
import { createHistoryResult } from './historyFactory';

let linkCheckSequence = 0;

export function resetLinkCheckFactorySequence(): void {
  linkCheckSequence = 0;
}
export function createCheckLinkResult(
  overrides: Partial<CheckLinkResult> = {},
): CheckLinkResult {
  const isValid = overrides.is_valid ?? true;

  return {
    link: overrides.link ?? 'https://img.example.com/link-check.jpg',
    is_valid: isValid,
    status_code: overrides.status_code ?? (isValid ? 200 : 404),
    error: overrides.error,
    error_type: overrides.error_type ?? (isValid ? 'success' : 'http_4xx'),
    suggestion: overrides.suggestion,
    response_time: overrides.response_time ?? 120,
    detected_service: overrides.detected_service ?? 'jd',
    browser_might_work: overrides.browser_might_work ?? false,
    content_type: overrides.content_type ?? 'image/jpeg',
    content_length: overrides.content_length ?? 2048,
  };
}

export function createBatchCheckItemResult(
  overrides: Partial<BatchCheckItemResult> = {},
): BatchCheckItemResult {
  return {
    ...createCheckLinkResult(overrides),
    history_id: overrides.history_id,
    service_id: overrides.service_id,
  };
}

export function createLinkCheckRow(overrides: Partial<LinkCheckRow> = {}): LinkCheckRow {
  linkCheckSequence += 1;

  const historyId = overrides.historyId ?? `hist-${linkCheckSequence}`;
  const serviceId = overrides.serviceId ?? 'jd';
  const url = overrides.url ?? `https://img.example.com/${historyId}-${serviceId}.jpg`;

  return {
    historyId,
    serviceId,
    url,
    rawUrl: overrides.rawUrl ?? url,
    fileName: overrides.fileName ?? `image-${linkCheckSequence}.jpg`,
    fallbackUrl: overrides.fallbackUrl,
    checkResult: overrides.checkResult,
    recheckResult: overrides.recheckResult,
    recheckLoading: overrides.recheckLoading,
    recheckBadgeFading: overrides.recheckBadgeFading,
    fadingOut: overrides.fadingOut,
    pinnedSortWeight: overrides.pinnedSortWeight,
    recentlyCompletedAt: overrides.recentlyCompletedAt,
    uncheckedLeavingAt: overrides.uncheckedLeavingAt,
  };
}

export function createLinkCheckRows(
  count: number,
  overrides:
    | Partial<LinkCheckRow>
    | ((index: number) => Partial<LinkCheckRow>) = {},
): LinkCheckRow[] {
  return Array.from({ length: count }, (_, index) => {
    const rowOverrides = typeof overrides === 'function' ? overrides(index) : overrides;
    return createLinkCheckRow(rowOverrides);
  });
}

export function createLinkCheckLiteRow(
  overrides: Partial<LinkCheckLiteRow> = {},
): LinkCheckLiteRow {
  const id = overrides.id ?? 'hist-lite-1';
  const serviceId = 'jd';
  const url = `https://img.example.com/${id}.jpg`;

  return {
    id,
    local_file_name: overrides.local_file_name ?? `${id}.jpg`,
    primary_service: overrides.primary_service ?? serviceId,
    results: overrides.results ?? JSON.stringify([createHistoryResult({
      serviceId,
      result: {
        serviceId,
        fileKey: `${id}-key`,
        url,
        size: 2048,
      },
    })]),
    link_check_status: overrides.link_check_status ?? null,
  };
}

export function createBatchCheckProgress(
  overrides: Partial<BatchCheckProgress> = {},
): BatchCheckProgress {
  return {
    checked: overrides.checked ?? 0,
    total: overrides.total ?? 1,
    current_url: overrides.current_url ?? 'https://img.example.com/current.jpg',
    current_result: overrides.current_result,
    recent_results: overrides.recent_results,
  };
}

export function createBatchCheckResult(
  overrides: Partial<BatchCheckResult> = {},
): BatchCheckResult {
  const results = overrides.results ?? [];

  return {
    results,
    total: overrides.total ?? results.length,
    valid: overrides.valid ?? results.filter(result => result.is_valid).length,
    invalid: overrides.invalid ?? results.filter(result => !result.is_valid).length,
    timeout: overrides.timeout ?? results.filter(result => result.error_type === 'timeout').length,
    suspicious: overrides.suspicious ?? results.filter(result => result.error_type === 'suspicious').length,
    elapsed_ms: overrides.elapsed_ms ?? 100,
    cancelled: overrides.cancelled ?? false,
  };
}
