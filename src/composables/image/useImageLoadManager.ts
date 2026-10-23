/**
 * 图片加载状态管理 Composable
 * 管理图片的加载状态（LRU 上限）与失败重试
 *
 * 「已加载」不因离开屏幕而过期：换个筛选再换回来、滚走再滚回来，新建的格子凭它直接显示图，
 * 不再从占位色淡入一遍（LoadingRules ①）。只在超过上限时淘汰最久没在屏幕上的。
 *
 * 性能优化说明：
 * - 使用 shallowRef + triggerRef 避免深度响应式开销
 */
import { shallowRef, triggerRef, onUnmounted, watch, type Ref } from 'vue';
import type { VisibleItem } from '@/composables/timeline/useVirtualTimeline';

interface UseImageLoadManagerOptions {
  /** 最大缓存数量 */
  maxCache?: number;
  /** 最大重试次数 */
  maxRetry?: number;
}

export function useImageLoadManager(
  visibleItems: Ref<VisibleItem[]>,
  options: UseImageLoadManagerOptions = {}
) {
  const {
    maxCache = 500,
    maxRetry = 1,
  } = options;

  /** 已加载图片的 ID 集合（使用 shallowRef 避免深度响应式） */
  const loadedImages = shallowRef(new Set<string>());

  /** 加载失败的图片 ID 集合 */
  const failedImages = shallowRef(new Set<string>());

  /** 已加载的图最后一次在屏幕上的时间（超过上限时淘汰最久没看到的） */
  const lastVisibleTime = new Map<string, number>();

  /** 图片加载重试次数 */
  const imageRetryCount = new Map<string, number>();

  /** 重试定时器集合（onUnmounted 时全部取消，防止 unmount 后仍触发无效请求） */
  const retryTimers = new Set<ReturnType<typeof setTimeout>>();

  // 屏幕上的已加载图记下「刚看过」
  watch(visibleItems, (items) => {
    const now = Date.now();
    for (const item of items) {
      if (loadedImages.value.has(item.meta.id)) lastVisibleTime.set(item.meta.id, now);
    }
  });

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
  }

  /**
   * 图片加载失败处理（带重试）
   *
   * `event` 可缺省：候选链的超时兜底、以及候选被安全过滤清空这两条路径都没有真实的
   * `<img>` error 事件。这时**没有可重设 src 的元素**，重试无从谈起，直接判失败——
   * 否则 `event.target` 会当场抛 TypeError，整格卡在骨架屏上。
   */
  function onImageError(event: Event | undefined, id: string) {
    const img = event?.target as HTMLImageElement | undefined;
    const currentRetry = imageRetryCount.get(id) || 0;

    if (img && currentRetry < maxRetry) {
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
   * 只撤销「失败」状态，保留已加载缓存
   *
   * 供「判失败的前提变了」这类场景用：用户在设置页确认了某个明文 HTTP 域名之后，
   * 之前因为没确认而被候选链过滤掉、进而判失败的图应该自己恢复，而不是等重启。
   *
   * 重试计数一并清掉——不清的话这些图的重试额度还停在上一轮用光的状态，
   * 刚放回来又一次失败就直接判死，等于没给第二次机会。
   * 已加载的缓存不动：那些图没出过问题，没必要跟着重来一遍。
   */
  function clearFailed() {
    failedImages.value = new Set();
    imageRetryCount.clear();
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
    clearAll();
  });

  return {
    loadedImages,
    failedImages,
    onImageLoad,
    onImageError,
    isImageLoaded,
    isImageFailed,
    clearFailed,
    clearAll,
  };
}
