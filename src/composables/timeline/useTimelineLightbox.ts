/**
 * 灯箱（Lightbox）逻辑 Composable
 * 管理灯箱的打开/关闭、导航、删除、预加载
 */
import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { createLogger } from '../../utils/logger';
import { getPrimaryImageUrl } from '../../utils/imageUrl';
import { type HistoryItem, type UserConfig } from '../../config/types';
import type { ImageMeta } from '../../types/image-meta';

const logger = createLogger('TimelineLightbox');

interface UseTimelineLightboxOptions {
  /** 过滤后的所有元数据 */
  filteredMetas: ComputedRef<ImageMeta[]>;
  /** 详情缓存（getDetail 方法） */
  detailCache: { getDetail: (id: string) => Promise<HistoryItem> };
  /** 配置（用于生成图片 URL） */
  config: Ref<UserConfig>;
  /** 删除历史记录方法 */
  deleteHistoryItem: (id: string) => Promise<boolean>;
  /** 滚动到指定元素 */
  scrollToItem: (id: string, behavior?: ScrollBehavior) => void;
  /** Toast 通知 */
  toast: {
    success: (msg: string) => void;
    error: (title: string, detail?: string) => void;
  };
}

export function useTimelineLightbox(options: UseTimelineLightboxOptions) {
  const {
    filteredMetas, detailCache, config,
    deleteHistoryItem, scrollToItem, toast,
  } = options;

  // ==================== 状态 ====================

  const lightboxVisible = ref(false);
  const lightboxItem = ref<HistoryItem | null>(null);

  /** 当前灯箱图片在 filteredMetas 中的索引 */
  const lightboxIndex = computed(() => {
    if (!lightboxItem.value) return -1;
    return filteredMetas.value.findIndex(m => m.id === lightboxItem.value!.id);
  });

  const lightboxHasPrev = computed(() => lightboxIndex.value > 0);
  const lightboxHasNext = computed(() =>
    lightboxIndex.value >= 0 && lightboxIndex.value < filteredMetas.value.length - 1
  );

  // ==================== 方法 ====================

  /** 打开灯箱 */
  async function openLightbox(meta: ImageMeta): Promise<void> {
    try {
      const detail = await detailCache.getDetail(meta.id);
      lightboxItem.value = detail;
      lightboxVisible.value = true;
    } catch (e) {
      logger.error('加载详情失败:', e);
      toast.error('加载失败', String(e));
    }
  }

  /** 删除当前灯箱图片 */
  async function handleLightboxDelete(item: HistoryItem): Promise<void> {
    try {
      await deleteHistoryItem(item.id);
      lightboxVisible.value = false;
      toast.success('已删除');
    } catch (e) {
      toast.error('删除失败', String(e));
    }
  }

  /** 预加载相邻图片（灯箱翻页用） */
  async function preloadAdjacentInTimeline(currentIdx: number, direction: 'prev' | 'next'): Promise<void> {
    const metas = filteredMetas.value;
    const preloadIdx = direction === 'prev' ? currentIdx - 1 : currentIdx + 1;
    if (preloadIdx < 0 || preloadIdx >= metas.length) return;
    try {
      const detail = await detailCache.getDetail(metas[preloadIdx].id);
      const url = getPrimaryImageUrl(detail, config.value);
      if (url) new Image().src = url;
    } catch { /* 预加载失败不影响用户体验 */ }
  }

  /** 灯箱导航（上一张/下一张） */
  async function handleLightboxNavigate(direction: 'prev' | 'next'): Promise<void> {
    const metas = filteredMetas.value;
    const idx = lightboxIndex.value;
    const nextIdx = direction === 'prev' ? idx - 1 : idx + 1;
    if (nextIdx < 0 || nextIdx >= metas.length) return;

    try {
      const nextMeta = metas[nextIdx];
      const detail = await detailCache.getDetail(nextMeta.id);
      lightboxItem.value = detail;
      scrollToItem(nextMeta.id);
      preloadAdjacentInTimeline(nextIdx, direction);
    } catch (e) {
      logger.error('导航加载失败:', e);
    }
  }

  return {
    lightboxVisible,
    lightboxItem,
    lightboxIndex,
    lightboxHasPrev,
    lightboxHasNext,
    openLightbox,
    handleLightboxDelete,
    handleLightboxNavigate,
  };
}
