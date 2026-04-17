/**
 * useFavoritesData - 收藏视图服务端分页
 *
 * 直接 SQL 查 `WHERE is_favorited=1 ORDER BY timestamp DESC LIMIT/OFFSET`，
 * 不依赖 sharedImageMetas 全量数组。
 */
import {
  ref, shallowRef, reactive, watch, onUnmounted,
  type Ref,
} from 'vue';
import { historyDB, type FavoritesMetaPageResult } from '../../services/HistoryDatabase';
import { onCacheEventType, type CacheEventType } from '../../events/cacheEvents';
import { getMetaThumbnailUrl } from '../useThumbCache';
import { createLogger } from '../../utils/logger';
import type { ImageMeta } from '../../types/image-meta';
import type { ServiceType, UserConfig } from '../../config/types';

const log = createLogger('FavoritesData');

const PAGE_SIZE = 80;
const LOAD_MORE_THRESHOLD_PX = 300;

/** SQL 命中索引常 <16ms 返回，骨架屏一帧就被替换会被感知为瞬间跳变，补齐到 150ms 让过渡有层级感 */
const MIN_SKELETON_MS = 150;

/** 本地可见删除量超过此阈值时直接 reload，避免 offset 漂移 */
const BULK_UNFAVORITE_THRESHOLD = 5;

const HISTORY_CHANGE_EVENTS: CacheEventType[] = [
  'history-updated',
  'history-deleted',
  'history-cleared',
];

interface UseFavoritesDataParams {
  filter: Ref<ServiceType | 'all'>;
  searchTerm: Ref<string>;
  favoriteSet: Ref<Set<string>>;
  scrollContainerRef: Ref<HTMLElement | null>;
  config: Ref<UserConfig>;
}

export interface UseFavoritesDataReturn {
  loadedMetas: Readonly<Ref<ImageMeta[]>>;
  totalCount: Readonly<Ref<number>>;
  hasMore: Readonly<Ref<boolean>>;
  isLoading: Readonly<Ref<boolean>>;
  hasLoadedOnce: Readonly<Ref<boolean>>;
  imageStates: Record<string, 'loading' | 'loaded' | 'failed'>;
  getThumbnailUrl: (meta: ImageMeta) => string;
  getItemService: (id: string) => ServiceType | undefined;
  onFavoritesScroll: () => void;
  loadFirstPage: () => Promise<void>;
  loadNextPage: () => Promise<void>;
}

