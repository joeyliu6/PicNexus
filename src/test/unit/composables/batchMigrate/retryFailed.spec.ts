import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { createRetry } from '../../../../composables/batchMigrate/retryFailed';
import { historyDB } from '../../../../services/HistoryDatabase';
import { migrateOneItem } from '../../../../composables/batchMigrate/migrateCore';
import type { MigrateResult } from '../../../../types/batchMigrate';

vi.mock('../../../../services/HistoryDatabase', () => ({
  historyDB: {
    getItemsByIds: vi.fn(),
  },
}));

vi.mock('../../../../composables/batchMigrate/migrateCore', () => ({
  migrateOneItem: vi.fn(),
}));

function makeResult(ids = ['h1']): MigrateResult {
  return {
    successCount: 0,
    failedCount: ids.length,
    skippedCount: 0,
    failures: ids.map(id => ({
      historyId: id,
      fileName: `${id}.png`,
      error: 'failed',
      errorType: 'upload' as const,
      details: [{ serviceId: 'github', message: 'bad token' }],
    })),
    partialFailures: [],
    durationMs: 100,
    avgBytesPerSec: 0,
    targetServiceIds: ['r2', 'github'],
    itemsSnapshot: ids.map(id => ({
      historyId: id,
      fileName: `${id}.png`,
      status: 'failed' as const,
      error: 'failed',
      serviceResults: { r2: 'failed' as const, github: 'failed' as const },
      existingServiceIds: ['source'],
    })),
  };
}

function makeHistoryItem(id = 'h1') {
  return {
    id,
    localFileName: `${id}.png`,
    results: [{ serviceId: 'source', status: 'success', result: { url: `https://img/${id}.png` } }],
  };
}

describe('createRetry', () => {
  beforeEach(() => {
    vi.mocked(historyDB.getItemsByIds).mockReset();
    vi.mocked(migrateOneItem).mockReset();
    vi.mocked(migrateOneItem).mockImplementation(async (_item, status) => {
      status.status = 'success';
      status.serviceResults.r2 = 'success';
    });
  });

  it('uses filtered retry targets instead of stale result snapshot targets', async () => {
    vi.mocked(historyDB.getItemsByIds).mockResolvedValue([makeHistoryItem() as any]);

    const retry = createRetry({
      migrateResult: ref(makeResult()),
      retryingIds: ref(new Set()),
      getOrCacheConfig: async () => ({} as any),
      getMultiUploader: () => ({} as any),
      getRetryTargets: () => ['r2'],
    });

    await retry.retrySingleFailed('h1');

    expect(migrateOneItem).toHaveBeenCalledTimes(1);
    expect(vi.mocked(migrateOneItem).mock.calls[0][2]).toEqual(['r2']);
  });

  it('removes a failed row and updates counts after a successful retry', async () => {
    vi.mocked(historyDB.getItemsByIds).mockResolvedValue([makeHistoryItem() as any]);
    const migrateResult = ref(makeResult());
    const retryingIds = ref(new Set<string>());
    const retry = createRetry({
      migrateResult,
      retryingIds,
      getOrCacheConfig: async () => ({} as any),
      getMultiUploader: () => ({} as any),
    });

    await retry.retrySingleFailed('h1');

    expect(migrateResult.value?.failures).toHaveLength(0);
    expect(migrateResult.value?.successCount).toBe(1);
    expect(migrateResult.value?.failedCount).toBe(0);
    expect(migrateResult.value?.itemsSnapshot[0].status).toBe('success');
    expect(retryingIds.value.size).toBe(0);
  });

  it('removes a failed row as skipped when targets are already complete', async () => {
    vi.mocked(historyDB.getItemsByIds).mockResolvedValue([makeHistoryItem() as any]);
    vi.mocked(migrateOneItem).mockImplementation(async (_item, status) => {
      status.status = 'skipped';
    });
    const migrateResult = ref(makeResult());
    const retry = createRetry({
      migrateResult,
      retryingIds: ref(new Set<string>()),
      getOrCacheConfig: async () => ({} as any),
      getMultiUploader: () => ({} as any),
    });

    await retry.retrySingleFailed('h1');

    expect(migrateResult.value?.failures).toHaveLength(0);
    expect(migrateResult.value?.failedCount).toBe(0);
    expect(migrateResult.value?.skippedCount).toBe(1);
    expect(migrateResult.value?.itemsSnapshot[0].status).toBe('skipped');
  });

  it('keeps the failed row and refreshes details when retry fails again', async () => {
    vi.mocked(historyDB.getItemsByIds).mockResolvedValue([makeHistoryItem() as any]);
    vi.mocked(migrateOneItem).mockImplementation(async (_item, status) => {
      status.status = 'failed';
      status.error = 'GitHub | still bad';
      status.errorType = 'upload';
      status.failureDetails = [{ serviceId: 'github', message: 'still bad' }];
    });
    const migrateResult = ref(makeResult());
    const retry = createRetry({
      migrateResult,
      retryingIds: ref(new Set<string>()),
      getOrCacheConfig: async () => ({} as any),
      getMultiUploader: () => ({} as any),
    });

    await retry.retrySingleFailed('h1');

    expect(migrateResult.value?.failedCount).toBe(1);
    expect(migrateResult.value?.successCount).toBe(0);
    expect(migrateResult.value?.failures[0]).toEqual(expect.objectContaining({
      historyId: 'h1',
      error: 'GitHub | still bad',
      details: [{ serviceId: 'github', message: 'still bad' }],
    }));
  });

  it('ignores duplicate or stale retry requests', async () => {
    vi.mocked(historyDB.getItemsByIds).mockResolvedValue([makeHistoryItem() as any]);
    const retry = createRetry({
      migrateResult: ref(makeResult()),
      retryingIds: ref(new Set(['h1'])),
      getOrCacheConfig: async () => ({} as any),
      getMultiUploader: () => ({} as any),
    });

    await retry.retrySingleFailed('h1');
    await retry.retrySingleFailed('missing');

    expect(historyDB.getItemsByIds).not.toHaveBeenCalled();
    expect(migrateOneItem).not.toHaveBeenCalled();
  });

  it('applies concurrent retry updates without losing earlier completions', async () => {
    const ids = ['h1', 'h2', 'h3', 'h4'];
    vi.mocked(historyDB.getItemsByIds).mockImplementation(async ([id]) => [makeHistoryItem(String(id)) as any]);
    vi.mocked(migrateOneItem).mockImplementation(async (_item, status) => {
      await Promise.resolve();
      status.status = 'success';
      status.serviceResults.r2 = 'success';
    });
    const migrateResult = ref(makeResult(ids));
    const retry = createRetry({
      migrateResult,
      retryingIds: ref(new Set<string>()),
      getOrCacheConfig: async () => ({} as any),
      getMultiUploader: () => ({} as any),
    });

    await retry.retryFailed(ids);

    expect(migrateResult.value?.failures).toHaveLength(0);
    expect(migrateResult.value?.successCount).toBe(4);
    expect(migrateResult.value?.failedCount).toBe(0);
    expect(migrateResult.value?.itemsSnapshot.every(item => item.status === 'success')).toBe(true);
  });
});
