import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, shallowRef } from 'vue';
import type { HistoryItem } from '../../../../config/types';
import { preloadAllPending } from '../../../../composables/batchMigrate/preloadPending';
import { historyDB } from '../../../../services/HistoryDatabase';

vi.mock('../../../../services/HistoryDatabase', () => ({
  historyDB: {
    getItemsByBackupCount: vi.fn(),
  },
}));

function uploadResult(serviceId: string, url: string) {
  return { serviceId, fileKey: `${serviceId}-key`, url };
}

function makeItem(index: number): HistoryItem {
  return {
    id: `id-${String(index).padStart(3, '0')}`,
    timestamp: 10_000 - index,
    localFileName: `image-${index}.png`,
    primaryService: 'source',
    results: [
      { serviceId: 'source', status: 'success', result: uploadResult('source', `https://img/${index}.png`) },
    ],
    generatedLink: '',
  } as HistoryItem;
}

describe('preloadAllPending', () => {
  beforeEach(() => {
    vi.mocked(historyDB.getItemsByBackupCount).mockReset();
  });

  it('后续分页使用 timestamp/id 游标，避免处理中的记录改变筛选集合后 OFFSET 漏项', async () => {
    const first = Array.from({ length: 100 }, (_, i) => makeItem(i));
    const second = Array.from({ length: 150 }, (_, i) => makeItem(i + 100));
    vi.mocked(historyDB.getItemsByBackupCount)
      .mockResolvedValueOnce({ items: first, total: 250, hasMore: true })
      .mockResolvedValueOnce({ items: second, total: 150, hasMore: false });

    const allItemStatuses = shallowRef([]);
    const batches: unknown[][] = [];
    const result = await preloadAllPending({
      targets: ['r2'],
      maxSuccessCount: 1,
      sourceServiceFilter: ['source'],
      timestampAfter: null,
      allItemStatuses,
      isCancelled: ref(false),
      isPaused: ref(false),
      onBatch: batch => batches.push(batch),
    });

    expect(result).toHaveLength(250);
    expect(batches).toHaveLength(2);
    expect(historyDB.getItemsByBackupCount).toHaveBeenCalledTimes(2);
    expect(vi.mocked(historyDB.getItemsByBackupCount).mock.calls[1][0]).toMatchObject({
      offset: 0,
      cursorTimestamp: first[99].timestamp,
      cursorId: first[99].id,
    });
  });

  it('builds statuses only for targets that are still missing and filters completed items', async () => {
    const needsGithub = makeItem(1);
    needsGithub.results.push({ serviceId: 'r2', status: 'success', result: uploadResult('r2', 'https://r2/1.png') });
    const alreadyComplete = makeItem(2);
    alreadyComplete.results.push(
      { serviceId: 'r2', status: 'success', result: uploadResult('r2', 'https://r2/2.png') },
      { serviceId: 'github', status: 'success', result: uploadResult('github', 'https://github/2.png') },
    );
    vi.mocked(historyDB.getItemsByBackupCount)
      .mockResolvedValueOnce({ items: [needsGithub, alreadyComplete], total: 2, hasMore: false });

    const allItemStatuses = shallowRef([]);
    const result = await preloadAllPending({
      targets: ['r2', 'github'],
      maxSuccessCount: 2,
      sourceServiceFilter: ['source'],
      timestampAfter: 1234,
      allItemStatuses,
      isCancelled: ref(false),
      isPaused: ref(false),
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(needsGithub.id);
    expect(result[0].status.serviceResults).toEqual({ github: 'pending' });
    expect(result[0].status.existingServiceIds).toEqual(expect.arrayContaining(['source', 'r2']));
    expect(allItemStatuses.value).toHaveLength(1);
    expect(historyDB.getItemsByBackupCount).toHaveBeenCalledWith(expect.objectContaining({
      hasServiceId: ['source'],
      timestampAfter: 1234,
    }));
  });

  it('omits source filter when all sources are selected', async () => {
    vi.mocked(historyDB.getItemsByBackupCount)
      .mockResolvedValueOnce({ items: [makeItem(1)], total: 1, hasMore: false });

    await preloadAllPending({
      targets: ['r2'],
      maxSuccessCount: 999,
      sourceServiceFilter: [],
      timestampAfter: null,
      allItemStatuses: shallowRef([]),
      isCancelled: ref(false),
      isPaused: ref(false),
    });

    expect(vi.mocked(historyDB.getItemsByBackupCount).mock.calls[0][0]).toMatchObject({
      maxSuccessCount: 999,
      hasServiceId: undefined,
      timestampAfter: undefined,
    });
  });

  it('stops streaming more pages after cancellation', async () => {
    const first = Array.from({ length: 100 }, (_, i) => makeItem(i));
    vi.mocked(historyDB.getItemsByBackupCount)
      .mockResolvedValueOnce({ items: first, total: 101, hasMore: true });
    const isCancelled = ref(false);

    const result = await preloadAllPending({
      targets: ['r2'],
      maxSuccessCount: 1,
      sourceServiceFilter: ['source'],
      timestampAfter: null,
      allItemStatuses: shallowRef([]),
      isCancelled,
      isPaused: ref(false),
      onBatch: () => { isCancelled.value = true; },
    });

    expect(result).toHaveLength(100);
    expect(historyDB.getItemsByBackupCount).toHaveBeenCalledTimes(1);
  });

  it('does not commit the first page when cancellation happens before the query returns', async () => {
    vi.mocked(historyDB.getItemsByBackupCount)
      .mockResolvedValueOnce({ items: [makeItem(1)], total: 1, hasMore: false });
    const allItemStatuses = shallowRef([]);

    const result = await preloadAllPending({
      targets: ['r2'],
      maxSuccessCount: 1,
      sourceServiceFilter: ['source'],
      timestampAfter: null,
      allItemStatuses,
      isCancelled: ref(true),
      isPaused: ref(false),
    });

    expect(result).toHaveLength(0);
    expect(allItemStatuses.value).toHaveLength(0);
  });
});
