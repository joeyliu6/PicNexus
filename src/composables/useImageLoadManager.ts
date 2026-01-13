/**
 * 图片加载状态管理 Composable
 * 管理图片的加载状态、LRU 缓存、延迟清理
 */
import { shallowRef, onUnmounted, type Ref } from 'vue';
import type { VisibleItem } from './useVirtualTimeline';

interface UseImageLoadManagerOptions {
  /** 最大缓存数量 */
  maxCache?: number;
  /** 延迟销毁时间（毫秒） */
  destroyDelay?: number;
  /** 最大重试次数 */
  maxRetry?: number;
}

export function useImageLoadManager(
  visibleItems: Ref<VisibleItem[]>,
  options: UseImageLoadManagerOptions = {}
) {
  const {
    maxCache = 500,
    destroyDelay = 2500,
    maxRetry = 1,
  } = options;

  /** 已加载图片的 ID 集合 */
  const loadedImages = shallowRef(new Set<string>());

  /** 图片最后可见时间戳（用于延迟销毁） */
  const lastVisibleTime = new Map<string, number>();

  /** 图片加载重试次数 */
  const imageRetryCount = new Map<string, number>();

  /** 清理定时器 */
  let cleanupTimer: number | undefined;

  /**
   * 找到最老的可淘汰项（LRU 策略）
   */
  function findOldestEvictable(cache: Set<string>, excludeIds: Set<string>): string | null {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const id of cache) {
      if (excludeIds.has(id)) continue;
      const time = lastVisibleTime.get(id) ?? 0;
      if (time < oldestTime) {
        oldestTime = time;
        oldestId = id;
      }
    }
    return oldestId;
  }

  /**
   * 标记图片已加载
   */
  function onImageLoad(id: string) {
    const newSet = new Set(loadedImages.value);
    newSet.add(id);

    lastVisibleTime.set(id, Date.now());

    // LRU 淘汰：超过缓存上限时，淘汰最老的非可见项
    if (newSet.size > maxCache) {
      const visibleIds = new Set(visibleItems.value.map((v) => v.meta.id));
      visibleIds.add(id); // 排除当前正在加载的项

      const toEvict = findOldestEvictable(newSet, visibleIds);
      if (toEvict) {
        newSet.delete(toEvict);
        lastVisibleTime.delete(toEvict);
      }
    }

    loadedImages.value = newSet;
  }

  /**
   * 图片加载失败处理（带重试）
   */
  function onImageError(event: Event, id: string) {
    const img = event.target as HTMLImageElement;
    const currentRetry = imageRetryCount.get(id) || 0;

    if (currentRetry < maxRetry) {
      imageRetryCount.set(id, currentRetry + 1);
      setTimeout(() => {
        if (img && img.src) {
          const originalSrc = img.src;
          img.src = '';
          img.src = originalSrc;
        }
      }, 500);
    } else {
      img.style.display = 'none';
    }
  }

  /**
   * 检查图片是否已加载
   */
  function isImageLoaded(id: string): boolean {
    return loadedImages.value.has(id);
  }

  /**
   * 延迟清理过期的图片状态
   */
  function cleanupExpiredImages() {
    const now = Date.now();
    const visibleIds = new Set(visibleItems.value.map((v) => v.meta.id));
    let hasChanges = false;

    // 更新当前可见图片的时间戳
    for (const id of visibleIds) {
      lastVisibleTime.set(id, now);
    }

    // 清理过期图片
    const newSet = new Set(loadedImages.value);
    for (const id of newSet) {
      const lastTime = lastVisibleTime.get(id);
      if (!visibleIds.has(id) && lastTime && now - lastTime > destroyDelay) {
        newSet.delete(id);
        lastVisibleTime.delete(id);
        imageRetryCount.delete(id);
        hasChanges = true;
      }
    }

    if (hasChanges) {
      loadedImages.value = newSet;
    }
  }

  /**
   * 启动延迟清理定时器
   */
  function startCleanupTimer() {
    if (cleanupTimer) return;
    cleanupTimer = window.setInterval(cleanupExpiredImages, 1000);
  }

  /**
   * 停止延迟清理定时器
   */
  function stopCleanupTimer() {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = undefined;
    }
  }

  /**
   * 清空所有加载状态
   */
  function clearAll() {
    loadedImages.value = new Set();
    lastVisibleTime.clear();
    imageRetryCount.clear();
  }

  // 自动启动清理定时器
  startCleanupTimer();

  // 组件卸载时清理
  onUnmounted(() => {
    stopCleanupTimer();
    clearAll();
  });

  return {
    loadedImages,
    onImageLoad,
    onImageError,
    isImageLoaded,
    cleanupExpiredImages,
    clearAll,
  };
}
