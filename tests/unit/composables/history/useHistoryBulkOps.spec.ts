import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { getInvokeMock } from '../../helpers/tauriMock';

const {
  historyDeleteManyMock,
  toastShowConfigMock,
  confirmMock,
  emitHistoryDeletedMock,
} = vi.hoisted(() => ({
  historyDeleteManyMock: vi.fn(),
  toastShowConfigMock: vi.fn(),
  confirmMock: vi.fn(),
  emitHistoryDeletedMock: vi.fn(),
}));

const invokeMock = getInvokeMock();

vi.mock('@/services/HistoryDatabase', () => ({
  historyDB: {
    deleteMany: historyDeleteManyMock,
  },
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    showConfig: toastShowConfigMock,
  }),
}));

vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({
    confirm: confirmMock,
  }),
}));

vi.mock('@/events/cacheEvents', () => ({
  emitHistoryDeleted: emitHistoryDeletedMock,
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { createBulkOps } = await import('@/composables/history/useHistoryBulkOps');

function makeCtx() {
  const removedFavoriteBatches: string[][] = [];
  const detailCache = {
    getDetail: vi.fn(),
    getDetails: vi.fn(),
    removeDetail: vi.fn(),
    prefetchDetails: vi.fn(),
    clearCache: vi.fn(),
    cacheStats: ref({ size: 0, maxSize: 200, hitCount: 0, missCount: 0, hitRate: 0 }),
  };
  const refreshServiceCounts = vi.fn().mockResolvedValue(undefined);

  return {
    ctx: {
      totalCount: ref(5),
      dataVersion: ref(1),
      detailCache,
      removeFavoritesFromIds: (ids: string[]) => {
        removedFavoriteBatches.push(ids);
      },
      refreshServiceCounts,
    },
    detailCache,
    removedFavoriteBatches,
    refreshServiceCounts,
  };
}

describe('createBulkOps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
    invokeMock.mockResolvedValue('/tmp/history.json');
    historyDeleteManyMock.mockResolvedValue(undefined);
    emitHistoryDeletedMock.mockResolvedValue(undefined);
  });

  it('returns false and warns when bulkDeleteRecords is called with an empty selection', async () => {
    const { ctx } = makeCtx();
    const { bulkDeleteRecords } = createBulkOps(ctx);

    const result = await bulkDeleteRecords([]);

    expect(result).toBe(false);
    expect(historyDeleteManyMock).not.toHaveBeenCalled();
    expect(toastShowConfigMock).toHaveBeenCalledWith('warn', expect.any(Object));
  });

  it('returns false without deleting anything when the user cancels bulkDeleteRecords', async () => {
    confirmMock.mockResolvedValueOnce(false);
    const { ctx } = makeCtx();
    const { bulkDeleteRecords } = createBulkOps(ctx);

    const result = await bulkDeleteRecords(['a', 'b']);

    expect(result).toBe(false);
    expect(historyDeleteManyMock).not.toHaveBeenCalled();
  });

  it('deletes records, updates counters and clears caches on a successful bulk delete', async () => {
    const { ctx, detailCache, removedFavoriteBatches, refreshServiceCounts } = makeCtx();
    const { bulkDeleteRecords } = createBulkOps(ctx);

    const result = await bulkDeleteRecords(['a', 'b']);

    expect(result).toBe(true);
    expect(historyDeleteManyMock).toHaveBeenCalledWith(['a', 'b']);
    expect(ctx.totalCount.value).toBe(3);
    expect(ctx.dataVersion.value).toBe(2);
    expect(removedFavoriteBatches).toEqual([['a', 'b']]);
    expect(refreshServiceCounts).toHaveBeenCalledTimes(1);
    expect(detailCache.removeDetail).toHaveBeenCalledTimes(2);
    expect(detailCache.removeDetail).toHaveBeenNthCalledWith(1, 'a');
    expect(detailCache.removeDetail).toHaveBeenNthCalledWith(2, 'b');
    expect(emitHistoryDeletedMock).toHaveBeenCalledWith(['a', 'b']);
    expect(toastShowConfigMock).toHaveBeenCalledWith('success', expect.any(Object));
  });

  it('shows an error toast and keeps state unchanged when bulkDeleteRecords fails', async () => {
    historyDeleteManyMock.mockRejectedValueOnce(new Error('db offline'));
    const { ctx } = makeCtx();
    const { bulkDeleteRecords } = createBulkOps(ctx);

    const result = await bulkDeleteRecords(['a']);

    expect(result).toBe(false);
    expect(ctx.totalCount.value).toBe(5);
    expect(ctx.dataVersion.value).toBe(1);
    expect(toastShowConfigMock).toHaveBeenCalledWith('error', expect.any(Object));
  });

  it('exports only the loadable selected items to JSON', async () => {
    const { ctx, detailCache } = makeCtx();
    // 一次批量取回：查不到的记录以 null 占位，保持与入参 ids 等长同序
    detailCache.getDetails.mockResolvedValue([
      { id: 'a', localFileName: 'a.png' },
      null,
      { id: 'c', localFileName: 'c.png' },
    ]);

    const { bulkExportJSON } = createBulkOps(ctx);
    await bulkExportJSON(['a', 'b', 'c']);

    expect(detailCache.getDetails).toHaveBeenCalledTimes(1);
    expect(detailCache.getDetails).toHaveBeenCalledWith(['a', 'b', 'c']);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('export_text_file', expect.objectContaining({
      defaultPath: expect.stringMatching(/^picnexus-history-\d+\.json$/),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    }));
    const [, payload] = invokeMock.mock.calls[0];
    const parsed = JSON.parse((payload as { content: string }).content) as Array<{ id: string }>;
    expect(parsed.map(item => item.id)).toEqual(['a', 'c']);
    expect(toastShowConfigMock).toHaveBeenCalledWith('success', expect.any(Object));
  });

  it('warns instead of exporting when no selected record can be loaded', async () => {
    const { ctx, detailCache } = makeCtx();
    detailCache.getDetails.mockResolvedValue([null]);

    const { bulkExportJSON } = createBulkOps(ctx);
    await bulkExportJSON(['a']);

    expect(invokeMock).not.toHaveBeenCalled();
    expect(toastShowConfigMock).toHaveBeenCalledWith('warn', expect.any(Object));
  });

  // 批量取回整体失败与「记录查不到」是两回事：前者必须报错，
  // 否则用户会拿到一份缺条目的 JSON 而毫无察觉
  it('reports an export failure when the batch detail load throws', async () => {
    const { ctx, detailCache } = makeCtx();
    detailCache.getDetails.mockRejectedValue(new Error('db down'));

    const { bulkExportJSON } = createBulkOps(ctx);
    await bulkExportJSON(['a', 'b']);

    expect(invokeMock).not.toHaveBeenCalled();
    expect(toastShowConfigMock).toHaveBeenCalledWith('error', expect.any(Object));
  });
});
