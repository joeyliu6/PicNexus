// src/utils/cache.ts
// 通用缓存工具，支持 TTL 和跨窗口同步

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { listen, emit } from '@tauri-apps/api/event';

/**
 * 缓存配置选项
 */
export interface CacheOptions<T> {
  /** 缓存键名（用于跨窗口同步和日志） */
  key: string;

  /** TTL（毫秒），默认无限 */
  ttl?: number;

  /** 数据加载函数 */
  loader: () => Promise<T>;

  /** 是否启用跨窗口同步，默认 true */
  crossWindowSync?: boolean;
}

/**
 * 缓存条目
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * 缓存实例返回类型
 */
export interface CacheInstance<T> {
  /** 获取缓存数据（如果缓存无效会自动加载） */
  get: (forceRefresh?: boolean) => Promise<T>;
  /** 使缓存失效 */
  invalidate: () => void;
  /** 更新缓存数据（不触发重新加载） */
  update: (updater: (current: T) => T) => void;
  /** 直接设置缓存数据 */
  set: (data: T) => void;
  /** 是否正在加载 */
  isLoading: ComputedRef<boolean>;
  /** 是否有缓存数据 */
  hasData: ComputedRef<boolean>;
  /** 缓存是否有效 */
  isValid: ComputedRef<boolean>;
  /** 数据版本号（每次变化递增） */
  version: ComputedRef<number>;
}

/**
 * 创建带 TTL 和跨窗口同步的缓存
 *
 * @example
 * ```typescript
 * const historyCache = createCache({
 *   key: 'history',
 *   ttl: 5 * 60 * 1000, // 5 分钟
 *   loader: async () => {
 *     return await fetchHistoryItems();
 *   }
 * });
 *
 * // 获取数据（自动处理缓存）
 * const items = await historyCache.get();
 *
 * // 强制刷新
 * const freshItems = await historyCache.get(true);
 *
 * // 更新缓存中的数据
 * historyCache.update(items => items.filter(item => item.id !== deletedId));
 *
 * // 使缓存失效
 * historyCache.invalidate();
 * ```
 */
export function createCache<T>(options: CacheOptions<T>): CacheInstance<T> {
  const { key, ttl = Infinity, loader, crossWindowSync = true } = options;

  // 缓存数据
  const cache: Ref<CacheEntry<T> | null> = ref(null);
  const isLoading = ref(false);
  const version = ref(0);

  // 跨窗口同步事件名
  const invalidateEventName = `cache-invalidate:${key}`;

  /**
   * 检查缓存是否有效
   */
  function checkValid(): boolean {
    if (!cache.value) return false;
    if (ttl === Infinity) return true;
    return Date.now() - cache.value.timestamp < ttl;
  }

  /**
   * 获取缓存数据
   */
  async function get(forceRefresh = false): Promise<T> {
    // 如果缓存有效且不强制刷新，直接返回
    if (!forceRefresh && checkValid() && cache.value) {
      console.log(`[缓存 ${key}] 命中缓存`);
      return cache.value.data;
    }

    // 加载数据
    isLoading.value = true;
    try {
      console.log(`[缓存 ${key}] 开始加载数据...`);
      const data = await loader();
      cache.value = {
        data,
        timestamp: Date.now()
      };
      version.value++;
      console.log(`[缓存 ${key}] 数据加载完成`);
      return data;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 使缓存失效
   */
  function invalidate(): void {
    console.log(`[缓存 ${key}] 缓存已失效`);
    cache.value = null;
    version.value++;

    // 跨窗口通知
    if (crossWindowSync) {
      emit(invalidateEventName, { timestamp: Date.now() }).catch((e) => {
        console.warn(`[缓存 ${key}] 跨窗口通知失败:`, e);
      });
    }
  }

  /**
   * 更新缓存数据（不触发重新加载）
   */
  function update(updater: (current: T) => T): void {
    if (cache.value) {
      cache.value = {
        data: updater(cache.value.data),
        timestamp: Date.now()
      };
      version.value++;
      console.log(`[缓存 ${key}] 缓存数据已更新`);
    }
  }

  /**
   * 直接设置缓存数据
   */
  function set(data: T): void {
    cache.value = {
      data,
      timestamp: Date.now()
    };
    version.value++;
    console.log(`[缓存 ${key}] 缓存数据已设置`);
  }

  // 设置跨窗口监听
  if (crossWindowSync) {
    listen<{ timestamp: number }>(invalidateEventName, () => {
      console.log(`[缓存 ${key}] 收到跨窗口失效通知`);
      cache.value = null;
      version.value++;
    }).catch((e) => {
      console.warn(`[缓存 ${key}] 设置跨窗口监听失败:`, e);
    });
  }

  return {
    get,
    invalidate,
    update,
    set,
    isLoading: computed(() => isLoading.value),
    hasData: computed(() => cache.value !== null),
    isValid: computed(() => checkValid()),
    version: computed(() => version.value)
  };
}

/**
 * LRU 缓存选项
 */
export interface LRUCacheOptions<K, V> {
  /** 缓存键名（用于日志） */
  key: string;
  /** 最大缓存项数 */
  maxSize: number;
  /** 数据加载函数 */
  loader: (itemKey: K) => Promise<V>;
}

/**
 * LRU 缓存实例返回类型
 */
export interface LRUCacheInstance<K, V> {
  /** 获取缓存数据 */
  get: (itemKey: K) => Promise<V>;
  /** 使指定项或全部缓存失效 */
  invalidate: (itemKey?: K) => void;
  /** 获取当前缓存大小 */
  size: () => number;
}

/**
 * 创建 LRU 缓存（用于多项数据，如图片缩略图）
 *
 * @example
 * ```typescript
 * const thumbnailCache = createLRUCache({
 *   key: 'thumbnails',
 *   maxSize: 100,
 *   loader: async (imageId: string) => {
 *     return await generateThumbnail(imageId);
 *   }
 * });
 *
 * // 获取缩略图（自动处理 LRU 淘汰）
 * const thumb = await thumbnailCache.get('image-123');
 * ```
 */
export function createLRUCache<K, V>(options: LRUCacheOptions<K, V>): LRUCacheInstance<K, V> {
  const { key, maxSize, loader } = options;
  const cache = new Map<K, { value: V; accessTime: number }>();

  /**
   * 清理最久未使用的条目
   */
  function evictLRU(): void {
    if (cache.size <= maxSize) return;

    let oldestKey: K | undefined;
    let oldestTime = Infinity;

    for (const [k, entry] of cache.entries()) {
      if (entry.accessTime < oldestTime) {
        oldestTime = entry.accessTime;
        oldestKey = k;
      }
    }

    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
      console.log(`[LRU缓存 ${key}] 淘汰最久未使用条目`);
    }
  }

  /**
   * 获取缓存数据
   */
  async function get(itemKey: K): Promise<V> {
    const entry = cache.get(itemKey);
    if (entry) {
      // 更新访问时间
      entry.accessTime = Date.now();
      return entry.value;
    }

    // 加载数据
    const value = await loader(itemKey);
    cache.set(itemKey, { value, accessTime: Date.now() });
    evictLRU();
    return value;
  }

  /**
   * 使缓存失效
   */
  function invalidate(itemKey?: K): void {
    if (itemKey !== undefined) {
      cache.delete(itemKey);
      console.log(`[LRU缓存 ${key}] 清除指定缓存项`);
    } else {
      cache.clear();
      console.log(`[LRU缓存 ${key}] 清除全部缓存`);
    }
  }

  return {
    get,
    invalidate,
    size: () => cache.size
  };
}
