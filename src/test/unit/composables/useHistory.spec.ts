import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock 依赖 ──────────────────────────────────────────

const {
  historyDBOpenMock,
  historyDBGetMetaListMock,
  historyDBGetFavoriteCountMock,
  historyDBGetPageMock,
  historyDBSearchMock,
  historyDBSetFavoriteMock,
  historyDBBatchSetFavoriteMock,
  historyDBDeleteMock,
  historyDBDeleteManyMock,
  historyDBClearMock,
  historyDBGetCountMock,
  historyDBExportToJSONMock,
  historyDBGetTimePeriodStatsMock,
  toastShowConfigMock,
  confirmMock,
  detailCacheGetDetailMock,
  detailCacheRemoveDetailMock,
  detailCacheClearCacheMock,
  onCacheEventMock,
  emitHistoryDeletedMock,
  emitHistoryClearedMock,
} = vi.hoisted(() => ({
  historyDBOpenMock: vi.fn().mockResolvedValue(undefined),
  historyDBGetMetaListMock: vi.fn().mockResolvedValue([]),
  historyDBGetFavoriteCountMock: vi.fn().mockResolvedValue(0),
  historyDBGetPageMock: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }),
  historyDBSearchMock: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  historyDBSetFavoriteMock: vi.fn().mockResolvedValue(undefined),
  historyDBBatchSetFavoriteMock: vi.fn().mockResolvedValue(undefined),
  historyDBDeleteMock: vi.fn().mockResolvedValue(undefined),
  historyDBDeleteManyMock: vi.fn().mockResolvedValue(undefined),
  historyDBClearMock: vi.fn().mockResolvedValue(undefined),
  historyDBGetCountMock: vi.fn().mockResolvedValue(0),
  historyDBExportToJSONMock: vi.fn().mockResolvedValue('[]'),
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

vi.mock('../../../services/HistoryDatabase', () => ({
  historyDB: {
    open: historyDBOpenMock,
    getMetaList: historyDBGetMetaListMock,
    getFavoriteCount: historyDBGetFavoriteCountMock,
    getPage: historyDBGetPageMock,
    search: historyDBSearchMock,
    setFavorite: historyDBSetFavoriteMock,
    batchSetFavorite: historyDBBatchSetFavoriteMock,
    delete: historyDBDeleteMock,
    deleteMany: historyDBDeleteManyMock,
    clear: historyDBClearMock,
    getCount: historyDBGetCountMock,
    exportToJSON: historyDBExportToJSONMock,
    getTimePeriodStats: historyDBGetTimePeriodStatsMock,
    getAllStream: vi.fn(function* () { yield []; }),
  },
}));

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({
    showConfig: toastShowConfigMock,
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('../../../composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: confirmMock }),
}));

vi.mock('../../../composables/useImageDetailCache', () => ({
  useImageDetailCache: () => ({
    getDetail: detailCacheGetDetailMock,
    removeDetail: detailCacheRemoveDetailMock,
    clearCache: detailCacheClearCacheMock,
  }),
}));

vi.mock('../../../composables/useConfig', () => ({
  useConfigManager: () => ({
    config: { value: { weiboProxyMode: 'none' } },
  }),
}));

vi.mock('../../../events/cacheEvents', () => ({
  onCacheEvent: onCacheEventMock,
  emitHistoryDeleted: emitHistoryDeletedMock,
  emitHistoryCleared: emitHistoryClearedMock,
}));

vi.mock('../../../config/types', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    getActivePrefix: () => null,
  };
});

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../utils/debounce', () => ({
  debounce: (fn: Function) => fn,
}));

