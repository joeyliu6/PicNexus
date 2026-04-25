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
import type { AspectRatioRow } from '../../services/database/TimelineQueryService';
import { onCacheEventType, type HistoryEventData } from '../../events/cacheEvents';
import { createLogger } from '../../utils/logger';
import { getDayKey } from '../../utils/formatters';
import type { ImageMeta } from '../../types/image-meta';
import type { ServiceType } from '../../config/types';
import type { PhotoGroup } from './types';

const log = createLogger('DayPagination');

/**
 * 全量预取阈值：照片总数超过此值时跳过 getAllAspectRatios 全量查询，
 * 回落到懒加载（跳转时按 ±2 月 prefetchDayAspectRatios）降级模式。
 *
 * 20 万张对应 ~7MB 内存 + ~1-2s 查询，是"全量预取"方案的性价比拐点。
 * 超过此阈值后精准骨架的预取成本 > 收益，懒加载代价（200-500ms/跳）可接受。
 */
const MAX_PRELOAD_THRESHOLD = 200_000;

/** 懒加载降级模式下的 LRU 容量上限（约 40KB × 20 张 = 7MB 封顶） */
const MAX_ASPECT_RATIOS_CACHE = 200;

/** 从毫秒时间戳提取 dayKey（month 0-11，与 DayStats 一致），统一来源 utils/formatters */
const tsToDayKey = getDayKey;

/**
 * 格式化日期为中文标签（带 memoization）
 *
 * 为什么必须 memo：groups computed 每次重算都会遍历 3485 天全量 map，
 * `toLocaleDateString('zh-CN', ...)` 每次 ~65μs，3485 次 ≈ 220ms，
 * 会阻塞主线程 ~220ms，导致跳转期间视口黑屏、骨架延迟显示。
 * label 是纯函数（(y,m,d) → string），永不过期，永久缓存即可。
 */
