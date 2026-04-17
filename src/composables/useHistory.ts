// 历史记录管理 Composable（单例模式）
// 纯数据层：使用 SQLite 数据库存储，支持大数据量分页和搜索
// v3.0: 视图状态已移至 useHistoryViewState.ts

import { ref, shallowRef, type Ref } from 'vue';
import type { HistoryItem, ServiceType } from '../config/types';
import { historyDB, type PageResult, type SearchResult, type SearchOptions, type TimePeriodStats } from '../services/HistoryDatabase';
import type { ImageMeta } from '../types/image-meta';
import { useImageDetailCache } from './useImageDetailCache';
import { useToast } from './useToast';
import { TOAST_MESSAGES } from '../constants';
import { useConfirm } from './useConfirm';
import { useUndoToast } from './useUndoToast';
import {
  onCacheEvent,
  emitHistoryDeleted,
  emitHistoryCleared,
  type CacheEventPayload,
  type HistoryEventData
} from '../events/cacheEvents';
import { createLogger } from '../utils/logger';
import { debounce } from '../utils/debounce';
import { createBulkOps } from './history/useHistoryBulkOps';

const log = createLogger('History');

// ============================================
// 单例共享状态（模块级别）
// ============================================

// 所有图片元数据（轻量级，全量加载）
const sharedImageMetas: Ref<ImageMeta[]> = shallowRef([]);

// 加载中状态
const sharedIsLoading = ref(false);

// 全量元数据是否已加载（用于缓存判断；metas 由时间轴/收藏视图按需触发）
const isDataLoaded = ref(false);

// 统计数字是否已加载（totalCount / favoriteCount / favoriteSet）
// 表格视图只依赖 stats，不依赖 metas
const isStatsLoaded = ref(false);

// 数据版本号（用于追踪变化）
const dataVersion = ref(0);

// === TTL 缓存相关 ===
const CACHE_TTL = 5 * 60 * 1000;  // 5 分钟 TTL
const lastLoadTime = ref<number>(0);
const lastStatsLoadTime = ref<number>(0);

/**
 * 检查全量 metas 缓存是否有效
 */
function isCacheValid(): boolean {
  if (!isDataLoaded.value) return false;
  if (lastLoadTime.value === 0) return false;
  return Date.now() - lastLoadTime.value < CACHE_TTL;
}

/**
 * 检查统计数据缓存是否有效
 */
function isStatsCacheValid(): boolean {
  if (!isStatsLoaded.value) return false;
  if (lastStatsLoadTime.value === 0) return false;
  return Date.now() - lastStatsLoadTime.value < CACHE_TTL;
}

// === 跨窗口同步 ===
let crossWindowListenerInitialized = false;

// 总数（无需分页）
const totalCount = ref(0);

// 收藏总数
const favoriteCount = ref(0);

// 独立的收藏 ID 集合（解耦收藏状态，避免触发 imageMetas 的全量 reactivity 级联）
const sharedFavoriteSet: Ref<Set<string>> = shallowRef(new Set());

// 收藏 toggle 防重入集合（模块级别单例，确保多个 useHistoryManager 实例共享）
const pendingToggleIds = new Set<string>();

/** 从 favoriteSet 中移除指定 ID，更新计数（公共辅助） */
function removeFavoritesFromIds(ids: string[]): void {
  const newSet = new Set(sharedFavoriteSet.value);
  let removed = 0;
  for (const id of ids) {
    if (newSet.delete(id)) removed++;
  }
  if (removed > 0) {
    sharedFavoriteSet.value = newSet;
    favoriteCount.value = Math.max(0, favoriteCount.value - removed);
  }
}

// 时间段统计（用于时间轴完整显示）
const sharedTimePeriodStats: Ref<TimePeriodStats[]> = shallowRef([]);
const isTimePeriodStatsLoaded = ref(false);

/**
 * 模块级别的数据重新加载函数（用于事件处理）
 *
 * 策略：metas 按需重载 —— 仅当 metas 之前已加载过（时间轴/收藏视图用过）才重新 JSON.parse 全量；
 * 表格视图场景下 metas 从未加载，事件只刷新 stats（COUNT + favoriteIdList），避免风扇狂叫。
 */
