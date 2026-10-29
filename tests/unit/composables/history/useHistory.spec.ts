import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock 依赖 ──────────────────────────────────────────

const {
  historyDBOpenMock,
  historyDBGetFavoriteIdListMock,
  historyDBSetFavoriteMock,
  historyDBBatchSetFavoriteMock,
  historyDBDeleteManyMock,
  historyDBClearMock,
  historyDBGetCountMock,
  historyDBGetServiceCountsMock,
  historyDBGetTimePeriodStatsMock,
  toastShowConfigMock,
  confirmMock,
  detailCacheGetDetailMock,
  detailCacheRemoveDetailMock,
  detailCacheClearCacheMock,
  onCacheEventMock,
  emitHistoryDeletedMock,
  emitHistoryClearedMock,
  toastSuccessMock,
  toastErrorMock,
  undoShowMock,
} = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  undoShowMock: vi.fn(),
  historyDBOpenMock: vi.fn().mockResolvedValue(undefined),
  historyDBGetFavoriteIdListMock: vi.fn().mockResolvedValue([]),
  historyDBSetFavoriteMock: vi.fn().mockResolvedValue(undefined),
  historyDBBatchSetFavoriteMock: vi.fn().mockResolvedValue(undefined),
  // delete 返回「是否真删掉了行」，deleteMany 返回实际删除的 id 列表（默认回显入参 = 全部存在）
  historyDBDeleteManyMock: vi.fn().mockImplementation(async (ids: string[]) => ids),
  historyDBClearMock: vi.fn().mockResolvedValue(undefined),
  historyDBGetCountMock: vi.fn().mockResolvedValue(0),
  historyDBGetServiceCountsMock: vi.fn().mockResolvedValue([]),
  historyDBGetTimePeriodStatsMock: vi.fn().mockResolvedValue([]),
  toastShowConfigMock: vi.fn(),
  confirmMock: vi.fn().mockResolvedValue(true),
  detailCacheGetDetailMock: vi.fn(),
  detailCacheRemoveDetailMock: vi.fn(),
  detailCacheClearCacheMock: vi.fn(),
  onCacheEventMock: vi.fn().mockResolvedValue(vi.fn()),
  emitHistoryDeletedMock: vi.fn().mockResolvedValue(undefined),
  emitHistoryClearedMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/database', () => ({
  historyDB: {
    open: historyDBOpenMock,
    getFavoriteIdList: historyDBGetFavoriteIdListMock,
    setFavorite: historyDBSetFavoriteMock,
    batchSetFavorite: historyDBBatchSetFavoriteMock,
    deleteMany: historyDBDeleteManyMock,
    clear: historyDBClearMock,
    getCount: historyDBGetCountMock,
    getServiceCounts: historyDBGetServiceCountsMock,
    getTimePeriodStats: historyDBGetTimePeriodStatsMock,
    getAllStream: vi.fn(function* () { yield []; }),
  },
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    showConfig: toastShowConfigMock,
    success: toastSuccessMock,
    warn: vi.fn(),
    error: toastErrorMock,
    info: vi.fn(),
  }),
}));

vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: confirmMock }),
}));

vi.mock('@/composables/image/useImageDetailCache', () => ({
  useImageDetailCache: () => ({
    getDetail: detailCacheGetDetailMock,
    removeDetail: detailCacheRemoveDetailMock,
    clearCache: detailCacheClearCacheMock,
  }),
}));

vi.mock('@/composables/useConfig', () => ({
  useConfigManager: () => ({
    config: { value: { weiboProxyMode: 'none' } },
  }),
}));

vi.mock('@/events/cacheEvents', () => ({
  onCacheEvent: onCacheEventMock,
  emitHistoryDeleted: emitHistoryDeletedMock,
  emitHistoryCleared: emitHistoryClearedMock,
}));

vi.mock('@/config/types', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    getActivePrefix: () => null,
  };
});

vi.mock('@/composables/useUndoToast', () => ({
  useUndoToast: () => ({
    show: undoShowMock,
  }),
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/utils/debounce', () => ({
  debounce: (fn: Function) => fn,
}));

