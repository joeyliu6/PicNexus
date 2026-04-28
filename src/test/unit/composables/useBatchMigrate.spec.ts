import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { useBatchMigrateManager } from '../../../composables/useBatchMigrate';
import { historyDB } from '../../../services/HistoryDatabase';
import { configStore } from '../../../store/instances';
import { processBatch } from '../../../composables/batchMigrate/migrateCore';
import { preloadAllPending, type PreloadedItem } from '../../../composables/batchMigrate/preloadPending';
import type { HistoryItem, UserConfig } from '../../../config/types';
import type { MigrateItemStatus } from '../../../types/batchMigrate';

const mocks = vi.hoisted(() => ({
  filterConfiguredServices: vi.fn(),
  processBatch: vi.fn(),
  migrateOneItem: vi.fn(),
  preloadAllPending: vi.fn(),
  configGet: vi.fn(),
  getItemsByBackupCount: vi.fn(),
  getServiceDistribution: vi.fn(),
  getItemsByIds: vi.fn(),
}));

vi.mock('../../../core/MultiServiceUploader', () => ({
  MultiServiceUploader: vi.fn(() => ({
    filterConfiguredServices: mocks.filterConfiguredServices,
  })),
}));

vi.mock('../../../composables/batchMigrate/migrateCore', () => ({
  processBatch: mocks.processBatch,
  migrateOneItem: mocks.migrateOneItem,
}));

vi.mock('../../../composables/batchMigrate/preloadPending', () => ({
  preloadAllPending: mocks.preloadAllPending,
}));

vi.mock('../../../services/HistoryDatabase', () => ({
  historyDB: {
    getItemsByBackupCount: mocks.getItemsByBackupCount,
    getServiceDistribution: mocks.getServiceDistribution,
    getItemsByIds: mocks.getItemsByIds,
  },
}));

vi.mock('../../../store/instances', () => ({
  configStore: {
    get: mocks.configGet,
  },
}));

function createConfig(): UserConfig {
  return {
    availableServices: ['r2', 'github', 'smms'],
    configuredServices: ['r2', 'github'],
  } as unknown as UserConfig;
}

function createHistoryItem(id: string): HistoryItem {
  return {
    id,
    timestamp: Date.now(),
    localFileName: `${id}.png`,
    primaryService: 'source',
    results: [{ serviceId: 'source', status: 'success', result: { url: `https://img/${id}.png` } }],
    generatedLink: '',
  } as HistoryItem;
}

function createStatus(id: string, serviceResults: MigrateItemStatus['serviceResults']): MigrateItemStatus {
  return {
    historyId: id,
    fileName: `${id}.png`,
    sourceUrl: `https://img/${id}.png`,
    status: 'pending',
    serviceResults,
    existingServiceIds: ['source'],
  };
}

function createPreloaded(ids: string[]): PreloadedItem[] {
  return ids.map(id => ({
    id,
    status: createStatus(id, { r2: 'pending', github: 'pending' }),
  }));
}

function mockFilterQueries(total: number, existing: Map<string, number>, distribution: Map<string, number>) {
  mocks.getItemsByBackupCount.mockResolvedValueOnce({ items: [], total, hasMore: false });
  mocks.getServiceDistribution
    .mockResolvedValueOnce(existing)
    .mockResolvedValueOnce(distribution);
}

async function finishColdInit(promise: Promise<void>) {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(400);
  await promise;
  await nextTick();
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for condition');
}

