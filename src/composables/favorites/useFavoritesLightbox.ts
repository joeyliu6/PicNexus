/**
 * useFavoritesLightbox - 收藏视图灯箱管理
 *
 * 公共部分（visible/item/showItem/deleteCurrent）由 useLightboxCore 提供，
 * 这里只关心收藏视图特有的「线性数组前后导航 + 分页加载」逻辑。
 */
import { computed, type Ref } from 'vue';
import { createLogger } from '../../utils/logger';
import { getPrimaryImageUrl } from '../../utils/imageUrl';
import type { ImageMeta } from '../../types/image-meta';
import type { HistoryItem, UserConfig } from '../../config/types';
import { useLightboxPreloader } from '../useLightboxPreloader';
import { useLightboxCore, type LightboxCoreApi } from '../common/useLightboxCore';

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
  /** 用户配置（用于解析图床 URL，给相邻图预加载用；测试场景可省略，省略时跳过预加载） */
  config?: Ref<UserConfig>;
}

export interface UseFavoritesLightboxReturn {
  /** 灯箱是否可见 */
  lightboxVisible: LightboxCoreApi['lightboxVisible'];
  /** 灯箱当前项 */
  lightboxItem: LightboxCoreApi['lightboxItem'];
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
  const { favoriteMetas, getDetail, deleteHistoryItem, hasMore, loadNext, config } = params;
  const core = useLightboxCore({ silentLoadError: true });

  const lightboxIndex = computed(() => {
    if (!core.lightboxItem.value) return -1;
    return favoriteMetas.value.findIndex(m => m.id === core.lightboxItem.value!.id);
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

  // 双向 ±1 预加载：监听 lightboxItem 变化、防抖后并发预热前后两张大图
  useLightboxPreloader({
    currentItemId: computed(() => core.lightboxItem.value?.id ?? null),
    resolveAdjacentUrl: async (direction) => {
      if (!config) return null; // 测试场景未注入 config，安全地跳过预加载
      const idx = lightboxIndex.value;
      if (idx < 0) return null;
      const targetIdx = direction === 'prev' ? idx - 1 : idx + 1;
      const meta = favoriteMetas.value[targetIdx];
      if (!meta) return null;
      const detail = await getDetail(meta.id);
      return getPrimaryImageUrl(detail, config.value) || null;
    },
  });

  const openLightbox = (meta: ImageMeta) => core.showItem(() => getDetail(meta.id));

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
      await core.loadItem(() => getDetail(favoriteMetas.value[nextIdx].id));
    } catch (e) {
      log.error('导航失败:', e);
    }
  };

  const handleLightboxDelete = (item: HistoryItem) =>
    core.deleteCurrent(item, deleteHistoryItem);

  return {
    lightboxVisible: core.lightboxVisible,
    lightboxItem: core.lightboxItem,
    lightboxHasPrev,
    lightboxHasNext,
    openLightbox,
    handleLightboxNavigate,
    handleLightboxDelete,
  };
}
