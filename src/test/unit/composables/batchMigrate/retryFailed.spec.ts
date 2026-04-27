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
  migrateOneItem: vi.fn(async (_item, status) => {
    status.status = 'success';
  }),
}));

function makeResult(): MigrateResult {
  return {
    successCount: 0,
    failedCount: 1,
    skippedCount: 0,
    failures: [{
      historyId: 'h1',
      fileName: 'a.png',
      error: 'failed',
      errorType: 'upload',
      details: [{ serviceId: 'github', message: 'bad token' }],
    }],
    partialFailures: [],
    durationMs: 100,
    avgBytesPerSec: 0,
    targetServiceIds: ['r2', 'github'],
    itemsSnapshot: [{
      historyId: 'h1',
      fileName: 'a.png',
      status: 'failed',
      error: 'failed',
      serviceResults: { r2: 'failed', github: 'failed' },
      existingServiceIds: ['source'],
    }],
  };
}

describe('createRetry', () => {
  beforeEach(() => {
    vi.mocked(historyDB.getItemsByIds).mockReset();
    vi.mocked(migrateOneItem).mockClear();
  });

  it('重试时使用过滤后的目标图床，而不是原始迁移快照里的异常图床', async () => {
    vi.mocked(historyDB.getItemsByIds).mockResolvedValue([{
      id: 'h1',
      localFileName: 'a.png',
      results: [{ serviceId: 'source', status: 'success', result: { url: 'https://img/a.png' } }],
    } as any]);

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
});
