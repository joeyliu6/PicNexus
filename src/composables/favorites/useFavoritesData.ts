/**
 * useFavoritesData - 收藏数据过滤、缩略图状态、增量渲染
 *
 * 从 FavoritesView.vue 提取，管理：
 * - favoriteMetas 计算属性（基于 favoriteSet 过滤）
 * - imageStates 图片加载状态追踪
 * - 增量渲染（renderLimit / renderedMetas / hasMore）
 * - 滚动加载更多
 */
import { ref, computed, watch, reactive, onUnmounted, type Ref, type ComputedRef } from 'vue';
import { getMetaThumbnailUrl } from '../useThumbCache';
import type { ImageMeta } from '../../types/image-meta';
import type { UserConfig } from '../../config/types';

/** 每批渲染数量 */
const RENDER_CHUNK_SIZE = 80;

interface UseFavoritesDataParams {
  /** 过滤后的全量元数据 */
  filteredMetas: ComputedRef<ImageMeta[]>;
  /** 收藏 ID 集合 */
  favoriteSet: Ref<Set<string>>;
  /** 滚动容器 ref */
  scrollContainerRef: Ref<HTMLElement | null>;
  /** 配置对象（用于生成缩略图 URL） */
  config: Ref<UserConfig>;
}

export interface UseFavoritesDataReturn {
  /** 收藏元数据列表 */
  favoriteMetas: ComputedRef<ImageMeta[]>;
  /** 实际渲染的元数据（增量渲染） */
  renderedMetas: ComputedRef<ImageMeta[]>;
  /** 是否还有未渲染的数据 */
  hasMore: ComputedRef<boolean>;
  /** 图片加载状态 */
  imageStates: Record<string, 'loading' | 'loaded' | 'failed'>;
  /** 生成缩略图 URL */
  getThumbnailUrl: (meta: ImageMeta) => string;
  /** 滚动加载更多处理函数 */
  onFavoritesScroll: () => void;
}

export function useFavoritesData(params: UseFavoritesDataParams): UseFavoritesDataReturn {
  const { filteredMetas, favoriteSet, scrollContainerRef, config } = params;

  // 图片加载状态追踪（响应式对象，Vue 3 Proxy 自动追踪属性增删）
  const imageStates = reactive<Record<string, 'loading' | 'loaded' | 'failed'>>({});

  // === 增量渲染：避免大量收藏时 DOM 爆炸 ===
  const renderLimit = ref(RENDER_CHUNK_SIZE);
  let scrollRafId = 0;

  // 收藏列表（基于独立 favoriteSet 过滤，避免依赖 imageMetas 的 isFavorited 属性）
  const favoriteMetas = computed<ImageMeta[]>(() => {
    const favSet = favoriteSet.value;
    return filteredMetas.value.filter(m => favSet.has(m.id));
  });

  // 实际渲染的收藏列表（增量渲染，避免一次性创建数千个 DOM 节点）
  const renderedMetas = computed<ImageMeta[]>(() => {
    return favoriteMetas.value.slice(0, renderLimit.value);
  });

  // 是否还有未渲染的数据
  const hasMore = computed(() => renderLimit.value < favoriteMetas.value.length);

  /**
   * 滚动到底部时加载更多
   */
  function onFavoritesScroll(): void {
    cancelAnimationFrame(scrollRafId);
    scrollRafId = requestAnimationFrame(() => {
      const el = scrollContainerRef.value;
      if (!el || !hasMore.value) return;
      // 距离底部 300px 时加载下一批
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) {
        renderLimit.value += RENDER_CHUNK_SIZE;
      }
    });
  }

  // 当收藏数据源变化时（筛选、取消收藏等），重置渲染窗口
  watch(favoriteMetas, () => {
    renderLimit.value = RENDER_CHUNK_SIZE;
    // 清理不再存在的图片状态，防止内存泄漏
    const currentIds = new Set(favoriteMetas.value.map(m => m.id));
    for (const key of Object.keys(imageStates)) {
      if (!currentIds.has(key)) {
        delete imageStates[key];
      }
    }
  });

  function getThumbnailUrl(meta: ImageMeta): string {
    return getMetaThumbnailUrl(meta, config.value);
  }

  onUnmounted(() => {
    cancelAnimationFrame(scrollRafId);
  });

  return {
    favoriteMetas,
    renderedMetas,
    hasMore,
    imageStates,
    getThumbnailUrl,
    onFavoritesScroll,
  };
}