export function useFavoritesData(params: UseFavoritesDataParams): UseFavoritesDataReturn {
  const { filter, searchTerm, favoriteSet, scrollContainerRef, config } = params;

  const loadedMetas = shallowRef<ImageMeta[]>([]);
  const totalCount = ref(0);
  const hasMore = ref(false);
  const isLoading = ref(false);
  const hasLoadedOnce = ref(false);

  const imageStates = reactive<Record<string, 'loading' | 'loaded' | 'failed'>>({});

  // 跨页服务缓存：记录每条已加载条目的 primaryService，筛选/翻页后仍能解析跨页选中项
  const itemServiceCache = new Map<string, ServiceType>();

  let nextOffset = 0;
  let scrollRafId = 0;
  // 版本号防止 filter/search 快速切换时老请求覆盖新结果
  let loadVersion = 0;
  let firstPageLoaded = false;
  let skeletonTimer: ReturnType<typeof setTimeout> | null = null;

  function cacheServices(metas: readonly ImageMeta[]): void {
    for (const meta of metas) {
      itemServiceCache.set(meta.id, meta.primaryService);
    }
  }

  async function fetchPage(offset: number): Promise<FavoritesMetaPageResult | null> {
    const version = ++loadVersion;
    try {
      const result = await historyDB.getFavoritesMetaPage({
        offset,
        limit: PAGE_SIZE,
        serviceFilter: filter.value,
        searchTerm: searchTerm.value,
      });
      return version === loadVersion ? result : null;
    } catch (error) {
      if (version === loadVersion) log.error('加载收藏分页失败:', error);
      return null;
    }
  }

  async function loadFirstPage(): Promise<void> {
    if (firstPageLoaded) return;
    firstPageLoaded = true;
    await reloadFromStart();
  }

  async function reloadFromStart(): Promise<void> {
    const version = loadVersion + 1;
    const startTime = Date.now();

    isLoading.value = true;
    // 保留旧 totalCount，避免 header 徽章瞬间跳 0 造成闪烁；loadedMetas 清空以触发骨架屏
    loadedMetas.value = [];
    hasMore.value = false;
    nextOffset = 0;
    for (const key of Object.keys(imageStates)) delete imageStates[key];

    const result = await fetchPage(0);

    const elapsed = Date.now() - startTime;
    if (elapsed < MIN_SKELETON_MS) {
      await new Promise<void>((resolve) => {
        skeletonTimer = setTimeout(() => { skeletonTimer = null; resolve(); }, MIN_SKELETON_MS - elapsed);
      });
      if (version !== loadVersion) return;
    }

    // state 更新和 isLoading=false 必须在同一个同步块内，避免 Vue flush 到中间帧触发 showEmptyState=true 的闪烁
    try {
      if (!result) return;
      loadedMetas.value = result.items;
      totalCount.value = result.total;
      hasMore.value = result.hasMore;
      nextOffset = result.items.length;
      cacheServices(result.items);
    } finally {
      if (version === loadVersion) {
        hasLoadedOnce.value = true;
        isLoading.value = false;
      }
    }
  }

  async function loadNextPage(): Promise<void> {
    if (!hasMore.value || isLoading.value) return;
    const version = loadVersion + 1;
    isLoading.value = true;

    const result = await fetchPage(nextOffset);
    try {
      if (!result) return;
      loadedMetas.value = [...loadedMetas.value, ...result.items];
      totalCount.value = result.total;
      hasMore.value = result.hasMore;
      nextOffset += result.items.length;
      cacheServices(result.items);
    } finally {
      if (version === loadVersion) isLoading.value = false;
    }
  }

  function onFavoritesScroll(): void {
    cancelAnimationFrame(scrollRafId);
    scrollRafId = requestAnimationFrame(() => {
      const el = scrollContainerRef.value;
      if (!el || !hasMore.value || isLoading.value) return;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_MORE_THRESHOLD_PX) {
        void loadNextPage();
      }
    });
  }

  function getThumbnailUrl(meta: ImageMeta): string {
    return getMetaThumbnailUrl(meta, config.value);
  }

  function getItemService(id: string): ServiceType | undefined {
    return itemServiceCache.get(id);
  }

  watch([filter, searchTerm], () => {
    if (!firstPageLoaded) return;
    void reloadFromStart();
  });

  // 单/少量取消：就地过滤保留 leave 动画；批量 or 跨视图删除：reload 避免 offset 漂移
  watch(favoriteSet, (newSet, oldSet) => {
    if (!firstPageLoaded || loadedMetas.value.length === 0) return;

    const filtered = loadedMetas.value.filter(m => newSet.has(m.id));
    const removedCount = loadedMetas.value.length - filtered.length;
    if (removedCount === 0) return;

    const globalRemovedCount = (oldSet?.size ?? newSet.size) - newSet.size;
    if (removedCount > BULK_UNFAVORITE_THRESHOLD || globalRemovedCount > removedCount) {
      void reloadFromStart();
      return;
    }

    loadedMetas.value = filtered;
    totalCount.value = Math.max(0, totalCount.value - removedCount);
    nextOffset = Math.max(0, nextOffset - removedCount);
    hasMore.value = nextOffset < totalCount.value;
  });

  const unlistens: Array<() => void> = [];
  Promise.all(
    HISTORY_CHANGE_EVENTS.map(type => onCacheEventType(type, () => {
      if (firstPageLoaded) void reloadFromStart();
    })),
  )
    .then(fns => unlistens.push(...fns))
    .catch(e => log.warn('事件订阅失败:', e));

  onUnmounted(() => {
    cancelAnimationFrame(scrollRafId);
    if (skeletonTimer) { clearTimeout(skeletonTimer); skeletonTimer = null; }
    for (const fn of unlistens) fn();
    unlistens.length = 0;
    itemServiceCache.clear();
  });

  return {
    loadedMetas,
    totalCount,
    hasMore,
    isLoading,
    hasLoadedOnce,
    imageStates,
    getThumbnailUrl,
    getItemService,
    onFavoritesScroll,
    loadFirstPage,
    loadNextPage,
  };
}