async function reloadSharedData(): Promise<void> {
  // 提前捕获：只有重挡会动 sharedIsLoading，轻挡毫秒级 SQL 不占 UI loading 态
  const metasAlreadyLoaded = isDataLoaded.value;
  const needsTimeStats = isTimePeriodStatsLoaded.value;
  try {
    if (metasAlreadyLoaded) sharedIsLoading.value = true;
    await historyDB.open();

    if (metasAlreadyLoaded) {
      // 时间轴/收藏视图之前打开过，必须全量刷新保持一致性
      const [metas, timePeriodStats] = await Promise.all([
        historyDB.getMetaList(),
        historyDB.getTimePeriodStats(),
      ]);
      sharedImageMetas.value = metas;
      totalCount.value = metas.length;
      sharedFavoriteSet.value = new Set(metas.filter(m => m.isFavorited).map(m => m.id));
      favoriteCount.value = sharedFavoriteSet.value.size;
      sharedTimePeriodStats.value = timePeriodStats;
      isTimePeriodStatsLoaded.value = true;
      isDataLoaded.value = true;
      lastLoadTime.value = Date.now();
    } else {
      // 只有表格视图在用，刷 stats 即可（SQL COUNT + id 列表，毫秒级）
      const [total, favIds, timeStats] = await Promise.all([
        historyDB.getCount(),
        historyDB.getFavoriteIdList(),
        needsTimeStats ? historyDB.getTimePeriodStats() : Promise.resolve(null),
      ]);
      totalCount.value = total;
      sharedFavoriteSet.value = new Set(favIds);
      favoriteCount.value = favIds.length;
      if (timeStats) {
        sharedTimePeriodStats.value = timeStats;
      }
    }

    isStatsLoaded.value = true;
    lastStatsLoadTime.value = Date.now();
    dataVersion.value++;
  } catch (error) {
    log.error('[历史记录] 事件触发重新加载失败:', error);
  } finally {
    if (metasAlreadyLoaded) sharedIsLoading.value = false;
  }
}

// debounced 版本：合并短时间内的多次 history-updated 事件，避免并发竞态
const debouncedReloadSharedData = debounce(reloadSharedData, 300);

/**
 * 初始化跨窗口事件监听（单例）
 */
function initCrossWindowListener(): void {
  if (crossWindowListenerInitialized) return;
  crossWindowListenerInitialized = true;

  onCacheEvent((payload: CacheEventPayload) => {
    const data = payload.data as HistoryEventData | undefined;

    switch (payload.type) {
      case 'history-deleted':
        if (data?.ids && data.ids.length > 0) {
          // metas 按需存在：已加载才同步过滤，否则表格视图走 SQL 自然生效
          if (isDataLoaded.value) {
            const deletedSet = new Set(data.ids);
            sharedImageMetas.value = sharedImageMetas.value.filter(
              meta => !deletedSet.has(meta.id)
            );
          }
          removeFavoritesFromIds(data.ids);
          totalCount.value = Math.max(0, totalCount.value - data.ids.length);
          dataVersion.value++;
        }
        break;

      case 'history-cleared':
        // metas=[] + count=0 本身就是一个合法的"已加载的空状态"
        // 保持 isDataLoaded / isStatsLoaded 不变，这样后续 history-updated
        // 事件仍会按正确路径（重挡/轻挡）刷新；否则时间轴/收藏视图的本地
        // hasXxxDataLoaded 闭包标志不会重置，会陷入"totalCount>0 但 metas=[]"的假死状态
        sharedImageMetas.value = [];
        sharedFavoriteSet.value = new Set();
        totalCount.value = 0;
        favoriteCount.value = 0;
        dataVersion.value++;
        break;

      case 'history-updated':
        // 不清零 isDataLoaded/isStatsLoaded：reloadSharedData 内部以此判断"是否曾加载过 metas"
        // 以决定是全量刷新（时间轴/收藏视图场景）还是只刷 stats（表格视图场景）
        // 真正的缓存新鲜度由 reloadSharedData 内部重置 lastLoadTime / lastStatsLoadTime 保证
        debouncedReloadSharedData();
        break;
    }
  }).catch(e => {
    log.warn('[历史记录] 跨窗口监听设置失败:', e);
  });
}

/**
 * 使缓存失效，下次 loadHistory / loadStats 将强制重新加载
 */
export function invalidateCache(): void {
  isDataLoaded.value = false;
  lastLoadTime.value = 0;
  isStatsLoaded.value = false;
  lastStatsLoadTime.value = 0;
}

/**
 * 历史记录管理 Composable（单例模式）
 * 纯数据层：所有组件共享同一份数据
 */
