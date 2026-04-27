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

function makeItem(index: number): HistoryItem {
  return {
    id: `id-${String(index).padStart(3, '0')}`,
    timestamp: 10_000 - index,
    localFileName: `image-${index}.png`,
    primaryService: 'source',
    results: [
      { serviceId: 'source', status: 'success', result: { url: `https://img/${index}.png` } },
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
});
