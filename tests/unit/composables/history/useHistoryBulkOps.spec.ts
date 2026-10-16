import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { HistoryItem } from '@/config/types';
import { getInvokeMock } from '../../helpers/tauriMock';
import { createHistoryItem } from '../../factories/historyFactory';

const {
  historyDeleteManyMock,
  historyInsertOrIgnoreMock,
  toastShowConfigMock,
  toastErrorMock,
  confirmMock,
  emitHistoryDeletedMock,
  emitHistoryUpdatedMock,
} = vi.hoisted(() => ({
  historyDeleteManyMock: vi.fn(),
  historyInsertOrIgnoreMock: vi.fn(),
  toastShowConfigMock: vi.fn(),
  toastErrorMock: vi.fn(),
  confirmMock: vi.fn(),
  emitHistoryDeletedMock: vi.fn(),
  emitHistoryUpdatedMock: vi.fn(),
}));

const invokeMock = getInvokeMock();

vi.mock('@/services/database', () => ({
  historyDB: {
    deleteMany: historyDeleteManyMock,
    insertOrIgnore: historyInsertOrIgnoreMock,
  },
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    showConfig: toastShowConfigMock,
    error: toastErrorMock,
  }),
}));

vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({
    confirm: confirmMock,
  }),
}));

vi.mock('@/events/cacheEvents', () => ({
  emitHistoryDeleted: emitHistoryDeletedMock,
  emitHistoryUpdated: emitHistoryUpdatedMock,
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
  const refreshTimePeriodStats = vi.fn().mockResolvedValue(undefined);

  return {
    ctx: {
      totalCount: ref(5),
      dataVersion: ref(1),
      detailCache,
      removeFavoritesFromIds: (ids: string[]) => {
        removedFavoriteBatches.push(ids);
      },
      refreshServiceCounts,
      refreshTimePeriodStats,
    },
    detailCache,
    removedFavoriteBatches,
    refreshServiceCounts,
    refreshTimePeriodStats,
  };
}

describe('createBulkOps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
    invokeMock.mockResolvedValue('/tmp/history.json');
    // deleteMany 返回实际删除的 id 列表（默认回显入参 = 全部存在）
    historyDeleteManyMock.mockImplementation(async (ids: string[]) => ids);
    emitHistoryDeletedMock.mockResolvedValue(undefined);
    historyInsertOrIgnoreMock.mockResolvedValue(undefined);
    emitHistoryUpdatedMock.mockResolvedValue(undefined);
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
    const { ctx, detailCache, removedFavoriteBatches, refreshServiceCounts, refreshTimePeriodStats } = makeCtx();
    const { bulkDeleteRecords } = createBulkOps(ctx);

    const result = await bulkDeleteRecords(['a', 'b']);

    expect(result).toBe(true);
    expect(historyDeleteManyMock).toHaveBeenCalledWith(['a', 'b']);
    expect(ctx.totalCount.value).toBe(3);
    expect(ctx.dataVersion.value).toBe(2);
    expect(removedFavoriteBatches).toEqual([['a', 'b']]);
    expect(refreshServiceCounts).toHaveBeenCalledTimes(1);
    expect(refreshTimePeriodStats).toHaveBeenCalledTimes(1);
    expect(detailCache.removeDetail).toHaveBeenCalledTimes(2);
    expect(detailCache.removeDetail).toHaveBeenNthCalledWith(1, 'a');
    expect(detailCache.removeDetail).toHaveBeenNthCalledWith(2, 'b');
    expect(emitHistoryDeletedMock).toHaveBeenCalledWith(['a', 'b']);
    expect(toastShowConfigMock).toHaveBeenCalledWith('success', expect.any(Object));
  });

  // 陈旧目标（记录已被别处删掉）：toast 报实际条数、只广播真删掉的 id，
  // 否则其他窗口会按虚报的 ids 重复扣减计数
  it('reports only actually deleted rows when some targets are stale', async () => {
    historyDeleteManyMock.mockResolvedValueOnce(['a']);
    const { ctx, detailCache, removedFavoriteBatches } = makeCtx();
    const { bulkDeleteRecords } = createBulkOps(ctx);

    const result = await bulkDeleteRecords(['a', 'ghost']);

    expect(result).toBe(true);
    expect(ctx.totalCount.value).toBe(4);
    expect(removedFavoriteBatches).toEqual([['a']]);
    expect(emitHistoryDeletedMock).toHaveBeenCalledWith(['a']);
    expect(toastShowConfigMock).toHaveBeenCalledWith('success', expect.any(Object));
    // 详情缓存对陈旧目标一样要清：那条记录已不在库里
    expect(detailCache.removeDetail).toHaveBeenCalledWith('ghost');
  });

  it('stays silent when every target is stale: no toast, no broadcast, counters untouched', async () => {
    historyDeleteManyMock.mockResolvedValueOnce([]);
    const { ctx } = makeCtx();
    const { bulkDeleteRecords } = createBulkOps(ctx);

    const result = await bulkDeleteRecords(['ghost-1', 'ghost-2']);

    expect(result).toBe(true);
    expect(ctx.totalCount.value).toBe(5);
    expect(ctx.dataVersion.value).toBe(1);
    expect(emitHistoryDeletedMock).not.toHaveBeenCalled();
    expect(toastShowConfigMock).not.toHaveBeenCalledWith('success', expect.any(Object));
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

  // 同一个 id 每次拿到同一条（工厂按序号生成时间戳，现造两次会不相等）
  const records = new Map<string, HistoryItem>();
  const record = (id: string): HistoryItem => {
    if (!records.has(id)) records.set(id, createHistoryItem({ id, localFileName: `${id}.png`, isFavorited: true }));
    return records.get(id)!;
  };

  it('does nothing when removeRecords is called with an empty selection', async () => {
    const { ctx, detailCache } = makeCtx();
    const { removeRecords } = createBulkOps(ctx);

    expect(await removeRecords([])).toEqual([]);
    expect(detailCache.getDetails).not.toHaveBeenCalled();
    expect(historyDeleteManyMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  // 「移除记录」不弹确认、不报成功（反馈是图库那条带「撤销」的通知）；删之前留好整条记录给撤销用
  it('removes records without asking, updates counters and hands back full records for undo', async () => {
    const { ctx, detailCache, removedFavoriteBatches, refreshServiceCounts, refreshTimePeriodStats } = makeCtx();
    detailCache.getDetails.mockResolvedValue([record('a'), record('b')]);
    const { removeRecords } = createBulkOps(ctx);

    const removed = await removeRecords(['a', 'b']);

    expect(removed).toEqual([record('a'), record('b')]);
    expect(detailCache.getDetails.mock.invocationCallOrder[0]).toBeLessThan(historyDeleteManyMock.mock.invocationCallOrder[0]);
    expect(historyDeleteManyMock).toHaveBeenCalledWith(['a', 'b']);
    expect(ctx.totalCount.value).toBe(3);
    expect(ctx.dataVersion.value).toBe(2);
    expect(removedFavoriteBatches).toEqual([['a', 'b']]);
    expect(refreshServiceCounts).toHaveBeenCalledTimes(1);
    expect(refreshTimePeriodStats).toHaveBeenCalledTimes(1);
    expect(detailCache.removeDetail).toHaveBeenCalledWith('a');
    expect(detailCache.removeDetail).toHaveBeenCalledWith('b');
    expect(emitHistoryDeletedMock).toHaveBeenCalledWith(['a', 'b']);
    expect(toastShowConfigMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  // 陈旧目标（记录已被别处删掉，详情缓存里还留着旧的一份）：只扣真删掉的、只广播真删掉的 id，
  // 否则其他窗口会重复扣减；撤销也只插回真删掉的那些
  it('counts, broadcasts and hands back only the rows that were actually deleted', async () => {
    historyDeleteManyMock.mockResolvedValueOnce(['a']);
    const { ctx, detailCache, removedFavoriteBatches } = makeCtx();
    detailCache.getDetails.mockResolvedValue([record('a'), record('ghost')]);
    const { removeRecords } = createBulkOps(ctx);

    const removed = await removeRecords(['a', 'ghost']);

    expect(removed).toEqual([record('a')]);
    expect(ctx.totalCount.value).toBe(4);
    expect(removedFavoriteBatches).toEqual([['a']]);
    expect(emitHistoryDeletedMock).toHaveBeenCalledWith(['a']);
    // 详情缓存对陈旧目标一样要清：那条记录已不在库里
    expect(detailCache.removeDetail).toHaveBeenCalledWith('ghost');
  });

  it('stays silent when every target is stale: no broadcast, counters untouched', async () => {
    historyDeleteManyMock.mockResolvedValueOnce([]);
    const { ctx, detailCache } = makeCtx();
    detailCache.getDetails.mockResolvedValue([null, null]);
    const { removeRecords } = createBulkOps(ctx);

    expect(await removeRecords(['ghost-1', 'ghost-2'])).toEqual([]);
    expect(ctx.totalCount.value).toBe(5);
    expect(ctx.dataVersion.value).toBe(1);
    expect(emitHistoryDeletedMock).not.toHaveBeenCalled();
  });

  it('says why removing failed and what to do, and keeps state unchanged', async () => {
    historyDeleteManyMock.mockRejectedValueOnce(new Error('db offline'));
    const { ctx, detailCache } = makeCtx();
    detailCache.getDetails.mockResolvedValue([record('a')]);
    const { removeRecords } = createBulkOps(ctx);

    expect(await removeRecords(['a'])).toEqual([]);
    expect(ctx.totalCount.value).toBe(5);
    expect(ctx.dataVersion.value).toBe(1);
    expect(toastErrorMock).toHaveBeenCalledWith('移除记录失败', 'db offline，请稍后重试');
  });

  // 撤销：整条原样插回（含收藏），再广播 history-updated，计数和各视图跟着重查
  it('restores removed records as they were and announces the update', async () => {
    const { ctx } = makeCtx();
    const { restoreRecords } = createBulkOps(ctx);

    await restoreRecords([record('a'), record('b')]);

    expect(historyInsertOrIgnoreMock).toHaveBeenNthCalledWith(1, record('a'));
    expect(historyInsertOrIgnoreMock).toHaveBeenNthCalledWith(2, record('b'));
    expect(emitHistoryUpdatedMock).toHaveBeenCalledWith(['a', 'b']);
  });

  it('says why restoring failed when the database refuses', async () => {
    historyInsertOrIgnoreMock.mockRejectedValueOnce(new Error('disk full'));
    const { ctx } = makeCtx();
    const { restoreRecords } = createBulkOps(ctx);

    await restoreRecords([record('a')]);

    expect(emitHistoryUpdatedMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('恢复记录失败', 'disk full，请稍后重试');
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
