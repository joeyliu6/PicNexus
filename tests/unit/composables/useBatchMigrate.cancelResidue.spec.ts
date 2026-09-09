/**
 * 回归测试：取消 / 连续失败自动终止后，done 快照不得残留 pending 条目
 *
 * 缺陷（/scan-bugs 2026-08-24 发现 1；真机复现：取消后 300 条里 200 条凭空消失）：
 * preloadPending 把所有待迁移条目的 status 预置为 pending 入队；主循环在 isCancelled 时
 * 直接 break，cursor 之后从未被 processBatch 取出的条目保持 'pending' 进入 itemsSnapshot
 * → done 态悬挂一堆不可操作的"处理中"条目，统计（success/failed/skipped）与列表条数对不上。
 *
 * 修复：finalizeResult 收尾时把仍为 pending 的条目统一置 'skipped' 并累进 skippedCount，
 * 语义与文档「取消只把在途/未尝试条目转 skipped」对齐。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBatchMigrateManager } from '@/composables/useBatchMigrate';
import { processBatch } from '@/composables/batch-migrate/migrateCore';
import { preloadAllPending, type PreloadedItem } from '@/composables/batch-migrate/preloadPending';
import type { HistoryItem, UserConfig } from '@/config/types';
import type { MigrateItemStatus } from '@/types/batchMigrate';

const mocks = vi.hoisted(() => ({
  filterConfiguredServices: vi.fn(),
  processBatch: vi.fn(),
  migrateOneItem: vi.fn(),
  preloadAllPending: vi.fn(),
  configGet: vi.fn(),
  getItemsByBackupCount: vi.fn(),
  getServiceDistribution: vi.fn(),
  getItemsByIds: vi.fn(),
  invalidateCache: vi.fn(),
  emitHistoryUpdated: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/core/MultiServiceUploader', () => ({
  MultiServiceUploader: vi.fn(() => ({
    filterConfiguredServices: mocks.filterConfiguredServices,
  })),
}));

vi.mock('@/composables/batch-migrate/migrateCore', () => ({
  processBatch: mocks.processBatch,
  migrateOneItem: mocks.migrateOneItem,
}));

vi.mock('@/composables/batch-migrate/preloadPending', () => ({
  preloadAllPending: mocks.preloadAllPending,
}));

vi.mock('@/services/database', () => ({
  historyDB: {
    getItemsByBackupCount: mocks.getItemsByBackupCount,
    getServiceDistribution: mocks.getServiceDistribution,
    getItemsByIds: mocks.getItemsByIds,
  },
}));

vi.mock('@/store/instances', () => ({
  configStore: { get: mocks.configGet },
}));

vi.mock('@/composables/useHistory', () => ({ invalidateCache: mocks.invalidateCache }));
vi.mock('@/events/cacheEvents', () => ({ emitHistoryUpdated: mocks.emitHistoryUpdated }));

function createConfig(): UserConfig {
  return {
    availableServices: ['r2'],
    configuredServices: ['r2'],
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

function createStatus(id: string): MigrateItemStatus {
  return {
    historyId: id,
    fileName: `${id}.png`,
    sourceUrl: `https://img/${id}.png`,
    status: 'pending',
    serviceResults: { r2: 'pending' },
    existingServiceIds: ['source'],
  };
}

function createPreloaded(ids: string[]): PreloadedItem[] {
  return ids.map(id => ({ id, status: createStatus(id) }));
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for condition');
}

describe('cancel 后队列未处理条目', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.configGet.mockResolvedValue(createConfig());
    mocks.filterConfiguredServices.mockImplementation((_services: string[], config: UserConfig) =>
      ((config as unknown as { configuredServices: string[] }).configuredServices),
    );
    mocks.getItemsByIds.mockImplementation(async (ids: string[]) => ids.map(createHistoryItem));
  });

  it('300 条迁移到中途取消：done 快照无 pending 残留，统计与列表自洽', async () => {
    const ids = Array.from({ length: 300 }, (_, i) => `id-${i}`);
    const preloaded = createPreloaded(ids);
    mocks.preloadAllPending.mockImplementation(async (args) => {
      args.allItemStatuses.value = preloaded.map(item => item.status);
      args.onBatch?.(preloaded); // 全量入队（对应预加载流式推入）
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
      // 第 1 个 chunk 挂起，模拟在途；取消后再落定
      await new Promise<void>(resolve => { releaseBatch = resolve; });
      for (const status of batchStatuses) {
        status.status = isCancelled.value ? 'skipped' : 'success';
        status.serviceResults = { r2: isCancelled.value ? 'failed' : 'success' };
        onItemDone(status);
      }
    });

    const manager = useBatchMigrateManager();
    manager.targetServices.value = [
      { serviceId: 'r2', displayName: 'R2', isConfigured: true, pendingCount: 300, backedUpCount: 0, checked: true },
    ];
    manager.sourceServiceFilter.value = ['source'];

    const startPromise = manager.startMigrate();
    await waitUntil(() => mocks.processBatch.mock.calls.length >= 1);
    manager.cancelMigrate();
    releaseBatch();
    await startPromise;

    const snapshot = manager.migrateResult.value?.itemsSnapshot ?? [];
    const byStatus = snapshot.reduce<Record<string, number>>((acc, s) => {
      acc[s.status] = (acc[s.status] ?? 0) + 1;
      return acc;
    }, {});

    // 核心断言：done 快照不得残留 pending
    expect(byStatus.pending ?? 0).toBe(0);
    // 统计与列表自洽：未处理条目都归为 skipped
    expect(manager.migrateResult.value?.skippedCount).toBe(snapshot.length);
    expect(manager.migrateResult.value?.successCount! + manager.migrateResult.value?.failedCount! + manager.migrateResult.value?.skippedCount!)
      .toBe(snapshot.length);
  });
});

void processBatch;
void preloadAllPending;