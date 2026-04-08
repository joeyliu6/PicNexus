/**
 * useFavoritesLightbox - 收藏视图灯箱管理
 *
 * 从 FavoritesView.vue 提取，管理：
 * - 灯箱可见性、当前项、索引
 * - 前后导航
 * - 灯箱内删除
 */
import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { useToast } from '../useToast';
import { createLogger } from '../../utils/logger';
import type { ImageMeta } from '../../types/image-meta';
import type { HistoryItem } from '../../config/types';

const log = createLogger('FavoritesLightbox');

interface UseFavoritesLightboxParams {
  /** 收藏元数据列表（用于索引定位和导航） */
  favoriteMetas: ComputedRef<ImageMeta[]>;
  /** 获取详情（通过 detailCache） */
  getDetail: (id: string) => Promise<HistoryItem>;
  /** 删除历史记录 */
  deleteHistoryItem: (id: string) => Promise<boolean | void>;
}

export interface UseFavoritesLightboxReturn {
  /** 灯箱是否可见 */
  lightboxVisible: Ref<boolean>;
  /** 灯箱当前项 */
  lightboxItem: Ref<HistoryItem | null>;
  /** 灯箱是否有上一项 */
  lightboxHasPrev: ComputedRef<boolean>;
  /** 灯箱是否有下一项 */
  lightboxHasNext: ComputedRef<boolean>;
  /** 打开灯箱 */
  openLightbox: (meta: ImageMeta) => Promise<void>;
  /** 灯箱导航 */
  handleLightboxNavigate: (direction: 'prev' | 'next') => Promise<void>;
  /** 灯箱内删除 */
  handleLightboxDelete: (item: HistoryItem) => Promise<void>;
}

export function useFavoritesLightbox(params: UseFavoritesLightboxParams): UseFavoritesLightboxReturn {
  const { favoriteMetas, getDetail, deleteHistoryItem } = params;
  const toast = useToast();

  const lightboxVisible = ref(false);
  const lightboxItem = ref<HistoryItem | null>(null);

  const lightboxIndex = computed(() => {
    if (!lightboxItem.value) return -1;
    return favoriteMetas.value.findIndex(m => m.id === lightboxItem.value!.id);
  });

  const lightboxHasPrev = computed(() => lightboxIndex.value > 0);
  const lightboxHasNext = computed(() =>
    lightboxIndex.value >= 0 && lightboxIndex.value < favoriteMetas.value.length - 1
  );

  const openLightbox = async (meta: ImageMeta): Promise<void> => {
    try {
      const detail = await getDetail(meta.id);
      lightboxItem.value = detail;
      lightboxVisible.value = true;
    } catch (e) {
      toast.error('加载失败', String(e));
    }
  };

  const handleLightboxNavigate = async (direction: 'prev' | 'next'): Promise<void> => {
    const metas = favoriteMetas.value;
    const nextIdx = lightboxIndex.value + (direction === 'prev' ? -1 : 1);
    if (nextIdx < 0 || nextIdx >= metas.length) return;
    try {
      lightboxItem.value = await getDetail(metas[nextIdx].id);
    } catch (e) {
      log.error('导航失败:', e);
    }
  };

  const handleLightboxDelete = async (item: HistoryItem): Promise<void> => {
    try {
      await deleteHistoryItem(item.id);
      lightboxVisible.value = false;
      toast.success('已删除');
    } catch (e) {
      toast.error('删除失败', String(e));
    }
  };

  return {
    lightboxVisible,
    lightboxItem,
    lightboxHasPrev,
    lightboxHasNext,
    openLightbox,
    handleLightboxNavigate,
    handleLightboxDelete,
  };
}
