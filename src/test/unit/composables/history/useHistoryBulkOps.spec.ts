import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const {
  saveDialogMock,
  writeTextFileMock,
  historyDeleteManyMock,
  toastShowConfigMock,
  confirmMock,
  emitHistoryDeletedMock,
} = vi.hoisted(() => ({
  saveDialogMock: vi.fn(),
  writeTextFileMock: vi.fn(),
  historyDeleteManyMock: vi.fn(),
  toastShowConfigMock: vi.fn(),
  confirmMock: vi.fn(),
  emitHistoryDeletedMock: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: saveDialogMock,
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: writeTextFileMock,
}));

vi.mock('../../../../services/HistoryDatabase', () => ({
  historyDB: {
    deleteMany: historyDeleteManyMock,
  },
}));

vi.mock('../../../../composables/useToast', () => ({
  useToast: () => ({
    showConfig: toastShowConfigMock,
  }),
}));

vi.mock('../../../../composables/useConfirm', () => ({
  useConfirm: () => ({
    confirm: confirmMock,
  }),
}));

vi.mock('../../../../events/cacheEvents', () => ({
  emitHistoryDeleted: emitHistoryDeletedMock,
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { createBulkOps } = await import('../../../../composables/history/useHistoryBulkOps');

function makeCtx() {
  const removedFavoriteBatches: string[][] = [];
  const detailCache = {
    getDetail: vi.fn(),
    removeDetail: vi.fn(),
  };

  return {
    ctx: {
      totalCount: ref(5),
      dataVersion: ref(1),
      detailCache,
      removeFavoritesFromIds: (ids: string[]) => {
        removedFavoriteBatches.push(ids);
      },
    },
    detailCache,
    removedFavoriteBatches,
  };
}

describe('createBulkOps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
    saveDialogMock.mockResolvedValue('/tmp/history.json');
    writeTextFileMock.mockResolvedValue(undefined);
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
    const { ctx, detailCache, removedFavoriteBatches } = makeCtx();
    const { bulkDeleteRecords } = createBulkOps(ctx);

    const result = await bulkDeleteRecords(['a', 'b']);

    expect(result).toBe(true);
    expect(historyDeleteManyMock).toHaveBeenCalledWith(['a', 'b']);
    expect(ctx.totalCount.value).toBe(3);
    expect(ctx.dataVersion.value).toBe(2);
    expect(removedFavoriteBatches).toEqual([['a', 'b']]);
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
    detailCache.getDetail
      .mockResolvedValueOnce({ id: 'a', localFileName: 'a.png' })
      .mockRejectedValueOnce(new Error('missing'))
      .mockResolvedValueOnce({ id: 'c', localFileName: 'c.png' });

    const { bulkExportJSON } = createBulkOps(ctx);
    await bulkExportJSON(['a', 'b', 'c']);

    expect(saveDialogMock).toHaveBeenCalledTimes(1);
    expect(writeTextFileMock).toHaveBeenCalledTimes(1);
    const [, jsonText] = writeTextFileMock.mock.calls[0];
    const parsed = JSON.parse(jsonText as string) as Array<{ id: string }>;
    expect(parsed.map(item => item.id)).toEqual(['a', 'c']);
    expect(toastShowConfigMock).toHaveBeenCalledWith('success', expect.any(Object));
  });

  it('warns instead of exporting when no selected record can be loaded', async () => {
    const { ctx, detailCache } = makeCtx();
    detailCache.getDetail.mockRejectedValue(new Error('missing'));

    const { bulkExportJSON } = createBulkOps(ctx);
    await bulkExportJSON(['a']);

    expect(writeTextFileMock).not.toHaveBeenCalled();
    expect(toastShowConfigMock).toHaveBeenCalledWith('warn', expect.any(Object));
  });
});