export function useHistoryManager() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const undoToast = useUndoToast();
  const detailCache = useImageDetailCache();

  // 初始化跨窗口事件监听（单例）
  initCrossWindowListener();

  // 使用共享状态（单例）
  const imageMetas = sharedImageMetas;
  const isLoading = sharedIsLoading;

  /**
   * 初始化数据库
   */
  async function initDatabase(): Promise<void> {
    await historyDB.open();
  }

  /**
   * 仅加载统计数字（totalCount、favoriteCount、favoriteSet）
   *
   * 用于表格视图：不触发全量 JSON.parse，仅跑 SQL COUNT + 收藏 ID 列表
   * 毫秒级返回，解决首屏风扇狂叫问题
   *
   * @param forceReload 是否强制重新加载（忽略缓存）
   */
  async function loadStats(forceReload = false): Promise<void> {
    if (isStatsCacheValid() && !forceReload) return;

    try {
      await initDatabase();

      const [total, favIds] = await Promise.all([
        historyDB.getCount(),
        historyDB.getFavoriteIdList(),
      ]);

      totalCount.value = total;
      sharedFavoriteSet.value = new Set(favIds);
      favoriteCount.value = favIds.length;

      isStatsLoaded.value = true;
      lastStatsLoadTime.value = Date.now();
      dataVersion.value++;
    } catch (error) {
      log.error('[历史记录] 加载统计失败:', error);
      toast.showConfig('error', TOAST_MESSAGES.common.loadFailed(String(error)));
    }
  }

  /**
   * 加载历史记录元数据（全量加载）
   *
   * ⚠️ 重量级：3 万条记录约 300-800ms，会触发全量 JSON.parse
   * 仅时间轴视图、收藏视图激活时调用
   *
   * @param forceReload 是否强制重新加载（忽略缓存）
   */
  async function loadHistory(forceReload = false): Promise<void> {
    // 如果缓存有效且不强制刷新，直接返回
    if (isCacheValid() && !forceReload) {
      return;
    }

    try {
      isLoading.value = true;

      await initDatabase();

      // 全量加载元数据 + 收藏计数
      const [metas, favCount] = await Promise.all([
        historyDB.getMetaList(),
        historyDB.getFavoriteCount(),
      ]);

      imageMetas.value = metas;
      totalCount.value = metas.length;
      favoriteCount.value = favCount;
      sharedFavoriteSet.value = new Set(metas.filter(m => m.isFavorited).map(m => m.id));

      isDataLoaded.value = true;
      lastLoadTime.value = Date.now();
      // metas 加载完 stats 也自然最新
      isStatsLoaded.value = true;
      lastStatsLoadTime.value = Date.now();
      dataVersion.value++;

    } catch (error) {
      log.error('[历史记录] 加载失败:', error);
      toast.showConfig('error', TOAST_MESSAGES.common.loadFailed(String(error)));
      imageMetas.value = [];
    } finally {
      isLoading.value = false;
    }
  }


  /**
   * 删除单个历史记录项
   */
  async function deleteHistoryItem(itemId: string): Promise<boolean> {
    try {
      if (!itemId || typeof itemId !== 'string' || itemId.trim().length === 0) {
        log.error('[历史记录] 删除失败: 无效的 itemId:', itemId);
        toast.showConfig('error', TOAST_MESSAGES.history.invalidId);
        return false;
      }

      const confirmed = await confirm(
        '确定要删除这条历史记录吗？此操作不可撤销。',
        { header: '确认删除', acceptLabel: '删除', acceptClass: 'p-button-danger' }
      );

      if (!confirmed) {
        return false;
      }

      await historyDB.delete(itemId);

      toast.showConfig('success', TOAST_MESSAGES.common.deleteSuccess(1));

      // metas 按需：已加载才同步过滤
      if (isDataLoaded.value) {
        imageMetas.value = imageMetas.value.filter(meta => meta.id !== itemId);
      }
      totalCount.value = Math.max(0, totalCount.value - 1);

      removeFavoritesFromIds([itemId]);
      dataVersion.value++;

      // 清除详情缓存
      detailCache.removeDetail(itemId);

      emitHistoryDeleted([itemId]).catch(e => {
        log.warn('[历史记录] 跨窗口通知失败:', e);
      });

      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('[历史记录] 删除失败:', error);
      toast.showConfig('error', TOAST_MESSAGES.common.deleteFailed(errorMsg));
      return false;
    }
  }

  /**
   * 清空所有历史记录
   */
  async function clearHistory(): Promise<void> {
    try {
      const confirmed = await confirm(
        '确定要清空所有上传历史记录吗？确认后有 5 秒可以撤销。',
        { header: '确认清空', acceptLabel: '清空', acceptClass: 'p-button-danger' }
      );

      if (!confirmed) {
        return;
      }

      const proceed = await undoToast.show('将清空所有历史记录', 5);
      if (!proceed) {
        return;
      }

      await historyDB.clear();

      toast.showConfig('success', TOAST_MESSAGES.common.clearSuccess('所有历史记录'));

      // 清空元数据
      imageMetas.value = [];
      totalCount.value = 0;
      favoriteCount.value = 0;
      sharedFavoriteSet.value = new Set();
      dataVersion.value++;

      // 清除详情缓存
      detailCache.clearCache();

      emitHistoryCleared().catch(e => {
        log.warn('[历史记录] 跨窗口通知失败:', e);
      });

    } catch (error) {
      log.error('[历史记录] 清空失败:', error);
      toast.showConfig('error', TOAST_MESSAGES.common.clearFailed(String(error)));
    }
  }

  // 批量操作（导出 JSON / 批量删除）从 useHistoryBulkOps 引入
  const { bulkExportJSON, bulkDeleteRecords } = createBulkOps({
    imageMetas,
    totalCount,
    isDataLoaded,
    dataVersion,
    detailCache,
    removeFavoritesFromIds,
  });

  /**
   * 加载全量历史记录（独立于分页状态）
   * 用于 LinkCheckerView 等需要完整数据的场景
   */
  async function loadAllHistory(): Promise<HistoryItem[]> {
    await initDatabase();

    const allItems: HistoryItem[] = [];
    for await (const batch of historyDB.getAllStream(1000)) {
      allItems.push(...batch);
    }

    return allItems;
  }

  /**
   * 按页码加载数据（用于表格视图服务端分页）
   * 不影响 imageMetas，返回独立的分页结果
   *
   * @param page 页码（从 1 开始）
   * @param pageSize 每页数量（默认 100）
   * @param serviceFilter 图床筛选
   * @returns 分页结果
   */
  async function loadPageByNumber(
    page: number,
    pageSize: number = 100,
    serviceFilter: ServiceType | 'all' = 'all'
  ): Promise<PageResult> {
    await initDatabase();
    const result = await historyDB.getPage({
      page,
      pageSize,
      serviceFilter: serviceFilter === 'all' ? undefined : serviceFilter,
    });
    return result;
  }

  /**
   * 搜索历史记录（支持分页）
   *
   * @param keyword 搜索关键词
   * @param options 搜索选项（serviceFilter、limit、offset）
   * @returns 搜索结果
   */
  async function searchHistory(
    keyword: string,
    options: SearchOptions = {}
  ): Promise<SearchResult> {
    await initDatabase();
    const result = await historyDB.search(keyword, options);
    return result;
  }

  /**
   * 加载时间段统计信息（轻量级，用于时间轴完整显示）
   * 只在首次加载或数据变化时调用
   */
  async function loadTimePeriodStats(): Promise<TimePeriodStats[]> {
    // 如果已加载，直接返回缓存
    if (isTimePeriodStatsLoaded.value && sharedTimePeriodStats.value.length > 0) {
      return sharedTimePeriodStats.value;
    }

    await initDatabase();
    const stats = await historyDB.getTimePeriodStats();
    sharedTimePeriodStats.value = stats;
    isTimePeriodStatsLoaded.value = true;
    return stats;
  }

  /**
   * 跳转到指定月份（验证该月份是否有数据）
   * 在新架构下，所有元数据已加载，此函数仅验证目标月份存在性
   * 实际滚动定位由 TimelineView 负责
   *
   * @param year 年份
   * @param month 月份 (0-11)
   * @returns 是否成功跳转
   */
  async function jumpToMonth(year: number, month: number): Promise<boolean> {
    try {
      isLoading.value = true;

      // 从时间段统计中找到目标月份
      const targetPeriod = sharedTimePeriodStats.value.find(
        p => p.year === year && p.month === month
      );

      if (!targetPeriod) {
        log.warn(`[历史记录] 未找到目标月份: ${year}年${month + 1}月`);
        return false;
      }

      // 如果 metas 已加载（时间轴路径应当如此），再二次验证；否则信任 timePeriodStats
      if (isDataLoaded.value) {
        const hasData = imageMetas.value.some(meta => {
          const date = new Date(meta.timestamp);
          return date.getFullYear() === year && date.getMonth() === month;
        });
        if (!hasData) {
          log.warn(`[历史记录] 目标月份无数据: ${year}年${month + 1}月`);
          return false;
        }
      }
      return true;

    } catch (error) {
      console.error(`[历史记录] 跳转失败:`, error);
      toast.showConfig('error', TOAST_MESSAGES.history.jumpFailed(String(error)));
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 切换单张图片的收藏状态
   * 使用独立的 favoriteSet 避免触发 imageMetas 的全量 reactivity 级联
   */
  async function toggleFavorite(id: string): Promise<boolean> {
    if (pendingToggleIds.has(id)) return sharedFavoriteSet.value.has(id);
    pendingToggleIds.add(id);

    const previousState = sharedFavoriteSet.value.has(id);
    const targetState = !previousState;

    // 乐观更新：只修改 favoriteSet（O(1)），不触碰 imageMetas 数组引用
    const newSet = new Set(sharedFavoriteSet.value);
    if (targetState) newSet.add(id); else newSet.delete(id);
    sharedFavoriteSet.value = newSet;
    favoriteCount.value += targetState ? 1 : -1;

    // 静默同步 meta 对象属性（不替换数组引用，不触发 shallowRef 响应）
    // metas 未加载时（表格视图），favoriteSet 就是唯一真相源
    const metaIndex = isDataLoaded.value ? imageMetas.value.findIndex(m => m.id === id) : -1;
    if (metaIndex >= 0) {
      imageMetas.value[metaIndex].isFavorited = targetState;
    }

    try {
      await historyDB.setFavorite(id, targetState);
      detailCache.removeDetail(id);
      return targetState;
    } catch (error) {
      // 失败时回滚
      const rollbackSet = new Set(sharedFavoriteSet.value);
      if (previousState) rollbackSet.add(id); else rollbackSet.delete(id);
      sharedFavoriteSet.value = rollbackSet;
      favoriteCount.value += previousState ? 1 : -1;
      if (metaIndex >= 0) {
        imageMetas.value[metaIndex].isFavorited = previousState;
      }
      log.error('[历史记录] 切换收藏失败:', error);
      toast.showConfig('error', { summary: '操作失败', detail: String(error) });
      throw error;
    } finally {
      pendingToggleIds.delete(id);
    }
  }

  /**
   * 批量设置收藏状态
   * 使用 favoriteSet 避免 O(n) 遍历 imageMetas
   */
  async function batchSetFavorite(ids: string[], favorited: boolean): Promise<void> {
    if (ids.length === 0) return;

    try {
      await historyDB.batchSetFavorite(ids, favorited);

      // 更新 favoriteSet（O(ids.length)）
      const newSet = new Set(sharedFavoriteSet.value);
      let deltaCount = 0;
      for (const id of ids) {
        const wasFavorited = newSet.has(id);
        if (wasFavorited === favorited) continue;
        deltaCount += favorited ? 1 : -1;
        if (favorited) newSet.add(id); else newSet.delete(id);
      }
      sharedFavoriteSet.value = newSet;
      favoriteCount.value = Math.max(0, favoriteCount.value + deltaCount);

      // 静默同步 meta 对象属性（metas 未加载时跳过，favoriteSet 即真相源）
      if (isDataLoaded.value) {
        const idSet = new Set(ids);
        for (const meta of imageMetas.value) {
          if (idSet.has(meta.id)) meta.isFavorited = favorited;
        }
      }

      ids.forEach(id => detailCache.removeDetail(id));

    } catch (error) {
      log.error('[历史记录] 批量收藏操作失败:', error);
      toast.showConfig('error', { summary: '操作失败', detail: String(error) });
    }
  }

  return {
    // 状态
    imageMetas,  // ← 改为元数据（原 allHistoryItems）
    isLoading,
    isDataLoaded,
    isStatsLoaded,

    // 统计
    totalCount,

    // 时间段统计
    timePeriodStats: sharedTimePeriodStats,

    // 详情缓存
    detailCache,

    // 方法
    loadStats,
    loadHistory,
    loadAllHistory,
    loadPageByNumber,
    searchHistory,
    invalidateCache,
    deleteHistoryItem,
    clearHistory,
    bulkExportJSON,
    bulkDeleteRecords,

    // 时间轴相关
    loadTimePeriodStats,
    jumpToMonth,

    // 收藏
    favoriteCount,
    favoriteSet: sharedFavoriteSet as Readonly<Ref<Set<string>>>,
    toggleFavorite,
    batchSetFavorite,
  };
}

// 导出类型
export type { TimePeriodStats };
