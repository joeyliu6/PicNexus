// 云存储数据缓存 - LRU 策略 + Stale-While-Revalidate

import type { StorageObject, CloudServiceType } from '../types';

interface CacheEntry {
  objects: StorageObject[];
  hasMore: boolean;
  nextToken: string | null;
  timestamp: number;
}

interface CacheKey {
  serviceId: CloudServiceType;
  path: string;
  page: number;
  pageSize: number;
}

interface CacheResult {
  entry: CacheEntry | null;
  isStale: boolean;
}

class CloudStorageCache {
  private cache = new Map<string, CacheEntry>();
  private accessOrder: string[] = [];
  private readonly maxSize = 20;
  private readonly staleTime = 5 * 60 * 1000; // 5 分钟后视为过期

  private buildKey(key: CacheKey): string {
    return `${key.serviceId}:${key.path}:${key.page}:${key.pageSize}`;
  }

  get(key: CacheKey): CacheResult {
    const cacheKey = this.buildKey(key);
    const entry = this.cache.get(cacheKey);

    if (!entry) {
      return { entry: null, isStale: true };
    }

    this.updateAccessOrder(cacheKey);

    const isStale = Date.now() - entry.timestamp > this.staleTime;
    return { entry, isStale };
  }

  set(key: CacheKey, data: Omit<CacheEntry, 'timestamp'>): void {
    const cacheKey = this.buildKey(key);

    // LRU 淘汰：超出上限时移除最久未访问的
    if (this.cache.size >= this.maxSize && !this.cache.has(cacheKey)) {
      const oldest = this.accessOrder.shift();
      if (oldest) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(cacheKey, {
      ...data,
      timestamp: Date.now(),
    });

    this.updateAccessOrder(cacheKey);
  }

  /**
   * 清除指定服务商的所有缓存
   */
  invalidateService(serviceId: CloudServiceType): void {
    const prefix = `${serviceId}:`;
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
      const idx = this.accessOrder.indexOf(key);
      if (idx > -1) {
        this.accessOrder.splice(idx, 1);
      }
    }
  }

  /**
   * 清除指定服务商和路径的缓存
   */
  invalidatePath(serviceId: CloudServiceType, path: string): void {
    const prefix = `${serviceId}:${path}:`;
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
      const idx = this.accessOrder.indexOf(key);
      if (idx > -1) {
        this.accessOrder.splice(idx, 1);
      }
    }
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  private updateAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }
}

export const cloudStorageCache = new CloudStorageCache();
