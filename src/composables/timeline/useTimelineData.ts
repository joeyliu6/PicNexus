/**
 * 时间线核心数据 Composable
 * 管理分组数据、缩略图 URL、选中服务、悬停详情等
 */
import { computed, shallowRef, type Ref, type ComputedRef } from 'vue';
import { getMetaThumbnailUrl } from '../../composables/useThumbCache';
import { createLogger } from '../../utils/logger';
import { type HistoryItem, type ServiceType, type UserConfig } from '../../config/types';
import type { ImageMeta } from '../../types/image-meta';
import type { PhotoGroup } from '../useVirtualTimeline';

const logger = createLogger('TimelineData');

interface UseTimelineDataOptions {
  /** 过滤后的元数据 */
  filteredMetas: ComputedRef<ImageMeta[]>;
  /** 收藏 ID 集合 */
  favoriteSet: Ref<Set<string>> | ComputedRef<Set<string>>;
  /** 是否仅显示收藏 */
  favoritesOnly: ComputedRef<boolean | undefined>;
  /** 选中的 ID 列表 */
  selectedIdList: ComputedRef<string[]>;
  /** 配置 */
  config: Ref<UserConfig>;
  /** 详情缓存 */
  detailCache: { getDetail: (id: string) => Promise<HistoryItem> };
  /** 切换收藏 */
  toggleFavorite: (id: string) => Promise<boolean | void>;
}

export function useTimelineData(options: UseTimelineDataOptions) {
  const {
    filteredMetas, favoriteSet, favoritesOnly, selectedIdList,
    config, detailCache, toggleFavorite,
  } = options;

  // ==================== 分组 ====================

  /** 按天分组图片元数据 */
  const groups = computed<PhotoGroup[]>(() => {
    let metas = filteredMetas.value;

    if (favoritesOnly.value) {
      const favSet = favoriteSet.value;
      metas = metas.filter(m => favSet.has(m.id));
    }

    const groupsMap = new Map<string, PhotoGroup>();

    metas.forEach((meta) => {
      const date = new Date(meta.timestamp);
      const year = date.getFullYear();
      const month = date.getMonth();
      const day = date.getDate();
      const id = `${year}-${month}-${day}`;

      if (!groupsMap.has(id)) {
        groupsMap.set(id, {
          id,
          label: `${year}年${month + 1}月${day}日`,
          year, month, day,
          date: new Date(year, month, day),
          items: [],
        });
      }
      groupsMap.get(id)?.items.push(meta);
    });

    return Array.from(groupsMap.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
  });

  // ==================== 工具函数 ====================

  function getThumbnailUrl(meta: ImageMeta): string {
    return getMetaThumbnailUrl(meta, config.value);
  }

  /** 从选中项提取可用图床（带覆盖计数） */
  const selectedAvailableServices = computed<{ serviceId: ServiceType; count: number }[]>(() => {
    const ids = selectedIdList.value;
    if (ids.length === 0) return [];
    const idSet = new Set(ids);
    const serviceCountMap = new Map<string, number>();
    for (const meta of filteredMetas.value) {
      if (idSet.has(meta.id)) {
        serviceCountMap.set(meta.primaryService, (serviceCountMap.get(meta.primaryService) ?? 0) + 1);
      }
    }
    return Array.from(serviceCountMap.entries()).map(([serviceId, count]) => ({
      serviceId: serviceId as ServiceType,
      count,
    }));
  });

  /** 切换收藏 */
  async function handleToggleFavorite(idOrItem: string | HistoryItem): Promise<void> {
    const id = typeof idOrItem === 'string' ? idOrItem : idOrItem.id;
    try {
      await toggleFavorite(id);
    } catch {
      // useHistory 内部已处理 toast 通知
    }
  }

  // ==================== 悬停详情 ====================

  const HOVER_CACHE_MAX = 200;
  const hoverDetailsMap = shallowRef(new Map<string, HistoryItem>());

  async function handleImageHover(meta: ImageMeta): Promise<void> {
    if (hoverDetailsMap.value.has(meta.id)) return;

    try {
      const detail = await detailCache.getDetail(meta.id);
      const newMap = new Map(hoverDetailsMap.value);
      newMap.set(meta.id, detail);
      // LRU 淘汰：超出上限时删除最早的条目
      if (newMap.size > HOVER_CACHE_MAX) {
        const firstKey = newMap.keys().next().value;
        if (firstKey !== undefined) newMap.delete(firstKey);
      }
      hoverDetailsMap.value = newMap;
    } catch (e) {
      logger.warn('悬停加载详情失败:', meta.id, e);
    }
  }

  return {
    groups,
    getThumbnailUrl,
    selectedAvailableServices,
    handleToggleFavorite,
    hoverDetailsMap,
    handleImageHover,
  };
}