const dayLabelCache = new Map<string, string>();
function formatDayLabel(year: number, month: number, day: number): string {
  const key = `${year}-${month}-${day}`;
  let label = dayLabelCache.get(key);
  if (label === undefined) {
    label = new Date(year, month, day).toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    dayLabelCache.set(key, label);
  }
  return label;
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
  /** 全量 aspectRatios 是否已预取完成（规模防护降级模式下恒为 false） */
  isFullyPreloaded: Ref<boolean>;

  loadDayStats(): Promise<void>;
  /** 合并查询 dayKeys 对应的 metas，不重复加载 */
  ensureDaysLoaded(dayKeys: string[]): Promise<void>;
  /** 预取指定 dayKeys 的 aspectRatios（降级模式或 isFullyPreloaded=false 时使用） */
  prefetchDayAspectRatios(dayKeys: string[]): Promise<void>;
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
  // v7：全量 aspectRatios 缓存，dayKey → 按 (timestamp DESC, id DESC) 排序的 AspectRatioRow[]
  // - 正常模式：timeline 挂载时 getAllAspectRatios 一次性填满，永不淘汰
  // - 降级模式（totalCount > MAX_PRELOAD_THRESHOLD）：按需 prefetchDayAspectRatios 填充 + LRU 淘汰
  // - id 字段用于增量删除按 id 精确移除
  const dayAspectRatiosCache = new Map<string, AspectRatioRow[]>();
  // 每个 bucket 对应的 number[] 视图，按 bucket 引用弱映射。bucket 被替换时自动 GC。
  const aspectNumbersView = new WeakMap<AspectRatioRow[], number[]>();
  // aspectRatios cache 版本号：filter 变化时自增，在途 prefetch/preload 结果若 version 失配直接丢弃
  let aspectRatiosVersion = 0;
  const loadedDayKeys = ref(new Set<string>());
  // aspectRatios cache 的响应式"变更信号"：cache 更新后递增，用于 groups computed 重新透传 aspectRatios
  const aspectRatiosRevision = ref(0);
  const isLoadingStats = ref(false);
  const isDayLoading = ref(false);
  const hasLoadedStats = ref(false);
  // 全量预取完成标志：true 时 handleJumpToPeriod 可跳过 prefetch 等待直接落点
  // false = 两种情形：① preload 进行中 ② 超阈值降级永不预取（外部无需区分,跳转逻辑都走 v6 路径）
  const isFullyPreloaded = ref(false);

  let statsVersion = 0;
  let dayLoadVersion = 0;
  // 在途 ensureDaysLoaded 计数：仅当归 0 时 isDayLoading 才置 false
  let inflightDayCount = 0;

  const totalCount = computed(() => dayStats.value.reduce((sum, d) => sum + d.count, 0));

  // groups computed 里 stable 字段（id/label/year/month/day/date/expectedCount）
  // 在 dayStats 不变时就是同一份数据；但 groups 会被 loadedDayKeys / aspectRatiosRevision 触发频繁重算。
  // 全量重建 3485 天 × (new Date + toLocaleDateString + 字符串拼接) ≈ 数百 ms，阻塞主线程导致跳转黑屏。
  // 用单 Map 缓存这些 stable 字段，dayStats 的 (year,month,day) 不变即可复用。
  interface GroupStableFields {
    id: string;
    label: string;
    year: number;
    month: number;
    day: number;
    date: Date;
    expectedCount: number;
    aspectRatioSum: number;
  }
  const groupStableCache = new Map<string, GroupStableFields>();

  const groups = computed<PhotoGroup[]>(() => {
    const loaded = loadedDayKeys.value; // 作为响应依赖
    // 建立对 aspectRatiosRevision 的响应依赖：prefetchDayAspectRatios 递增时 groups 重算，透传新命中的 aspectRatios
    void aspectRatiosRevision.value;
    return dayStats.value.map(stat => {
      const dayKey = `${stat.year}-${stat.month}-${stat.day}`;
      let stable = groupStableCache.get(dayKey);
      if (!stable || stable.expectedCount !== stat.count || stable.aspectRatioSum !== stat.aspectRatioSum) {
        stable = {
          id: dayKey,
          label: formatDayLabel(stat.year, stat.month, stat.day),
          year: stat.year,
          month: stat.month,
          day: stat.day,
          date: new Date(stat.year, stat.month, stat.day),
          expectedCount: stat.count,
          aspectRatioSum: stat.aspectRatioSum,
        };
        groupStableCache.set(dayKey, stable);
      }
      const isSkeleton = !loaded.has(dayKey);
      // 仅 skeleton 天透传 aspectRatios；通过 WeakMap 视图避免每次 groups 重算都 .map 一次
      const cached = isSkeleton ? dayAspectRatiosCache.get(dayKey) : undefined;
      let aspectRatios: number[] | undefined;
      if (cached) {
        aspectRatios = aspectNumbersView.get(cached);
        if (!aspectRatios) {
          aspectRatios = cached.map(r => r.aspectRatio);
          aspectNumbersView.set(cached, aspectRatios);
        }
      }
      return {
        id: stable.id,
        label: stable.label,
        year: stable.year,
        month: stable.month,
        day: stable.day,
        date: stable.date,
        expectedCount: stable.expectedCount,
        aspectRatioSum: stable.aspectRatioSum,
        items: dayMetaCache.get(dayKey) ?? [],
        isSkeleton,
        aspectRatios,
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

  /**
   * v7：timeline 挂载时并行加载 dayStats + 全量 aspectRatios
   *
   * 流程：
   * 1. 先查 dayStats（轻量聚合，<200ms），拿到 totalCount
   * 2. totalCount ≤ MAX_PRELOAD_THRESHOLD → 顺序拉 getAllAspectRatios 填满 cache
   *    （两个查询不真正并行，避免超阈值时浪费 SQL 成本；但两个 SQL 都是短查询，感知无差异）
   * 3. totalCount > MAX_PRELOAD_THRESHOLD → 打 log.warn，进入降级模式，跳转走懒加载
   *
   * 之所以顺序而非并行：超阈值用户（>20万张）如果并行查完整 aspectRatios 会浪费 3-10 秒 SQL
   * 时间 + 内存，然后整批丢弃。顺序让这批用户直接跳过全量查询。
   */
  async function loadDayStats(): Promise<void> {
    const version = ++statsVersion;
    const aspectVersion = aspectRatiosVersion;
    isLoadingStats.value = true;
    isFullyPreloaded.value = false;
    try {
      const result = await historyDB.getDayStats(buildFilter());
      if (version !== statsVersion) return;
      dayStats.value = result;
      hasLoadedStats.value = true;
      log.debug(`dayStats 加载完成: ${result.length} 天`);

      const totalCount = result.reduce((sum, d) => sum + d.count, 0);
      if (totalCount > MAX_PRELOAD_THRESHOLD) {
        log.warn(
          `照片总数 ${totalCount} 超过全量预取阈值 ${MAX_PRELOAD_THRESHOLD},`
          + `切换懒加载降级模式（跳转时走 ±2 月 prefetch）`,
        );
        return;
      }

      // 全量 aspectRatios 预取（20 万以内 < 2s，HDD 可能略慢但 overlay 全程遮盖）
      const t0 = performance.now();
      const rows = await historyDB.getAllAspectRatios(buildFilter());
      if (version !== statsVersion || aspectVersion !== aspectRatiosVersion) return;

      populateFullAspectCache(rows);
      isFullyPreloaded.value = true;
      aspectRatiosRevision.value++;
      log.info(`aspectRatios 全量预取: ${rows.length} 条,耗时 ${(performance.now() - t0).toFixed(1)}ms`);
    } catch (e) {
      if (version === statsVersion) log.error('loadDayStats 失败:', e);
    } finally {
      if (version === statsVersion) isLoadingStats.value = false;
    }
  }

  /** 把 getAllAspectRatios 返回的扁平 rows 按 dayKey 分桶写入 cache（内部顺序保留 timestamp DESC, id DESC） */
  function populateFullAspectCache(rows: AspectRatioRow[]): void {
    dayAspectRatiosCache.clear();
    for (const r of rows) {
      const key = tsToDayKey(r.timestamp);
      const bucket = dayAspectRatiosCache.get(key);
      if (bucket) bucket.push(r);
      else dayAspectRatiosCache.set(key, [r]);
    }
  }

  /**
   * 按需预取 aspectRatios（懒加载降级模式下 handleJumpToPeriod 调用）。
   *
   * v7 行为：
   * - isFullyPreloaded=true（正常模式）→ **no-op**，cache 已全量命中
   * - isFullyPreloaded=false 且 isPreloadDowngraded=true（>20 万张）→ LRU 预取 + 淘汰
   * - isPreloadDowngraded=false 但 isFullyPreloaded 还没到 true（首屏 preload 进行中）→ LRU 兜底
   */
  async function prefetchDayAspectRatios(dayKeys: string[]): Promise<void> {
    if (isFullyPreloaded.value) return; // 全量 cache 已就绪,no-op
    const needed = dayKeys.filter(k => !dayAspectRatiosCache.has(k));
    if (needed.length === 0) return;

    const statsIndex = new Map(dayStats.value.map(d => [`${d.year}-${d.month}-${d.day}`, d]));
    const neededStats = needed.map(k => statsIndex.get(k)).filter((s): s is DayStats => !!s);
    if (neededStats.length === 0) return;

    const startTs = Math.min(...neededStats.map(s => s.minTimestamp));
    const endTs = Math.max(...neededStats.map(s => s.maxTimestamp));
    const version = aspectRatiosVersion;

    try {
      const rows = await historyDB.getDayAspectRatiosByRange(startTs, endTs, buildFilter());
      if (version !== aspectRatiosVersion) return;
      // await 期间全量预取可能已完成：此时 cache 已填满 3000+ 天，若继续执行 LRU 裁剪
      // 会把 size 截到 MAX_ASPECT_RATIOS_CACHE (200) 条，永久破坏"全量精准骨架"承诺。
      // 注意：populateFullAspectCache 不 bump aspectRatiosVersion，所以上一行检查捕获不到。
      if (isFullyPreloaded.value) return;

      const buckets = new Map<string, AspectRatioRow[]>();
      for (const r of rows) {
        const key = tsToDayKey(r.timestamp);
        const arr = buckets.get(key);
        if (arr) arr.push(r);
        else buckets.set(key, [r]);
      }

      // 写入 cache：先 delete 再 set → 移到 Map 末尾（LRU 最新）
      for (const [key, bucket] of buckets) {
        dayAspectRatiosCache.delete(key);
        dayAspectRatiosCache.set(key, bucket);
      }

      // LRU 淘汰（仅降级模式生效；正常模式此函数短路不进入）
      while (dayAspectRatiosCache.size > MAX_ASPECT_RATIOS_CACHE) {
        const firstKey = dayAspectRatiosCache.keys().next().value;
        if (!firstKey) break;
        dayAspectRatiosCache.delete(firstKey);
      }

      aspectRatiosRevision.value++;
    } catch (e) {
      if (version === aspectRatiosVersion) log.warn('prefetchDayAspectRatios 失败:', e);
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

    // v7：同步清理 aspectRatios cache（支持链接检测批量删、迁移面板删等场景的精确移除）
    // - 全量预取模式下所有 day 都在 cache 里,按 id 精准过滤
    // - 降级模式下部分 day 在 cache,过滤到空则从 Map 删除节省内存
    let aspectModified = false;
    for (const [dayKey, bucket] of dayAspectRatiosCache) {
      const before = bucket.length;
      const filtered = bucket.filter(row => !idSet.has(row.id));
      if (filtered.length !== before) {
        if (filtered.length > 0) dayAspectRatiosCache.set(dayKey, filtered);
        else dayAspectRatiosCache.delete(dayKey);
        aspectModified = true;
      }
    }
    if (aspectModified) aspectRatiosRevision.value++;

    // 只要有 id 没在 dayMetaCache 命中就兜底 reloadAll；否则未加载天的 dayStats.count 会失真
    // 注意：即使 aspectCache 命中了（全量预取模式）也不能代替兜底，dayStats.count 仍需精确维护
    if (matchedCount < ids.length) {
      log.debug(`removeItemsByIds: dayMetaCache 仅命中 ${matchedCount}/${ids.length}，走 reloadAll 兜底`);
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
        dayAspectRatiosCache.delete(key);
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
    // aspectRatios cache 里缓存的 count 可能已过期（新增/删除改变了天内数量/顺序），全清最稳
    aspectRatiosVersion++;
    dayAspectRatiosCache.clear();
    isFullyPreloaded.value = false; // loadDayStats 完成后会重置为 true（若未超阈值）
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
    aspectRatiosVersion++;
    dayMetaCache.clear();
    dayAspectRatiosCache.clear();
    loadedDayKeys.value = new Set();
    isFullyPreloaded.value = false;
    void loadDayStats();
  });

  // v7：timeline 组件 mounted 就开始预加载,不等 visible=true
  // HistoryView 用 KeepAlive + v-show 同时挂载三个子 view,TimelineView 在表格视图时
  // 已经处于 mounted 状态。提前预加载让用户切到 timeline 时零等待。
  // 代价：用户如果从不开 timeline,浪费 1-2s SQL + 5MB 内存（对图片管理工具可接受）。
  // 即使 visible=false 时 filter 变化也会触发重载（上面的 watch），逻辑等价。
  //
  // 保留 visible watch 作为兜底：极端场景（组件挂载时 loadDayStats 竞态失败）下
  // 用户切到 timeline 视图仍会补触发一次加载。
  if (!hasLoadedStats.value) void loadDayStats();
  watch(visible, (v) => {
    if (v && !hasLoadedStats.value) void loadDayStats();
  });

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
    dayAspectRatiosCache.clear();
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
    isFullyPreloaded,
    loadDayStats,
    ensureDaysLoaded,
    prefetchDayAspectRatios,
    reloadAll,
    findDayBefore,
    findDayAfter,
  };
}
