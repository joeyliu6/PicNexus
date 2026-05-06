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

function makePartialResult(): MigrateResult {
  return {
    successCount: 1,
    failedCount: 0,
    skippedCount: 0,
    failures: [{
      historyId: 'h1',
      fileName: 'h1.png',
      error: 'GitHub · bad token',
      errorType: 'upload',
      details: [{ serviceId: 'github', message: 'bad token' }],
      isPartial: true,
      failedTargets: ['github'],
    }],
    partialFailures: [{ historyId: 'h1', fileName: 'h1.png', failedTargets: ['github'] }],
    durationMs: 100,
    avgBytesPerSec: 0,
    targetServiceIds: ['r2', 'github'],
    itemsSnapshot: [{
      historyId: 'h1',
      fileName: 'h1.png',
      status: 'success',
      error: 'GitHub · bad token',
      errorType: 'upload',
      failureDetails: [{ serviceId: 'github', message: 'bad token' }],
      serviceResults: { r2: 'success', github: 'failed' },
      existingServiceIds: ['source'],
    }],
  };
}

function makeMultiPartialResult(): MigrateResult {
  return {
    successCount: 1,
    failedCount: 0,
    skippedCount: 0,
    failures: [{
      historyId: 'h1',
      fileName: 'h1.png',
      error: 'GitHub · bad token；SM.MS · rate limited',
      errorType: 'upload',
      details: [
        { serviceId: 'github', message: 'bad token' },
        { serviceId: 'smms', message: 'rate limited' },
      ],
      isPartial: true,
      failedTargets: ['github', 'smms'],
    }],
    partialFailures: [{ historyId: 'h1', fileName: 'h1.png', failedTargets: ['github', 'smms'] }],
    durationMs: 100,
    avgBytesPerSec: 0,
    targetServiceIds: ['r2', 'github', 'smms'],
    itemsSnapshot: [{
      historyId: 'h1',
      fileName: 'h1.png',
      status: 'success',
      error: 'GitHub · bad token；SM.MS · rate limited',
      errorType: 'upload',
      failureDetails: [
        { serviceId: 'github', message: 'bad token' },
        { serviceId: 'smms', message: 'rate limited' },
      ],
      serviceResults: { r2: 'success', github: 'failed', smms: 'failed' },
      existingServiceIds: ['source'],
    }],
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

  it('retains unattempted targets when retry filters a full failure', async () => {
    vi.mocked(historyDB.getItemsByIds).mockResolvedValue([makeHistoryItem() as any]);
    const migrateResult = ref(makeResult());
    const retry = createRetry({
      migrateResult,
      retryingIds: ref(new Set<string>()),
      getOrCacheConfig: async () => ({} as any),
      getMultiUploader: () => ({} as any),
      getRetryTargets: () => ['r2'],
    });

    await retry.retrySingleFailed('h1');

    expect(migrateResult.value?.successCount).toBe(1);
    expect(migrateResult.value?.failedCount).toBe(0);
    expect(migrateResult.value?.failures).toEqual([
      expect.objectContaining({
        historyId: 'h1',
        isPartial: true,
        failedTargets: ['github'],
      }),
    ]);
    expect(migrateResult.value?.partialFailures).toEqual([
      { historyId: 'h1', fileName: 'h1.png', failedTargets: ['github'] },
    ]);
    expect(migrateResult.value?.itemsSnapshot[0]).toEqual(expect.objectContaining({
      status: 'success',
      serviceResults: { r2: 'success', github: 'failed' },
    }));
  });

  it('preserves recovery source context when retrying a failed item', async () => {
    vi.mocked(historyDB.getItemsByIds).mockResolvedValue([{
      ...makeHistoryItem(),
      results: [
        { serviceId: 'source', status: 'success', result: { url: 'https://dead.example.com/h1.png' } },
        { serviceId: 'r2', status: 'success', result: { url: 'https://r2.example.com/h1.png' } },
      ],
    } as any]);
    const result = makeResult();
    result.itemsSnapshot[0] = {
      ...result.itemsSnapshot[0],
      sourceUrl: 'https://r2.example.com/h1.png',
      sourceServiceId: 'r2',
      problemServiceIds: ['source'],
      existingServiceIds: ['source', 'r2'],
    };
    const retry = createRetry({
      migrateResult: ref(result),
      retryingIds: ref(new Set<string>()),
      getOrCacheConfig: async () => ({} as any),
      getMultiUploader: () => ({} as any),
    });

    await retry.retrySingleFailed('h1');

    const status = vi.mocked(migrateOneItem).mock.calls[0][1];
    expect(status).toEqual(expect.objectContaining({
      sourceUrl: 'https://r2.example.com/h1.png',
      sourceServiceId: 'r2',
      problemServiceIds: ['source'],
      existingServiceIds: ['source', 'r2'],
    }));
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
      details: [
        { serviceId: 'r2', message: 'GitHub | still bad' },
        { serviceId: 'github', message: 'still bad' },
      ],
    }));
    expect(migrateResult.value?.itemsSnapshot[0]).toEqual(expect.objectContaining({
      status: 'failed',
      serviceResults: { r2: 'failed', github: 'failed' },
    }));
  });

  it('turns a full failure into a partial failure when retry succeeds for only some targets', async () => {
    vi.mocked(historyDB.getItemsByIds).mockResolvedValue([makeHistoryItem() as any]);
    vi.mocked(migrateOneItem).mockImplementation(async (_item, status) => {
      status.status = 'success';
      status.serviceResults.r2 = 'success';
      status.serviceResults.github = 'failed';
      status.error = 'GitHub · still bad';
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

    expect(migrateResult.value?.successCount).toBe(1);
    expect(migrateResult.value?.failedCount).toBe(0);
    expect(migrateResult.value?.failures[0]).toEqual(expect.objectContaining({
      isPartial: true,
      failedTargets: ['github'],
    }));
    expect(migrateResult.value?.partialFailures).toEqual([
      { historyId: 'h1', fileName: 'h1.png', failedTargets: ['github'] },
    ]);
    expect(migrateResult.value?.itemsSnapshot[0]).toEqual(expect.objectContaining({
      status: 'success',
      serviceResults: expect.objectContaining({ r2: 'success', github: 'failed' }),
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

  it('retries only failed targets for partial failures without changing success counts', async () => {
    vi.mocked(historyDB.getItemsByIds).mockResolvedValue([makeHistoryItem() as any]);
    vi.mocked(migrateOneItem).mockImplementation(async (_item, status, targets) => {
      expect(targets).toEqual(['github']);
      status.status = 'success';
      status.serviceResults.github = 'success';
    });
    const migrateResult = ref(makePartialResult());
    const retry = createRetry({
      migrateResult,
      retryingIds: ref(new Set<string>()),
      getOrCacheConfig: async () => ({} as any),
      getMultiUploader: () => ({} as any),
    });

    await retry.retrySingleFailed('h1');

    expect(migrateResult.value?.failures).toHaveLength(0);
    expect(migrateResult.value?.partialFailures).toHaveLength(0);
    expect(migrateResult.value?.successCount).toBe(1);
    expect(migrateResult.value?.failedCount).toBe(0);
    expect(migrateResult.value?.itemsSnapshot[0].status).toBe('success');
  });

  it('does not clear a partial failure when its failed target is filtered out', async () => {
    const migrateResult = ref(makePartialResult());
    const retry = createRetry({
      migrateResult,
      retryingIds: ref(new Set<string>()),
      getOrCacheConfig: async () => ({} as any),
      getMultiUploader: () => ({} as any),
      getRetryTargets: () => ['r2'],
    });

    await retry.retrySingleFailed('h1');

    expect(historyDB.getItemsByIds).not.toHaveBeenCalled();
    expect(migrateOneItem).not.toHaveBeenCalled();
    expect(migrateResult.value?.failures).toHaveLength(1);
    expect(migrateResult.value?.partialFailures).toHaveLength(1);
  });

  it('keeps unresolved targets when a partial retry only partly succeeds', async () => {
    vi.mocked(historyDB.getItemsByIds).mockResolvedValue([makeHistoryItem() as any]);
    vi.mocked(migrateOneItem).mockImplementation(async (_item, status, targets) => {
      expect(targets).toEqual(['github', 'smms']);
      status.status = 'success';
      status.serviceResults.github = 'success';
      status.serviceResults.smms = 'failed';
      status.error = 'SM.MS · rate limited';
      status.errorType = 'upload';
      status.failureDetails = [{ serviceId: 'smms', message: 'rate limited' }];
    });
    const migrateResult = ref(makeMultiPartialResult());
    const retry = createRetry({
      migrateResult,
      retryingIds: ref(new Set<string>()),
      getOrCacheConfig: async () => ({} as any),
      getMultiUploader: () => ({} as any),
    });

    await retry.retrySingleFailed('h1');

    expect(migrateResult.value?.failures[0]).toEqual(expect.objectContaining({
      isPartial: true,
      failedTargets: ['smms'],
    }));
    expect(migrateResult.value?.partialFailures).toEqual([
      { historyId: 'h1', fileName: 'h1.png', failedTargets: ['smms'] },
    ]);
    expect(migrateResult.value?.successCount).toBe(1);
    expect(migrateResult.value?.failedCount).toBe(0);
    expect(migrateResult.value?.itemsSnapshot[0].serviceResults).toEqual({
      r2: 'success',
      github: 'success',
      smms: 'failed',
    });
  });

  it('keeps unattempted partial targets when retry target filtering skips them', async () => {
    vi.mocked(historyDB.getItemsByIds).mockResolvedValue([makeHistoryItem() as any]);
    vi.mocked(migrateOneItem).mockImplementation(async (_item, status, targets) => {
      expect(targets).toEqual(['github']);
      status.status = 'success';
      status.serviceResults.github = 'success';
    });
    const migrateResult = ref(makeMultiPartialResult());
    const retry = createRetry({
      migrateResult,
      retryingIds: ref(new Set<string>()),
      getOrCacheConfig: async () => ({} as any),
      getMultiUploader: () => ({} as any),
      getRetryTargets: () => ['github'],
    });

    await retry.retrySingleFailed('h1');

    expect(migrateResult.value?.failures[0]).toEqual(expect.objectContaining({
      isPartial: true,
      failedTargets: ['smms'],
    }));
    expect(migrateResult.value?.partialFailures).toEqual([
      { historyId: 'h1', fileName: 'h1.png', failedTargets: ['smms'] },
    ]);
    expect(migrateResult.value?.itemsSnapshot[0].serviceResults).toEqual({
      r2: 'success',
      github: 'success',
      smms: 'failed',
    });
  });

  it('keeps partial retry targets when retry fails before target upload starts', async () => {
    vi.mocked(historyDB.getItemsByIds).mockResolvedValue([makeHistoryItem() as any]);
    vi.mocked(migrateOneItem).mockImplementation(async (_item, status) => {
      status.status = 'failed';
      status.error = '下载失败';
      status.errorType = 'download';
      status.failureDetails = [{ message: 'network timeout' }];
    });
    const migrateResult = ref(makePartialResult());
    const retry = createRetry({
      migrateResult,
      retryingIds: ref(new Set<string>()),
      getOrCacheConfig: async () => ({} as any),
      getMultiUploader: () => ({} as any),
    });

    await retry.retrySingleFailed('h1');

    expect(migrateResult.value?.failures[0]).toEqual(expect.objectContaining({
      isPartial: true,
      failedTargets: ['github'],
      errorType: 'download',
    }));
    expect(migrateResult.value?.partialFailures[0]).toEqual({
      historyId: 'h1',
      fileName: 'h1.png',
      failedTargets: ['github'],
    });
    expect(migrateResult.value?.itemsSnapshot[0]).toEqual(expect.objectContaining({
      status: 'success',
      serviceResults: expect.objectContaining({ github: 'failed' }),
    }));
    expect(migrateResult.value?.successCount).toBe(1);
    expect(migrateResult.value?.failedCount).toBe(0);
  });
});
