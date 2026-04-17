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
import { onCacheEventType } from '../../events/cacheEvents';
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
  /** 已加载天的平均行高采样值（供 useTimelineLayout skeleton 估算） */
  avgCellHeight: Ref<number>;
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
  // 初始值 = targetRowHeight(200) + gap(4) + headerHeight(48)/avgGroupSize(≈10) ≈ 209
  const avgCellHeight = ref(209);
  const isLoadingStats = ref(false);
  const isDayLoading = ref(false);
  const hasLoadedStats = ref(false);

  let statsVersion = 0;
  let dayLoadVersion = 0;

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

  async function ensureDaysLoaded(dayKeys: string[]): Promise<void> {
    const needed = dayKeys.filter(k => !loadedDayKeys.value.has(k));
    if (needed.length === 0) return;

    // 找对应 dayStats 条目，获取时间戳范围
    const statsIndex = new Map(dayStats.value.map(d => [`${d.year}-${d.month}-${d.day}`, d]));
    const neededStats = needed.map(k => statsIndex.get(k)).filter((s): s is DayStats => !!s);
    if (neededStats.length === 0) return;

    const startTs = Math.min(...neededStats.map(s => s.minTimestamp));
    const endTs = Math.max(...neededStats.map(s => s.maxTimestamp));

    const version = ++dayLoadVersion;
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
      const newLoaded = new Set(loadedDayKeys.value);
      for (const [key, bucket] of buckets) {
        dayMetaCache.set(key, bucket);
        newLoaded.add(key);
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
      if (version === dayLoadVersion) isDayLoading.value = false;
    }
  }

  function invalidateDay(dayKey: string): void {
    dayMetaCache.delete(dayKey);
    const next = new Set(loadedDayKeys.value);
    next.delete(dayKey);
    loadedDayKeys.value = next;
  }

  async function reloadAll(): Promise<void> {
    dayLoadVersion++;
    dayMetaCache.clear();
    loadedDayKeys.value = new Set();
    await loadDayStats();
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
  watch([filter, searchTerm, favoritesOnly], () => {
    if (!hasLoadedStats.value) return;
    dayLoadVersion++;
    dayMetaCache.clear();
    loadedDayKeys.value = new Set();
    void loadDayStats();
  });

  // visible 首次变 true → 触发首次加载
  watch(visible, (v) => {
    if (v && !hasLoadedStats.value) void loadDayStats();
  }, { immediate: true });

  // 历史记录变更事件 → 全量重置
  const unlistens: Array<() => void> = [];
  Promise.all([
    onCacheEventType('history-updated', () => { void reloadAll(); }),
    onCacheEventType('history-deleted', () => { void reloadAll(); }),
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
    avgCellHeight,
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