vi.mock('@/constants', () => ({
  TOAST_MESSAGES: {
    common: {
      loadFailed: (msg: string) => ({ summary: '加载失败', detail: msg }),
      exportSuccess: (n: number) => ({ summary: '成功', detail: `已导出 ${n} 条` }),
      exportFailed: (msg: string) => ({ summary: '失败', detail: msg }),
      copyFailed: (msg: string) => ({ summary: '失败', detail: msg }),
      noSelection: { summary: '提示', detail: '请先选择记录' },
    },
    history: {
      noLink: () => ({ summary: '提示', detail: '没有可复制的链接' }),
      noLoadableData: { summary: '提示', detail: '无数据' },
      jumpFailed: (msg: string) => ({ summary: '失败', detail: msg }),
    },
    sync: {
      noHistory: { summary: '提示', detail: '没有历史记录' },
    },
  },
}));

// 动态 import（必须在所有 mock 之后）
const { useHistoryManager, invalidateCache } = await import('@/composables/history/useHistory');

// ─── 测试用例 ──────────────────────────────────────────

describe('useHistoryManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    historyDBGetServiceCountsMock.mockResolvedValue([]);
    // 使缓存失效，确保每个测试从干净状态开始
    invalidateCache();
  });

  // ─── loadStats（唯一的模块级数据加载路径） ──────────

  describe('loadStats', () => {
    it('只调用 COUNT / favoriteIdList，不触发全量查询', async () => {
      historyDBGetCountMock.mockResolvedValue(12345);
      historyDBGetFavoriteIdListMock.mockResolvedValue(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
      historyDBGetServiceCountsMock.mockResolvedValue([{ id: 'weibo', count: 12 }]);

      const { loadStats, totalCount, favoriteCount, favoriteSet, serviceCounts } = useHistoryManager();
      await loadStats();

      expect(historyDBGetCountMock).toHaveBeenCalledTimes(1);
      expect(historyDBGetFavoriteIdListMock).toHaveBeenCalledTimes(1);
      expect(historyDBGetServiceCountsMock).toHaveBeenCalledTimes(1);
      expect(totalCount.value).toBe(12345);
      expect(favoriteCount.value).toBe(7);
      expect(serviceCounts.value).toEqual([{ id: 'weibo', count: 12 }]);
      expect(favoriteSet.value.has('a')).toBe(true);
      expect(favoriteSet.value.has('g')).toBe(true);
      expect(favoriteSet.value.size).toBe(7);
    });

    it('缓存有效时跳过重复查询', async () => {
      historyDBGetCountMock.mockResolvedValue(1);
      historyDBGetFavoriteIdListMock.mockResolvedValue([]);

      const { loadStats } = useHistoryManager();
      await loadStats();
      await loadStats();

      expect(historyDBGetCountMock).toHaveBeenCalledTimes(1);
    });

    it('forceReload 忽略缓存', async () => {
      historyDBGetCountMock.mockResolvedValue(1);
      historyDBGetFavoriteIdListMock.mockResolvedValue([]);

      const { loadStats } = useHistoryManager();
      await loadStats();
      await loadStats(true);

      expect(historyDBGetCountMock).toHaveBeenCalledTimes(2);
    });
  });

  // ─── toggleFavorite ────────────────────────────────

  // sharedFavoriteSet 是模块级状态，测试间会有残留。断言采用"相对变化"而非绝对值，
  // 并为每个用例使用独立 id，避免跨 it 冲突。
  describe('toggleFavorite', () => {
    it('乐观更新：收藏后立即反映到 favoriteSet', async () => {
      const { toggleFavorite, favoriteSet, favoriteCount } = useHistoryManager();
      const countBefore = favoriteCount.value;

      const result = await toggleFavorite('toggle-optimistic');

      expect(result).toBe(true); // 从 false → true
      expect(favoriteSet.value.has('toggle-optimistic')).toBe(true);
      expect(favoriteCount.value).toBe(countBefore + 1);
      expect(historyDBSetFavoriteMock).toHaveBeenCalledWith('toggle-optimistic', true);
    });

    it('DB 失败时回滚到原始状态', async () => {
      historyDBSetFavoriteMock.mockRejectedValue(new Error('DB 错误'));

      const { toggleFavorite, favoriteSet, favoriteCount } = useHistoryManager();
      const idsBefore = Array.from(favoriteSet.value).sort();
      const countBefore = favoriteCount.value;

      await expect(toggleFavorite('toggle-rollback')).rejects.toThrow('DB 错误');
      expect(Array.from(favoriteSet.value).sort()).toEqual(idsBefore);
      expect(favoriteCount.value).toBe(countBefore);
    });

    it('防重入：同一 ID 并发调用不重复执行', async () => {
      // setFavorite 延迟返回
      let resolveSetFav!: () => void;
      historyDBSetFavoriteMock.mockReturnValue(new Promise<void>((r) => { resolveSetFav = r; }));

      const { toggleFavorite } = useHistoryManager();

      // 并发调用两次
      const p1 = toggleFavorite('toggle-concurrent');
      const p2 = toggleFavorite('toggle-concurrent');

      resolveSetFav();
      await p1;
      await p2;

      // setFavorite 只被调用一次
      expect(historyDBSetFavoriteMock).toHaveBeenCalledTimes(1);
    });
  });

  // ─── batchSetFavorite ─────────────────────────────

  describe('batchSetFavorite', () => {
    it('批量收藏更新 favoriteSet', async () => {
      const { batchSetFavorite, favoriteSet, favoriteCount } = useHistoryManager();
      const countBefore = favoriteCount.value;
      const ids = ['batch-fav-a', 'batch-fav-b'];

      await batchSetFavorite(ids, true);

      expect(favoriteSet.value.has('batch-fav-a')).toBe(true);
      expect(favoriteSet.value.has('batch-fav-b')).toBe(true);
      expect(favoriteCount.value).toBe(countBefore + 2);
    });

    it('removes ids from favoriteSet when batchSetFavorite is called with false', async () => {
      historyDBGetCountMock.mockResolvedValue(3);
      historyDBGetFavoriteIdListMock.mockResolvedValue(['batch-unfav-a', 'batch-unfav-b', 'still-fav']);

      const { loadStats, batchSetFavorite, favoriteSet, favoriteCount } = useHistoryManager();
      await loadStats();

      await batchSetFavorite(['batch-unfav-a', 'batch-unfav-b'], false);

      expect(historyDBBatchSetFavoriteMock).toHaveBeenCalledWith(['batch-unfav-a', 'batch-unfav-b'], false);
      expect(favoriteSet.value.has('batch-unfav-a')).toBe(false);
      expect(favoriteSet.value.has('batch-unfav-b')).toBe(false);
      expect(favoriteSet.value.has('still-fav')).toBe(true);
      expect(favoriteCount.value).toBe(1);
      expect(detailCacheRemoveDetailMock).toHaveBeenCalledWith('batch-unfav-a');
      expect(detailCacheRemoveDetailMock).toHaveBeenCalledWith('batch-unfav-b');
    });

    it('空数组不执行操作', async () => {
      const { batchSetFavorite } = useHistoryManager();
      await batchSetFavorite([], true);
      expect(historyDBBatchSetFavoriteMock).not.toHaveBeenCalled();
    });
  });

  // ─── clearHistory ─────────────────────────────────

  describe('clearHistory', () => {
    it('确认后清空所有状态', async () => {
      historyDBGetCountMock.mockResolvedValue(3);
      historyDBGetFavoriteIdListMock.mockResolvedValue(['1']);
      confirmMock.mockResolvedValue(true);
      undoShowMock.mockResolvedValue(true);

      const { loadStats, clearHistory, totalCount, favoriteCount, favoriteSet } = useHistoryManager();
      await loadStats();

      await clearHistory();

      expect(historyDBClearMock).toHaveBeenCalled();
      expect(totalCount.value).toBe(0);
      expect(favoriteCount.value).toBe(0);
      expect(favoriteSet.value.size).toBe(0);
      expect(emitHistoryClearedMock).toHaveBeenCalled();
    });

    // 同设置 › 数据与隐私「清空全部记录」那一行的叫法（新界面不叫「历史记录」）；失败写原因 + 处理办法
    it('撤销倒计时、清空后与失败时都说「全部记录」', async () => {
      confirmMock.mockResolvedValue(true);
      undoShowMock.mockResolvedValue(true);
      const { clearHistory } = useHistoryManager();

      await clearHistory();
      expect(undoShowMock).toHaveBeenCalledWith('将清空全部记录', 5, 'warn');
      expect(toastSuccessMock).toHaveBeenCalledWith('已清空全部记录');

      historyDBClearMock.mockRejectedValueOnce(new Error('磁盘已满'));
      await clearHistory();
      expect(toastErrorMock).toHaveBeenCalledWith('未能清空记录', '磁盘已满，请重试');
    });
  });

  // ─── invalidateCache ──────────────────────────────

  describe('invalidateCache', () => {
    it('使缓存失效后下次 loadStats 重新加载', async () => {
      historyDBGetCountMock.mockResolvedValue(0);
      historyDBGetFavoriteIdListMock.mockResolvedValue([]);

      const { loadStats } = useHistoryManager();
      await loadStats();
      invalidateCache();
      await loadStats();

      expect(historyDBGetCountMock).toHaveBeenCalledTimes(2);
    });
  });
});