describe('useBatchMigrateManager', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.configGet.mockResolvedValue(createConfig());
    mocks.filterConfiguredServices.mockImplementation((_services: string[], config: UserConfig) =>
      ((config as unknown as { configuredServices: string[] }).configuredServices),
    );
    mocks.getItemsByIds.mockImplementation(async (ids: string[]) => ids.map(createHistoryItem));
    mocks.processBatch.mockImplementation(async (
      _items: HistoryItem[],
      batchStatuses: MigrateItemStatus[],
      _targets: string[],
      _config: UserConfig,
      _multiUploader: unknown,
      _isCancelled: { value: boolean },
      _isPaused: { value: boolean },
      _stats: unknown,
      onItemDone: (status: MigrateItemStatus) => void,
      onTargetSettled?: () => void,
    ) => {
      for (const status of batchStatuses) {
        status.status = 'success';
        for (const target of Object.keys(status.serviceResults)) {
          status.serviceResults[target] = 'success';
          onTargetSettled?.();
        }
        onItemDone(status);
      }
    });
  });

  it('initializes targets, source options, and pending counts from filter queries', async () => {
    vi.useFakeTimers();
    mockFilterQueries(
      5,
      new Map([['r2', 2], ['github', 4]]),
      new Map([['source', 5], ['github', 2]]),
    );
    const manager = useBatchMigrateManager();

    await finishColdInit(manager.initConfiguring());

    expect(configStore.get).toHaveBeenCalledWith('config', expect.anything());
    expect(manager.targetServices.value).toEqual([
      expect.objectContaining({ serviceId: 'r2', isConfigured: true, pendingCount: 3, checked: false }),
      expect.objectContaining({ serviceId: 'github', isConfigured: true, pendingCount: 1, checked: false }),
      expect.objectContaining({ serviceId: 'smms', isConfigured: false, pendingCount: 0, checked: false }),
    ]);
    expect(manager.availableSourceServices.value.map(s => s.id)).toEqual(['source', 'github']);
    expect(manager.sourceServiceFilter.value).toEqual(['source', 'github']);
    expect(manager.isFilterApplied.value).toBe(true);
  });

  it('short-circuits to zero pending when every source is deselected', async () => {
    vi.useFakeTimers();
    mockFilterQueries(
      5,
      new Map([['r2', 2], ['github', 4]]),
      new Map([['source', 5]]),
    );
    const manager = useBatchMigrateManager();
    await finishColdInit(manager.initConfiguring());
    mocks.getItemsByBackupCount.mockClear();
    mocks.getServiceDistribution.mockClear();

    manager.sourceServiceFilter.value = [];
    await manager.applyFilter();

    expect(manager.targetServices.value.filter(s => s.isConfigured).every(s => s.pendingCount === 0)).toBe(true);
    expect(historyDB.getItemsByBackupCount).not.toHaveBeenCalled();
    expect(historyDB.getServiceDistribution).not.toHaveBeenCalled();
  });

  it('applies source, threshold, and timestamp filters to history queries', async () => {
    vi.useFakeTimers();
    mockFilterQueries(
      5,
      new Map([['r2', 2], ['github', 4]]),
      new Map([['source', 5]]),
    );
    const manager = useBatchMigrateManager();
    await finishColdInit(manager.initConfiguring());
    mocks.getItemsByBackupCount.mockClear();
    mocks.getServiceDistribution.mockClear();
    mockFilterQueries(
      3,
      new Map([['r2', 1], ['github', 2]]),
      new Map([['source', 3]]),
    );

    manager.sourceServiceFilter.value = ['source'];
    manager.maxSuccessCount.value = 1;
    manager.timestampAfterMs.value = 1_700_000;
    await manager.applyFilter();

    expect(historyDB.getItemsByBackupCount).toHaveBeenCalledWith(expect.objectContaining({
      maxSuccessCount: 1,
      hasServiceId: ['source'],
      timestampAfter: 1_700_000,
      limit: 1,
      offset: 0,
    }));
    expect(manager.targetServices.value.find(s => s.serviceId === 'r2')?.pendingCount).toBe(2);
  });

  it('does not start migration without a checked configured target', async () => {
    const manager = useBatchMigrateManager();
    manager.targetServices.value = [
      { serviceId: 'r2', displayName: 'R2', isConfigured: true, pendingCount: 2, checked: false },
    ];

    await manager.startMigrate();

    expect(preloadAllPending).not.toHaveBeenCalled();
    expect(processBatch).not.toHaveBeenCalled();
    expect(manager.phase.value).toBe('configuring');
  });

  it('runs migration to success, failed, skipped, partial failure, and final progress states', async () => {
    const preloaded = createPreloaded(['success-one', 'failed-one', 'skipped-one']);
    mocks.preloadAllPending.mockImplementation(async (args) => {
      args.allItemStatuses.value = preloaded.map(item => item.status);
      args.onBatch?.(preloaded);
      return preloaded;
    });
    mocks.processBatch.mockImplementation(async (
      _items: HistoryItem[],
      batchStatuses: MigrateItemStatus[],
      _targets: string[],
      _config: UserConfig,
      _multiUploader: unknown,
      _isCancelled: { value: boolean },
      _isPaused: { value: boolean },
      _stats: unknown,
      onItemDone: (status: MigrateItemStatus) => void,
      onTargetSettled?: () => void,
    ) => {
      batchStatuses[0].status = 'success';
      batchStatuses[0].serviceResults = { r2: 'success', github: 'failed' };
      onTargetSettled?.();
      onItemDone(batchStatuses[0]);

      batchStatuses[1].status = 'failed';
      batchStatuses[1].error = 'upload failed';
      batchStatuses[1].errorType = 'upload';
      batchStatuses[1].failureDetails = [{ serviceId: 'github', message: 'bad token' }];
      batchStatuses[1].serviceResults = { r2: 'failed', github: 'failed' };
      onItemDone(batchStatuses[1]);

      batchStatuses[2].status = 'skipped';
      onItemDone(batchStatuses[2]);
    });
    const manager = useBatchMigrateManager();
    manager.targetServices.value = [
      { serviceId: 'r2', displayName: 'R2', isConfigured: true, pendingCount: 2, checked: true },
      { serviceId: 'github', displayName: 'GitHub', isConfigured: true, pendingCount: 1, checked: true },
    ];
    manager.maxSuccessCount.value = 2;
    manager.sourceServiceFilter.value = ['source'];
    manager.timestampAfterMs.value = 1234;

    await manager.startMigrate();

    expect(preloadAllPending).toHaveBeenCalledWith(expect.objectContaining({
      targets: ['r2', 'github'],
      maxSuccessCount: 2,
      sourceServiceFilter: ['source'],
      timestampAfter: 1234,
    }));
    expect(manager.phase.value).toBe('done');
    expect(manager.migrateResult.value).toEqual(expect.objectContaining({
      successCount: 1,
      failedCount: 1,
      skippedCount: 1,
      targetServiceIds: ['r2', 'github'],
    }));
    expect(manager.migrateResult.value?.failures).toEqual([
      expect.objectContaining({ historyId: 'failed-one', errorType: 'upload' }),
    ]);
    expect(manager.migrateResult.value?.partialFailures).toEqual([
      { fileName: 'success-one.png', failedTargets: ['github'] },
    ]);
    expect(manager.globalProgress.value).toEqual({ current: 3, total: 3, percent: 100 });
    expect(manager.cumulativeCounts.value).toEqual({ success: 1, failed: 1, skipped: 1 });
  });

  it('surfaces preload failure as a done result with preload-error pause reason', async () => {
    mocks.preloadAllPending.mockRejectedValue(new Error('db failed'));
    const manager = useBatchMigrateManager();
    manager.targetServices.value = [
      { serviceId: 'r2', displayName: 'R2', isConfigured: true, pendingCount: 1, checked: true },
    ];

    await manager.startMigrate();

    expect(manager.phase.value).toBe('done');
    expect(manager.migrateResult.value?.pauseReason).toBe('preload-error');
    expect(manager.migrateResult.value?.itemsSnapshot).toEqual([]);
  });

  it('exposes pause, resume, cancelling, and cancelled result states while a batch is in flight', async () => {
    const preloaded = createPreloaded(['slow-one']);
    mocks.preloadAllPending.mockImplementation(async (args) => {
      args.allItemStatuses.value = preloaded.map(item => item.status);
      args.onBatch?.(preloaded);
      return preloaded;
    });
    let releaseBatch!: () => void;
    mocks.processBatch.mockImplementation(async (
      _items: HistoryItem[],
      batchStatuses: MigrateItemStatus[],
      _targets: string[],
      _config: UserConfig,
      _multiUploader: unknown,
      isCancelled: { value: boolean },
      _isPaused: { value: boolean },
      _stats: unknown,
      onItemDone: (status: MigrateItemStatus) => void,
    ) => {
      batchStatuses[0].status = 'downloading';
      await new Promise<void>(resolve => { releaseBatch = resolve; });
      batchStatuses[0].status = isCancelled.value ? 'skipped' : 'success';
      onItemDone(batchStatuses[0]);
    });
    const manager = useBatchMigrateManager();
    manager.targetServices.value = [
      { serviceId: 'r2', displayName: 'R2', isConfigured: true, pendingCount: 1, checked: true },
    ];

    const startPromise = manager.startMigrate();
    await waitUntil(() => mocks.processBatch.mock.calls.length === 1);
    await nextTick();

    manager.pauseMigrate();
    expect(manager.isPaused.value).toBe(true);
    expect(manager.isPausing.value).toBe(true);

    manager.resumeMigrate();
    expect(manager.isPaused.value).toBe(false);

    manager.pauseMigrate();
    manager.cancelMigrate();
    expect(manager.isPaused.value).toBe(false);
    expect(manager.isCancelling.value).toBe(true);

    releaseBatch();
    await startPromise;

    expect(manager.phase.value).toBe('done');
    expect(manager.isCancelling.value).toBe(false);
    expect(manager.migrateResult.value).toEqual(expect.objectContaining({
      skippedCount: 1,
      pauseReason: 'user-cancelled',
    }));
  });
});
