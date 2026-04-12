/**
 * 智能图片预加载 Composable
 * 根据滚动方向预加载下一屏图片，快速滚动时跳过预加载
 */
import { watch, onUnmounted, type Ref } from 'vue';
import type { ImageMeta } from '../../types/image-meta';
import type { VisibleItem } from '../useVirtualTimeline';

/** 预加载配置 */
const PRELOAD_CONFIG = {
  /** 预加载图片数量上限（约 1 屏） */
  MAX_COUNT: 20,
  /** 预加载延迟（毫秒） */
  DELAY_MS: 300,
} as const;

/** 获取缩略图 URL 的函数签名 */
type GetThumbnailUrlFn = (meta: ImageMeta) => string;

interface UseImagePreloadOptions {
  /** 当前可见项列表 */
  visibleItems: Ref<VisibleItem[]>;
  /** 所有 filteredMetas */
  allMetas: Ref<ImageMeta[]>;
  /** 三阶段渲染模式（fast 时跳过预加载） */
  displayMode: Ref<'fast' | 'normal'>;
  /** 滚动方向 */
  scrollDirection: Ref<'up' | 'down' | null>;
  /** 获取缩略图 URL */
  getThumbnailUrl: GetThumbnailUrlFn;
  /** 判断图片是否已加载 */
  isImageLoaded: (id: string) => boolean;
  /** 图片加载成功回调 */
  onImageLoad: (id: string) => void;
  /** 图片加载失败回调 */
  onImageError: (e: Event, id: string) => void;
}

export function useImagePreload(options: UseImagePreloadOptions) {
  const {
    visibleItems,
    allMetas,
    displayMode,
    scrollDirection,
    getThumbnailUrl,
    isImageLoaded,
    onImageLoad,
    onImageError,
  } = options;

  /** 预加载定时器 */
  let preloadTimer: number | undefined;

  /**
   * 预加载下一屏图片（根据滚动方向）
   * 快速滚动时跳过，避免浪费带宽
   */
  function preloadNextScreen() {
    if (displayMode.value === 'fast') return;

    const direction = scrollDirection.value;
    if (!direction) return;

    const currentVisibleIds = new Set(visibleItems.value.map(v => v.meta.id));
    const metas = allMetas.value;

    // 找到当前可见区域的边界索引（单次遍历，找到两个目标后提前退出，避免 2×O(n)）
    const visibleMetaIds = visibleItems.value.map(v => v.meta.id);
    const firstId = visibleMetaIds[0];
    const lastId = visibleMetaIds[visibleMetaIds.length - 1];
    let firstVisibleIndex = -1;
    let lastVisibleIndex = -1;
    for (let i = 0; i < metas.length; i++) {
      if (metas[i].id === firstId) firstVisibleIndex = i;
      if (metas[i].id === lastId) lastVisibleIndex = i;
      if (firstVisibleIndex !== -1 && lastVisibleIndex !== -1) break;
    }

    if (firstVisibleIndex === -1 || lastVisibleIndex === -1) return;

    // 预加载数量（约 1 屏）
    const preloadCount = Math.min(PRELOAD_CONFIG.MAX_COUNT, visibleItems.value.length);

    // 根据滚动方向确定预加载范围
    const preloadStart = direction === 'down'
      ? lastVisibleIndex + 1
      : Math.max(0, firstVisibleIndex - preloadCount);
    const preloadEnd = direction === 'down'
      ? Math.min(metas.length, lastVisibleIndex + preloadCount + 1)
      : firstVisibleIndex;

    // 后台预加载图片
    for (let i = preloadStart; i < preloadEnd; i++) {
      const meta = metas[i];
      if (!meta || currentVisibleIds.has(meta.id) || isImageLoaded(meta.id)) continue;

      const url = getThumbnailUrl(meta);
      if (!url) continue;

      const img = new Image();
      img.src = url;
      img.onload = () => onImageLoad(meta.id);
      img.onerror = (e) => onImageError(e as Event, meta.id);
    }
  }

  // 滚动停止后（displayMode 回到 normal）触发预加载（防抖）
  watch(displayMode, (mode) => {
    if (mode === 'normal') {
      if (preloadTimer) clearTimeout(preloadTimer);
      preloadTimer = window.setTimeout(() => {
        preloadNextScreen();
      }, PRELOAD_CONFIG.DELAY_MS);
    }
  });

  onUnmounted(() => {
    if (preloadTimer) clearTimeout(preloadTimer);
  });

  return {
    preloadNextScreen,
    /** 清理定时器（供外部 onUnmounted 调用） */
    cleanup: () => {
      if (preloadTimer) clearTimeout(preloadTimer);
    },
  };
}
