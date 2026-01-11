/**
 * 图片详情 LRU 缓存
 *
 * 控制内存占用，按需加载图片详情，淘汰最久未使用的数据
 */

import { shallowRef, type Ref } from 'vue';
import type { HistoryItem } from '../config/types';
import { historyDB } from '../services/HistoryDatabase';

// ==================== 配置 ====================

/** LRU 缓存大小 */
const DETAIL_CACHE_SIZE = 200; // 200条 × ~5KB ≈ 1MB

// ==================== 类型定义 ====================

/** LRU 缓存节点 */
interface CacheNode {
  id: string;
  detail: HistoryItem;
  timestamp: number; // 最后访问时间（用于统计）
}

/** 缓存统计信息 */
export interface CacheStats {
  size: number; // 当前缓存条数
  maxSize: number; // 最大缓存条数
  hitCount: number; // 命中次数
  missCount: number; // 未命中次数
  hitRate: number; // 命中率 (0-1)
}

// ==================== LRU 缓存实现 ====================

/**
 * LRU 详情缓存类
 *
 * 特性：
 * - 最近最少使用（LRU）淘汰策略
 * - O(1) 查询和更新
 * - 自动淘汰超出容量的数据
 * - 统计命中率
 */
class ImageDetailCache {
  /** 缓存存储 */
  private cache = new Map<string, CacheNode>();

  /** 访问顺序（队尾为最近访问） */
  private accessOrder: string[] = [];

  /** 统计：命中次数 */
  private hitCount = 0;

  /** 统计：未命中次数 */
  private missCount = 0;

  /**
   * 获取详情（命中缓存或从数据库加载）
   *
   * @param id 图片 ID
   * @returns 图片详情
   */
  async get(id: string): Promise<HistoryItem> {
    // 缓存命中
    if (this.cache.has(id)) {
      this.hitCount++;
      const node = this.cache.get(id)!;
      node.timestamp = Date.now();

      // 更新访问顺序（移到队尾）
      this.updateAccessOrder(id);

      return node.detail;
    }

    // 缓存未命中，从数据库加载
    this.missCount++;
    const detail = await historyDB.getById(id);

    if (!detail) {
      throw new Error(`图片详情不存在: ${id}`);
    }

    // 存入缓存
    this.set(id, detail);

    return detail;
  }

  /**
   * 批量预加载详情
   *
   * 用于可见区域预加载，提升悬停响应速度
   *
   * @param ids 图片 ID 列表
   */
  async prefetch(ids: string[]): Promise<void> {
    // 过滤已缓存的 ID
    const uncachedIds = ids.filter(id => !this.cache.has(id));

    if (uncachedIds.length === 0) return;

    // 逐个加载（historyDB 目前没有批量查询接口）
    // TODO: 优化为批量查询
    const loadPromises = uncachedIds.map(async id => {
      try {
        const detail = await historyDB.getById(id);
        if (detail) {
          this.set(id, detail);
        }
      } catch (e) {
        console.warn(`[DetailCache] 预加载失败: ${id}`, e);
      }
    });

    await Promise.all(loadPromises);
  }

  /**
   * 存入缓存（带 LRU 淘汰）
   *
   * @param id 图片 ID
   * @param detail 图片详情
   */
  private set(id: string, detail: HistoryItem): void {
    // LRU 淘汰：缓存满且新 ID 不在缓存中
    if (this.cache.size >= DETAIL_CACHE_SIZE && !this.cache.has(id)) {
      const oldestId = this.accessOrder.shift();
      if (oldestId) {
        this.cache.delete(oldestId);
      }
    }

    // 存入缓存
    this.cache.set(id, {
      id,
      detail,
      timestamp: Date.now(),
    });

    // 更新访问顺序
    this.updateAccessOrder(id);
  }

  /**
   * 更新访问顺序（移到队尾）
   *
   * @param id 图片 ID
   */
  private updateAccessOrder(id: string): void {
    const index = this.accessOrder.indexOf(id);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(id);
  }

  /**
   * 移除指定详情（删除操作后调用）
   *
   * @param id 图片 ID
   */
  remove(id: string): void {
    this.cache.delete(id);
    const index = this.accessOrder.indexOf(id);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    this.hitCount = 0;
    this.missCount = 0;
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): CacheStats {
    const total = this.hitCount + this.missCount;
    return {
      size: this.cache.size,
      maxSize: DETAIL_CACHE_SIZE,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate: total > 0 ? this.hitCount / total : 0,
    };
  }
}

// ==================== 单例实例 ====================

/** 全局单例缓存 */
const detailCache = new ImageDetailCache();

// ==================== Composable ====================

/**
 * 图片详情缓存 Composable
 *
 * 提供详情加载、预加载、缓存管理功能
 */
export function useImageDetailCache() {
  /** 缓存统计（响应式） */
  const cacheStats: Ref<CacheStats> = shallowRef({
    size: 0,
    maxSize: DETAIL_CACHE_SIZE,
    hitCount: 0,
    missCount: 0,
    hitRate: 0,
  });

  /**
   * 更新统计信息
   */
  function updateStats() {
    cacheStats.value = detailCache.getStats();
  }

  /**
   * 获取单条详情
   */
  async function getDetail(id: string): Promise<HistoryItem> {
    const result = await detailCache.get(id);
    updateStats();
    return result;
  }

  /**
   * 批量预加载详情
   */
  async function prefetchDetails(ids: string[]): Promise<void> {
    await detailCache.prefetch(ids);
    updateStats();
  }

  /**
   * 移除指定详情
   */
  function removeDetail(id: string): void {
    detailCache.remove(id);
    updateStats();
  }

  /**
   * 清空缓存
   */
  function clearCache(): void {
    detailCache.clear();
    updateStats();
  }

  // 初始化统计
  updateStats();

  return {
    getDetail,
    prefetchDetails,
    removeDetail,
    clearCache,
    cacheStats,
  };
}
