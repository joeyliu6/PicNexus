/**
 * useTimelineDayPagination - 时间轴按日按需加载
 *
 * 替代 sharedImageMetas 全量路径，专为时间轴设计：
 * 1. 首屏只拉 getDayStats（<50ms），生成骨架 groups
 * 2. 滚动可见时 ensureDaysLoaded 合并查询 getItemsByDayRange（按天）
 * 3. filter/search/favoritesOnly 变化时重置并重载
 */

import {
  ref, shallowRef, computed, watch, onUnmounted,
  type Ref, type ComputedRef, type ShallowRef,
} from 'vue';
import { historyDB, type DayStats, type DayStatsFilter } from '../../services/HistoryDatabase';
import { onCacheEventType, type HistoryEventData } from '../../events/cacheEvents';
import { createLogger } from '../../utils/logger';
import type { ImageMeta } from '../../types/image-meta';
import type { ServiceType } from '../../config/types';
import type { PhotoGroup } from './types';

const log = createLogger('DayPagination');

/** 从毫秒时间戳提取 dayKey（month 0-11，与 DayStats 一致） */
function tsToDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** 格式化日期为中文标签 */
function formatDayLabel(year: number, month: number, day: number): string {
  return new Date(year, month, day).toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

export interface UseTimelineDayPaginationParams {
  filter: Ref<ServiceType | 'all'>;
  searchTerm: Ref<string>;
  favoritesOnly: Ref<boolean>;
  visible: Ref<boolean>;
}

export interface UseTimelineDayPaginationReturn {
  dayStats: ShallowRef<DayStats[]>;
  /** 日级 meta 缓存（非响应式 Map，由 loadedDayKeys 驱动 groups 重算） */
  dayMetaCache: Map<string, ImageMeta[]>;
  /** 已成功加载的 dayKey 集合（响应式，触发 groups computed） */
  loadedDayKeys: Ref<Set<string>>;
  /** 由 dayStats + dayMetaCache 派生的完整 groups（含骨架天） */
  groups: ComputedRef<PhotoGroup[]>;
  /** dayStats 的 count 总和 */
  totalCount: ComputedRef<number>;
  isLoadingStats: Ref<boolean>;
  isDayLoading: Ref<boolean>;
  hasLoadedStats: Ref<boolean>;

  loadDayStats(): Promise<void>;
  /** 合并查询 dayKeys 对应的 metas，不重复加载 */
  ensureDaysLoaded(dayKeys: string[]): Promise<void>;
  /** 使某天失效（单条变更后调用，下次 ensureDaysLoaded 会重新加载） */
  invalidateDay(dayKey: string): void;
  /** 清空所有缓存并重载 dayStats（history-updated/cleared 时调用） */
  reloadAll(): Promise<void>;
  /** dayStats 降序中比 dayKey 更早的那天的 key（灯箱 prev 跨日） */
  findDayBefore(dayKey: string): string | null;
  /** dayStats 降序中比 dayKey 更新的那天的 key（灯箱 next 跨日） */
  findDayAfter(dayKey: string): string | null;
}

export function useTimelineDayPagination(
  params: UseTimelineDayPaginationParams,
): UseTimelineDayPaginationReturn {
  const { filter, searchTerm, favoritesOnly, visible } = params;

  const dayStats = shallowRef<DayStats[]>([]);
  const dayMetaCache = new Map<string, ImageMeta[]>();
  const loadedDayKeys = ref(new Set<string>());
  const isLoadingStats = ref(false);
  const isDayLoading = ref(false);
  const hasLoadedStats = ref(false);

  let statsVersion = 0;
  let dayLoadVersion = 0;
  // 在途 ensureDaysLoaded 计数：仅当归 0 时 isDayLoading 才置 false
  let inflightDayCount = 0;

  const totalCount = computed(() => dayStats.value.reduce((sum, d) => sum + d.count, 0));

  const groups = computed<PhotoGroup[]>(() => {
    const loaded = loadedDayKeys.value; // 作为响应依赖
    return dayStats.value.map(stat => {
      const dayKey = `${stat.year}-${stat.month}-${stat.day}`;
      return {
        id: dayKey,
        label: formatDayLabel(stat.year, stat.month, stat.day),
        year: stat.year,
        month: stat.month,
        day: stat.day,
        date: new Date(stat.year, stat.month, stat.day),
        items: dayMetaCache.get(dayKey) ?? [],
        expectedCount: stat.count,
        isSkeleton: !loaded.has(dayKey),
      };
    });
  });

  function buildFilter(): DayStatsFilter {
    return {
      serviceFilter: filter.value,
      searchTerm: searchTerm.value,
      favoritesOnly: favoritesOnly.value,
    };
  }

  async function loadDayStats(): Promise<void> {
    const version = ++statsVersion;
    isLoadingStats.value = true;
    try {
      const result = await historyDB.getDayStats(buildFilter());
      if (version !== statsVersion) return;
      dayStats.value = result;
      hasLoadedStats.value = true;
      log.debug(`dayStats 加载完成: ${result.length} 天`);
    } catch (e) {
      if (version === statsVersion) log.error('loadDayStats 失败:', e);
    } finally {
      if (version === statsVersion) isLoadingStats.value = false;
    }
  }

  // microtask batcher：同一 tick 内多个 ensureDaysLoaded 调用合并成一次 DB 查询
  // + 一次 loadedDayKeys 更新，避免连续多次 layout 重算
  let pendingKeys: Set<string> | null = null;
  let pendingPromise: Promise<void> | null = null;

  async function ensureDaysLoaded(dayKeys: string[]): Promise<void> {
    if (pendingKeys) {
      dayKeys.forEach(k => pendingKeys!.add(k));
      return pendingPromise!;
    }
    pendingKeys = new Set(dayKeys);
    pendingPromise = (async () => {
      await Promise.resolve();
      const keysToLoad = Array.from(pendingKeys!);
      pendingKeys = null;
      pendingPromise = null;
      return ensureDaysLoadedImpl(keysToLoad);
    })();
    return pendingPromise;
  }

  async function ensureDaysLoadedImpl(dayKeys: string[]): Promise<void> {
    const needed = dayKeys.filter(k => !loadedDayKeys.value.has(k));
    if (needed.length === 0) return;

    // 找对应 dayStats 条目，获取时间戳范围
    const statsIndex = new Map(dayStats.value.map(d => [`${d.year}-${d.month}-${d.day}`, d]));
    const neededStats = needed.map(k => statsIndex.get(k)).filter((s): s is DayStats => !!s);
    if (neededStats.length === 0) return;

    const startTs = Math.min(...neededStats.map(s => s.minTimestamp));
    const endTs = Math.max(...neededStats.map(s => s.maxTimestamp));
    const neededSet = new Set(needed);

    // 只读快照：仅 filter 变化 / reloadAll 才递增 dayLoadVersion。
    // 不自增版本号，使快速滚动/跳转并发的多个 ensureDaysLoaded 结果都能回填，
    // 避免"前一次请求被后一次作废 → 对应天长时间卡骨架屏"。
    const version = dayLoadVersion;
    inflightDayCount++;
    isDayLoading.value = true;
    try {
      const items = await historyDB.getItemsByDayRange(startTs, endTs, buildFilter());
      if (version !== dayLoadVersion) return;

      // 按 dayKey 分桶
      const buckets = new Map<string, ImageMeta[]>();
      for (const item of items) {
        const key = tsToDayKey(item.timestamp);
        const arr = buckets.get(key);
        if (arr) arr.push(item);
        else buckets.set(key, [item]);
      }

      // 回填 cache + 标记 loaded
      // 范围合并查询可能带回"已加载但不在本次 needed 中"的天，不能覆盖它们的现有缓存
      // （否则会干扰 removeItemsByIds 的增量删除结果、并引起数组引用抖动）
      const newLoaded = new Set(loadedDayKeys.value);
      for (const [key, bucket] of buckets) {
        if (neededSet.has(key) || !newLoaded.has(key)) {
          dayMetaCache.set(key, bucket);
          newLoaded.add(key);
        }
      }
      // 查询范围内没有结果的 needed keys 也标记为已加载（filter 后为空，不需要重复查）
      for (const key of needed) {
        if (!buckets.has(key)) dayMetaCache.set(key, []);
        newLoaded.add(key);
      }
      loadedDayKeys.value = newLoaded; // 触发 groups 重算

      log.debug(`加载 ${needed.length} 天完成，共 ${items.length} 条`);
    } catch (e) {
      if (version === dayLoadVersion) log.error('ensureDaysLoaded 失败:', e);
    } finally {
      inflightDayCount--;
      if (inflightDayCount === 0) isDayLoading.value = false;
    }
  }

  function invalidateDay(dayKey: string): void {
    dayMetaCache.delete(dayKey);
    const next = new Set(loadedDayKeys.value);
    next.delete(dayKey);
    loadedDayKeys.value = next;
  }

  /**
   * 按 id 从本地缓存增量移除（删除事件走这里，不走 reloadAll）
   * - 从 dayMetaCache 每个桶过滤掉对应 id
   * - 递减 dayStats 对应天的 count；count≤0 的天从 dayStats 移除并清理内存
   * - 不清空 loadedDayKeys，其他天保持已加载态，不触发骨架屏闪烁
   */
  function removeItemsByIds(ids: string[]): void {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const affectedDays = new Map<string, number>();
    let matchedCount = 0;

    for (const [dayKey, bucket] of dayMetaCache) {
      const before = bucket.length;
      const after = bucket.filter(m => !idSet.has(m.id));
      if (after.length !== before) {
        dayMetaCache.set(dayKey, after);
        const removed = before - after.length;
        affectedDays.set(dayKey, removed);
        matchedCount += removed;
      }
    }

    // 只要有 id 没在缓存命中就兜底 reloadAll；否则未加载天的 dayStats.count 会失真
    if (matchedCount < ids.length) {
      log.debug(`removeItemsByIds: 仅命中 ${matchedCount}/${ids.length}，走 reloadAll 兜底`);
      void reloadAll();
      return;
    }

    // 递减 count，count≤0 的天从 dayStats 移除并清缓存
    const nextLoaded = new Set(loadedDayKeys.value);
    dayStats.value = dayStats.value
      .map(s => {
        const key = `${s.year}-${s.month}-${s.day}`;
        const removed = affectedDays.get(key);
        return removed ? { ...s, count: s.count - removed } : s;
      })
      .filter(s => {
        if (s.count > 0) return true;
        const key = `${s.year}-${s.month}-${s.day}`;
        dayMetaCache.delete(key);
        nextLoaded.delete(key);
        return false;
      });

    // 触发 groups 重算（即使 loadedDayKeys 集合内容不变，也需新 Set 引用来激活响应式）
    loadedDayKeys.value = nextLoaded;
    log.debug(`removeItemsByIds: 增量删除完成，影响 ${affectedDays.size} 天`);
  }

  /**
   * 全量重载 dayStats，同时尽量保留已加载天的 items 缓存
   * 保留条件：新 dayStats 里存在 + count 未变。count 变了说明该天有新增/删除，
   * 必须降级回 skeleton 让 ensureDaysLoaded 重新拉取 items，否则新增项对用户不可见。
   */
  async function reloadAll(): Promise<void> {
    dayLoadVersion++;
    const oldCountByKey = new Map<string, number>();
    for (const s of dayStats.value) {
      oldCountByKey.set(`${s.year}-${s.month}-${s.day}`, s.count);
    }
    const staleLoaded = loadedDayKeys.value;

    await loadDayStats();

    // 遍历新 dayStats：只有已加载且 count 未变的天才保留，count 变了必须降级回 skeleton 重拉
    const kept = new Set<string>();
    for (const s of dayStats.value) {
      const key = `${s.year}-${s.month}-${s.day}`;
      if (staleLoaded.has(key) && oldCountByKey.get(key) === s.count) {
        kept.add(key);
      }
    }
    for (const key of [...dayMetaCache.keys()]) {
      if (!kept.has(key)) dayMetaCache.delete(key);
    }
    loadedDayKeys.value = kept;
  }

  /**
   * dayStats 按降序排列（最新在前）。
   * "dayBefore" = 时间更早 = index 更大
   */
  function findDayBefore(dayKey: string): string | null {
    const stats = dayStats.value;
    const idx = stats.findIndex(d => `${d.year}-${d.month}-${d.day}` === dayKey);
    if (idx === -1 || idx >= stats.length - 1) return null;
    const d = stats[idx + 1];
    return `${d.year}-${d.month}-${d.day}`;
  }

  /**
   * "dayAfter" = 时间更新 = index 更小
   */
  function findDayAfter(dayKey: string): string | null {
    const stats = dayStats.value;
    const idx = stats.findIndex(d => `${d.year}-${d.month}-${d.day}` === dayKey);
    if (idx <= 0) return null;
    const d = stats[idx - 1];
    return `${d.year}-${d.month}-${d.day}`;
  }

  // filter 三件套变化 → 重置 cache + 重载 dayStats
  // 不守卫 hasLoadedStats：首次加载在途时若用户切 filter，应让新 filter 赢得竞态，
  // loadDayStats 内部的 statsVersion 会自动作废在途的旧请求
  watch([filter, searchTerm, favoritesOnly], () => {
    dayLoadVersion++;
    dayMetaCache.clear();
    loadedDayKeys.value = new Set();
    void loadDayStats();
  });

  // visible 首次变 true → 触发首次加载
  watch(visible, (v) => {
    if (v && !hasLoadedStats.value) void loadDayStats();
  }, { immediate: true });

  // 历史记录变更事件
  // - updated（新增/重试）：走 reloadAll，新 day 会以 skeleton 进入；已加载天保留不闪
  // - deleted：能命中缓存走增量，命中不到兜底 reloadAll
  // - cleared：reloadAll
  const unlistens: Array<() => void> = [];
  Promise.all([
    onCacheEventType('history-updated', () => { void reloadAll(); }),
    onCacheEventType<HistoryEventData>('history-deleted', (data) => {
      if (data?.ids && data.ids.length > 0) removeItemsByIds(data.ids);
      else void reloadAll();
    }),
    onCacheEventType('history-cleared', () => { void reloadAll(); }),
  ])
    .then(fns => unlistens.push(...fns))
    .catch(e => log.warn('事件订阅失败:', e));

  onUnmounted(() => {
    for (const fn of unlistens) fn();
    unlistens.length = 0;
    dayMetaCache.clear();
  });

  return {
    dayStats,
    dayMetaCache,
    loadedDayKeys,
    groups,
    totalCount,
    isLoadingStats,
    isDayLoading,
    hasLoadedStats,
    loadDayStats,
    ensureDaysLoaded,
    invalidateDay,
    reloadAll,
    findDayBefore,
    findDayAfter,
  };
}
