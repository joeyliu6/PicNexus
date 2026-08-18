/**
 * 智能图片预加载 Composable
 * 根据滚动方向预加载下一屏图片，快速滚动时跳过预加载
 */
import { watch, onUnmounted, type Ref } from 'vue';
import type { ImageMeta } from '../../types/image-meta';
import type { VisibleItem } from '../useVirtualTimeline';
import { reportThumbnailUrlLoaded } from '../useThumbCache';

/** 预加载配置 */
const PRELOAD_CONFIG = {
  /** 预加载图片数量上限（约 1 屏） */
  MAX_COUNT: 20,
  /** 预加载延迟（毫秒） */
  DELAY_MS: 300,
} as const;

/** 获取缩略图候选链的函数签名 */
type GetThumbnailUrlsFn = (meta: ImageMeta) => string[];

interface UseImagePreloadOptions {
  /** 当前可见项列表 */
  visibleItems: Ref<VisibleItem[]>;
  /** 所有 filteredMetas */
  allMetas: Ref<ImageMeta[]>;
  /** 三阶段渲染模式（fast 时跳过预加载） */
  displayMode: Ref<'fast' | 'normal'>;
  /** 滚动方向 */
  scrollDirection: Ref<'up' | 'down' | null>;
  /**
   * 获取缩略图候选链
   *
   * 要的是**候选链**而不是单条 URL：单条来自 generateMediumThumbnailUrl，不看会话降级
   * 状态，代理不通时预热的还是死链。这里只用首条预热，但取自候选链才能跟随降级。
   */
  getThumbnailUrls: GetThumbnailUrlsFn;
  /** 判断图片是否已加载 */
  isImageLoaded: (id: string) => boolean;
  /** 图片加载成功回调 */
  onImageLoad: (id: string) => void;
}

export function useImagePreload(options: UseImagePreloadOptions) {
  const {
    visibleItems,
    allMetas,
    displayMode,
    scrollDirection,
    getThumbnailUrls,
    isImageLoaded,
    onImageLoad,
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

      const url = getThumbnailUrls(meta)[0];
      if (!url) continue;

      const img = new Image();
      img.src = url;
      img.onload = () => {
        reportThumbnailUrlLoaded(url);
        onImageLoad(meta.id);
      };
      // 预加载失败**既不标记这张图失败，也不上报**，直接放着不管：
      // - 不标记：这只是离屏预热、试的还只是候选链第一条。标进 failedImages 会让
      //   TimelinePhotoItem 直接走占位分支（见其模板 v-if），候选链里垫底的原图
      //   永远没机会顶上——正好复现 issue #4 症状②。
      // - 不上报：单条失败分不清「代理不通」还是「这张图被删了」，而上报会把整个会话
      //   降级。预热只有一条 URL，没有「下一条成功了」这个对照，无从定性。
      //   真实渲染时组件会按候选链逐条试，那里才有资格下结论。
      img.onerror = () => { /* 交给真实渲染时的候选链判断 */ };
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
