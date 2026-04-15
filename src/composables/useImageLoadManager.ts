/**
 * 图片加载状态管理 Composable
 * 管理图片的加载状态、LRU 缓存、延迟清理
 *
 * 性能优化说明：
 * - 使用 shallowRef + triggerRef 避免深度响应式开销
 * - cleanupExpiredImages 直接在原 Set 上操作，避免无效复制
 */
import { shallowRef, triggerRef, onUnmounted, type Ref } from 'vue';
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

  /** 已加载图片的 ID 集合（使用 shallowRef 避免深度响应式） */
  const loadedImages = shallowRef(new Set<string>());

  /** 加载失败的图片 ID 集合 */
  const failedImages = shallowRef(new Set<string>());

  /** 图片最后可见时间戳（用于延迟销毁） */
  const lastVisibleTime = new Map<string, number>();

  /** 图片加载重试次数 */
  const imageRetryCount = new Map<string, number>();

  /** 重试定时器集合（onUnmounted 时全部取消，防止 unmount 后仍触发无效请求） */
  const retryTimers = new Set<ReturnType<typeof setTimeout>>();

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
    const cache = loadedImages.value;
    cache.add(id);
    lastVisibleTime.set(id, Date.now());

    // LRU 淘汰：超过缓存上限时，淘汰最老的非可见项
    if (cache.size > maxCache) {
      const visibleIds = new Set(visibleItems.value.map((v) => v.meta.id));
      visibleIds.add(id); // 排除当前正在加载的项

      const toEvict = findOldestEvictable(cache, visibleIds);
      if (toEvict) {
        cache.delete(toEvict);
        lastVisibleTime.delete(toEvict);
      }
    }

    triggerRef(loadedImages);
    startCleanupTimer();
  }

  /**
   * 图片加载失败处理（带重试）
   */
  function onImageError(event: Event, id: string) {
    const img = event.target as HTMLImageElement;
    const currentRetry = imageRetryCount.get(id) || 0;

    if (currentRetry < maxRetry) {
      imageRetryCount.set(id, currentRetry + 1);
      const originalSrc = img.src;
      // 离屏预加载的 Image 对象不在 DOM 中，重试始终安全
      const isOffscreen = !img.isConnected;
      const timer = setTimeout(() => {
        retryTimers.delete(timer);
        // 模板中的 img：如果已被虚拟滚动移出 DOM，跳过重试避免操作过期引用
        if (!isOffscreen && !img.isConnected) return;
        if (originalSrc) {
          img.src = '';
          img.src = originalSrc;
        }
      }, 500);
      retryTimers.add(timer);
    } else {
      failedImages.value.add(id);
      triggerRef(failedImages);
    }
  }

  /**
   * 检查图片是否加载失败
   */
  function isImageFailed(id: string): boolean {
    return failedImages.value.has(id);
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
    const cache = loadedImages.value;

    // 提前判断：没有已加载图片时直接返回
    if (cache.size === 0) {
      stopCleanupTimer();
      return;
    }

    const visibleIds = new Set(visibleItems.value.map((v) => v.meta.id));
    let hasDeleted = false;

    // 更新当前可见图片的时间戳
    for (const id of visibleIds) {
      lastVisibleTime.set(id, now);
    }

    // 检查并删除过期图片（直接在原 Set 上操作）
    for (const id of cache) {
      const lastTime = lastVisibleTime.get(id);
      if (!visibleIds.has(id) && lastTime && now - lastTime > destroyDelay) {
        cache.delete(id);
        lastVisibleTime.delete(id);
        imageRetryCount.delete(id);
        hasDeleted = true;
      }
    }

    // 只有真的删除了才触发响应式更新
    if (hasDeleted) {
      triggerRef(loadedImages);

      // 清理后如果为空，停止定时器
      if (cache.size === 0) {
        stopCleanupTimer();
      }
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
    failedImages.value = new Set();
    lastVisibleTime.clear();
    imageRetryCount.clear();
    for (const t of retryTimers) clearTimeout(t);
    retryTimers.clear();
  }

  // 组件卸载时清理
  onUnmounted(() => {
    stopCleanupTimer();
    clearAll();
  });

  return {
    loadedImages,
    failedImages,
    onImageLoad,
    onImageError,
    isImageLoaded,
    isImageFailed,
    cleanupExpiredImages,
    clearAll,
  };
}