vi.mock('../../../constants', () => ({
  TOAST_MESSAGES: {
    common: {
      loadFailed: (msg: string) => ({ summary: '加载失败', detail: msg }),
      deleteSuccess: (n: number) => ({ summary: '成功', detail: `已删除 ${n} 条` }),
      deleteFailed: (msg: string) => ({ summary: '失败', detail: msg }),
      clearSuccess: (msg: string) => ({ summary: '成功', detail: `已清空 ${msg}` }),
      clearFailed: (msg: string) => ({ summary: '失败', detail: msg }),
      exportSuccess: (n: number) => ({ summary: '成功', detail: `已导出 ${n} 条` }),
      exportFailed: (msg: string) => ({ summary: '失败', detail: msg }),
      copySuccess: (n: number) => ({ summary: '成功', detail: `已复制 ${n} 条` }),
      copyFailed: (msg: string) => ({ summary: '失败', detail: msg }),
      noSelection: { summary: '提示', detail: '请先选择记录' },
    },
    history: {
      invalidId: { summary: '错误', detail: '无效 ID' },
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
const { useHistoryManager, invalidateCache } = await import('../../../composables/useHistory');

// ─── 测试用例 ──────────────────────────────────────────

describe('useHistoryManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 使缓存失效，确保每个测试从干净状态开始
    invalidateCache();
  });

  // ─── loadHistory ───────────────────────────────────

  describe('loadHistory', () => {
    it('正常加载历史记录', async () => {
      const mockMetas = [
        { id: '1', timestamp: Date.now(), primaryUrl: 'https://a.com/1.jpg', isFavorited: false },
        { id: '2', timestamp: Date.now(), primaryUrl: 'https://a.com/2.jpg', isFavorited: true },
      ];
      historyDBGetMetaListMock.mockResolvedValue(mockMetas);
      historyDBGetFavoriteCountMock.mockResolvedValue(1);

      const { loadHistory, imageMetas, totalCount, favoriteCount, favoriteSet } = useHistoryManager();
      await loadHistory();

      expect(historyDBOpenMock).toHaveBeenCalled();
      expect(imageMetas.value).toEqual(mockMetas);
      expect(totalCount.value).toBe(2);
      expect(favoriteCount.value).toBe(1);
      expect(favoriteSet.value.has('2')).toBe(true);
      expect(favoriteSet.value.has('1')).toBe(false);
    });

    it('缓存有效时不重复加载', async () => {
      historyDBGetMetaListMock.mockResolvedValue([]);
      historyDBGetFavoriteCountMock.mockResolvedValue(0);

      const { loadHistory } = useHistoryManager();
      await loadHistory(); // 第一次加载
      await loadHistory(); // 第二次应跳过

      // getMetaList 只调用一次
      expect(historyDBGetMetaListMock).toHaveBeenCalledTimes(1);
    });

    it('forceReload 忽略缓存', async () => {
      historyDBGetMetaListMock.mockResolvedValue([]);
      historyDBGetFavoriteCountMock.mockResolvedValue(0);

      const { loadHistory } = useHistoryManager();
      await loadHistory();
      await loadHistory(true); // 强制重新加载

      expect(historyDBGetMetaListMock).toHaveBeenCalledTimes(2);
    });

    it('加载失败时清空数据并显示错误', async () => {
      historyDBGetMetaListMock.mockRejectedValue(new Error('DB 损坏'));

      const { loadHistory, imageMetas } = useHistoryManager();
      await loadHistory();

      expect(imageMetas.value).toEqual([]);
      expect(toastShowConfigMock).toHaveBeenCalledWith('error', expect.any(Object));
    });
  });

  // ─── toggleFavorite ────────────────────────────────

  describe('toggleFavorite', () => {
    it('乐观更新：收藏后立即反映到 favoriteSet', async () => {
      const mockMetas = [
        { id: '1', timestamp: Date.now(), primaryUrl: 'u', isFavorited: false },
      ];
      historyDBGetMetaListMock.mockResolvedValue(mockMetas);
      historyDBGetFavoriteCountMock.mockResolvedValue(0);

      const { loadHistory, toggleFavorite, favoriteSet, favoriteCount } = useHistoryManager();
      await loadHistory();

      const result = await toggleFavorite('1');

      expect(result).toBe(true); // 从 false → true
      expect(favoriteSet.value.has('1')).toBe(true);
      expect(favoriteCount.value).toBe(1);
      expect(historyDBSetFavoriteMock).toHaveBeenCalledWith('1', true);
    });

    it('DB 失败时回滚到原始状态', async () => {
      const mockMetas = [
        { id: '1', timestamp: Date.now(), primaryUrl: 'u', isFavorited: false },
      ];
      historyDBGetMetaListMock.mockResolvedValue(mockMetas);
      historyDBGetFavoriteCountMock.mockResolvedValue(0);
      historyDBSetFavoriteMock.mockRejectedValue(new Error('DB 错误'));

      const { loadHistory, toggleFavorite, favoriteSet, favoriteCount } = useHistoryManager();
      await loadHistory();

      await expect(toggleFavorite('1')).rejects.toThrow('DB 错误');
      expect(favoriteSet.value.has('1')).toBe(false); // 回滚
      expect(favoriteCount.value).toBe(0);
    });

    it('防重入：同一 ID 并发调用不重复执行', async () => {
      const mockMetas = [
        { id: '1', timestamp: Date.now(), primaryUrl: 'u', isFavorited: false },
      ];
      historyDBGetMetaListMock.mockResolvedValue(mockMetas);
      historyDBGetFavoriteCountMock.mockResolvedValue(0);

      // setFavorite 延迟返回
      let resolveSetFav!: () => void;
      historyDBSetFavoriteMock.mockReturnValue(new Promise<void>((r) => { resolveSetFav = r; }));

      const { loadHistory, toggleFavorite } = useHistoryManager();
      await loadHistory();

      // 并发调用两次
      const p1 = toggleFavorite('1');
      const p2 = toggleFavorite('1');

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
      const mockMetas = [
        { id: '1', timestamp: Date.now(), primaryUrl: 'u', isFavorited: false },
        { id: '2', timestamp: Date.now(), primaryUrl: 'u', isFavorited: false },
      ];
      historyDBGetMetaListMock.mockResolvedValue(mockMetas);
      historyDBGetFavoriteCountMock.mockResolvedValue(0);

      const { loadHistory, batchSetFavorite, favoriteSet, favoriteCount } = useHistoryManager();
      await loadHistory();

      await batchSetFavorite(['1', '2'], true);

      expect(favoriteSet.value.has('1')).toBe(true);
      expect(favoriteSet.value.has('2')).toBe(true);
      expect(favoriteCount.value).toBe(2);
    });

    it('空数组不执行操作', async () => {
      const { batchSetFavorite } = useHistoryManager();
      await batchSetFavorite([], true);
      expect(historyDBBatchSetFavoriteMock).not.toHaveBeenCalled();
    });
  });

  // ─── deleteHistoryItem ────────────────────────────

  describe('deleteHistoryItem', () => {
    it('确认后删除并更新状态', async () => {
      const mockMetas = [
        { id: '1', timestamp: Date.now(), primaryUrl: 'u', isFavorited: false },
        { id: '2', timestamp: Date.now(), primaryUrl: 'u', isFavorited: true },
      ];
      historyDBGetMetaListMock.mockResolvedValue(mockMetas);
      historyDBGetFavoriteCountMock.mockResolvedValue(1);
      confirmMock.mockResolvedValue(true);

      const { loadHistory, deleteHistoryItem, imageMetas, totalCount } = useHistoryManager();
      await loadHistory();

      const result = await deleteHistoryItem('1');

      expect(result).toBe(true);
      expect(historyDBDeleteMock).toHaveBeenCalledWith('1');
      expect(imageMetas.value).toHaveLength(1);
      expect(totalCount.value).toBe(1);
      expect(emitHistoryDeletedMock).toHaveBeenCalledWith(['1']);
    });

    it('取消确认不执行删除', async () => {
      confirmMock.mockResolvedValue(false);

      const { deleteHistoryItem } = useHistoryManager();
      const result = await deleteHistoryItem('1');

      expect(result).toBe(false);
      expect(historyDBDeleteMock).not.toHaveBeenCalled();
    });

    it('无效 ID 返回 false', async () => {
      const { deleteHistoryItem } = useHistoryManager();
      const result = await deleteHistoryItem('');

      expect(result).toBe(false);
      expect(toastShowConfigMock).toHaveBeenCalledWith('error', expect.any(Object));
    });
  });

  // ─── clearHistory ─────────────────────────────────

  describe('clearHistory', () => {
    it('确认后清空所有数据', async () => {
      const mockMetas = [
        { id: '1', timestamp: Date.now(), primaryUrl: 'u', isFavorited: false },
      ];
      historyDBGetMetaListMock.mockResolvedValue(mockMetas);
      historyDBGetFavoriteCountMock.mockResolvedValue(0);
      confirmMock.mockResolvedValue(true);

      const { loadHistory, clearHistory, imageMetas, totalCount, favoriteCount } = useHistoryManager();
      await loadHistory();

      await clearHistory();

      expect(historyDBClearMock).toHaveBeenCalled();
      expect(imageMetas.value).toEqual([]);
      expect(totalCount.value).toBe(0);
      expect(favoriteCount.value).toBe(0);
      expect(emitHistoryClearedMock).toHaveBeenCalled();
    });
  });

  // ─── loadPageByNumber ─────────────────────────────

  describe('loadPageByNumber', () => {
    it('传递分页参数给 historyDB', async () => {
      const mockResult = { items: [], total: 50, page: 2, pageSize: 20 };
      historyDBGetPageMock.mockResolvedValue(mockResult);

      const { loadPageByNumber } = useHistoryManager();
      const result = await loadPageByNumber(2, 20, 'weibo' as any);

      expect(historyDBGetPageMock).toHaveBeenCalledWith({
        page: 2,
        pageSize: 20,
        serviceFilter: 'weibo',
      });
      expect(result).toEqual(mockResult);
    });

    it('serviceFilter 为 all 时不传递过滤条件', async () => {
      historyDBGetPageMock.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });

      const { loadPageByNumber } = useHistoryManager();
      await loadPageByNumber(1, 100, 'all');

      expect(historyDBGetPageMock).toHaveBeenCalledWith({
        page: 1,
        pageSize: 100,
        serviceFilter: undefined,
      });
    });
  });

  // ─── searchHistory ────────────────────────────────

  describe('searchHistory', () => {
    it('传递搜索参数给 historyDB', async () => {
      const mockResult = { items: [], total: 0 };
      historyDBSearchMock.mockResolvedValue(mockResult);

      const { searchHistory } = useHistoryManager();
      const result = await searchHistory('test keyword', { limit: 50, offset: 10 });

      expect(historyDBSearchMock).toHaveBeenCalledWith('test keyword', { limit: 50, offset: 10 });
      expect(result).toEqual(mockResult);
    });
  });

  // ─── bulkDeleteRecords ────────────────────────────

  describe('bulkDeleteRecords', () => {
    it('确认后批量删除', async () => {
      const mockMetas = [
        { id: '1', timestamp: Date.now(), primaryUrl: 'u', isFavorited: false },
        { id: '2', timestamp: Date.now(), primaryUrl: 'u', isFavorited: false },
        { id: '3', timestamp: Date.now(), primaryUrl: 'u', isFavorited: false },
      ];
      historyDBGetMetaListMock.mockResolvedValue(mockMetas);
      historyDBGetFavoriteCountMock.mockResolvedValue(0);
      confirmMock.mockResolvedValue(true);

      const { loadHistory, bulkDeleteRecords, imageMetas, totalCount } = useHistoryManager();
      await loadHistory();

      const result = await bulkDeleteRecords(['1', '3']);

      expect(result).toBe(true);
      expect(historyDBDeleteManyMock).toHaveBeenCalledWith(['1', '3']);
      expect(imageMetas.value).toHaveLength(1);
      expect(imageMetas.value[0].id).toBe('2');
      expect(totalCount.value).toBe(1);
    });

    it('空选择返回 false', async () => {
      const { bulkDeleteRecords } = useHistoryManager();
      const result = await bulkDeleteRecords([]);

      expect(result).toBe(false);
      expect(toastShowConfigMock).toHaveBeenCalledWith('warn', expect.any(Object));
    });
  });

  // ─── invalidateCache ──────────────────────────────

  describe('invalidateCache', () => {
    it('使缓存失效后下次 loadHistory 重新加载', async () => {
      historyDBGetMetaListMock.mockResolvedValue([]);
      historyDBGetFavoriteCountMock.mockResolvedValue(0);

      const { loadHistory } = useHistoryManager();
      await loadHistory();
      invalidateCache();
      await loadHistory();

      expect(historyDBGetMetaListMock).toHaveBeenCalledTimes(2);
    });
  });
});
