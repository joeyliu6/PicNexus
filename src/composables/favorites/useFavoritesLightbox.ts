/**
 * useFavoritesLightbox - 收藏视图灯箱管理
 *
 * 从 FavoritesView.vue 提取，管理：
 * - 灯箱可见性、当前项、索引
 * - 前后导航
 * - 灯箱内删除
 */
import { ref, computed, type Ref } from 'vue';
import { useToast } from '../useToast';
import { createLogger } from '../../utils/logger';
import type { ImageMeta } from '../../types/image-meta';
import type { HistoryItem } from '../../config/types';

const log = createLogger('FavoritesLightbox');

/** 近底预加载阈值：导航到倒数第 N 项（含）时触发 loadNext */
const NEAR_END_THRESHOLD = 3;

interface UseFavoritesLightboxParams {
  /** 已加载的收藏元数据（用于索引定位和导航） */
  favoriteMetas: Readonly<Ref<ImageMeta[]>>;
  /** 获取详情（通过 detailCache） */
  getDetail: (id: string) => Promise<HistoryItem>;
  /** 删除历史记录 */
  deleteHistoryItem: (id: string) => Promise<boolean | void>;
  /** 是否还有未加载数据（可选：有则支持导航触发加载） */
  hasMore?: Readonly<Ref<boolean>>;
  /** 加载下一页（可选：仅在 hasMore 传入时使用） */
  loadNext?: () => Promise<void>;
}

export interface UseFavoritesLightboxReturn {
  /** 灯箱是否可见 */
  lightboxVisible: Ref<boolean>;
  /** 灯箱当前项 */
  lightboxItem: Ref<HistoryItem | null>;
  /** 灯箱是否有上一项 */
  lightboxHasPrev: Readonly<Ref<boolean>>;
  /** 灯箱是否有下一项（服务端还有未加载的也算有） */
  lightboxHasNext: Readonly<Ref<boolean>>;
  /** 打开灯箱 */
  openLightbox: (meta: ImageMeta) => Promise<void>;
  /** 灯箱导航 */
  handleLightboxNavigate: (direction: 'prev' | 'next') => Promise<void>;
  /** 灯箱内删除 */
  handleLightboxDelete: (item: HistoryItem) => Promise<void>;
}

export function useFavoritesLightbox(params: UseFavoritesLightboxParams): UseFavoritesLightboxReturn {
  const { favoriteMetas, getDetail, deleteHistoryItem, hasMore, loadNext } = params;
  const toast = useToast();

  const lightboxVisible = ref(false);
  const lightboxItem = ref<HistoryItem | null>(null);

  const lightboxIndex = computed(() => {
    if (!lightboxItem.value) return -1;
    return favoriteMetas.value.findIndex(m => m.id === lightboxItem.value!.id);
  });

  const lightboxHasPrev = computed(() => lightboxIndex.value > 0);
  const lightboxHasNext = computed(() => {
    const idx = lightboxIndex.value;
    if (idx < 0) return false;
    // 本地已有下一项
    if (idx < favoriteMetas.value.length - 1) return true;
    // 本地到底了但服务端还有
    return hasMore?.value === true;
  });

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
    const nextIdx = lightboxIndex.value + (direction === 'prev' ? -1 : 1);
    if (nextIdx < 0) return;

    // 向后导航接近尾部时，异步触发加载下一页（不阻塞当前翻页）
    if (
      direction === 'next'
      && hasMore?.value === true
      && loadNext
      && nextIdx >= favoriteMetas.value.length - NEAR_END_THRESHOLD
    ) {
      void loadNext();
    }

    // 如果当前已超出本地加载范围，等待一次加载后再决定
    if (nextIdx >= favoriteMetas.value.length) {
      if (hasMore?.value === true && loadNext) {
        await loadNext();
      }
      if (nextIdx >= favoriteMetas.value.length) return;
    }

    try {
      lightboxItem.value = await getDetail(favoriteMetas.value[nextIdx].id);
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
