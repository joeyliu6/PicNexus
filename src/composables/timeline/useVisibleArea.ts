/**
 * 可见区域计算模块
 * 负责 visibleRowRange、visibleItems、visibleHeaders、currentStickyHeader 等可见区域相关逻辑
 */

import { computed, type Ref } from 'vue';
import {
  getVisibleRowRange,
  getCurrentStickyHeader,
  type TimelineLayoutResult,
} from '../../utils/justifiedLayout';
import type { ImageMeta } from '../../types/image-meta';
import type { PhotoGroup, VisibleItem, VisibleHeader, VirtualTimelineOptions } from './types';
import { DEFAULT_OPTIONS } from './types';

/**
 * 可见区域计算 Composable
 *
 * @param scrollTop 滚动位置 ref
 * @param viewportHeight 视口高度 ref
 * @param containerWidth 容器宽度 ref（用于 scrollProgress）
 * @param layoutResult 布局结果 ref
 * @param groups 图片分组数据
 * @param containerRef 滚动容器 ref（用于 scrollProgress）
 * @param options 配置选项
 */
export function useVisibleArea(
  scrollTop: Ref<number>,
  viewportHeight: Ref<number>,
  layoutResult: Ref<TimelineLayoutResult | null>,
  groups: Ref<PhotoGroup[]>,
  containerRef: Ref<HTMLElement | null>,
  options: Required<VirtualTimelineOptions> = DEFAULT_OPTIONS
) {
  const config = options;

  /** 可见行范围 */
  const visibleRowRange = computed<[number, number]>(() => {
    if (!layoutResult.value || layoutResult.value.allRows.length === 0) {
      return [0, 0];
    }

    return getVisibleRowRange(
      layoutResult.value.allRows,
      scrollTop.value,
      viewportHeight.value,
      config.overscan
    );
  });

  /**
   * ID -> ImageMeta 映射（缓存）
   * 只在 groups 变化时重建，避免每次滚动都遍历
   */
  const itemMap = computed(() => {
    const map = new Map<string, ImageMeta>();
    for (const group of groups.value) {
      for (const meta of group.items) {
        map.set(meta.id, meta);
      }
    }
    return map;
  });

  /** 可见的图片列表 */
  const visibleItems = computed<VisibleItem[]>(() => {
    if (!layoutResult.value) return [];

    const [startIndex, endIndex] = visibleRowRange.value;
    const result: VisibleItem[] = [];

    // 使用缓存的 itemMap，不再每次重建
    const map = itemMap.value;

    // 收集可见行的所有图片
    for (let i = startIndex; i < endIndex; i++) {
      const rowData = layoutResult.value.allRows[i];
      if (!rowData) continue;

      for (const layoutItem of rowData.row.items) {
        const imageMeta = map.get(layoutItem.id);
        if (imageMeta) {
          result.push({
            meta: imageMeta,
            x: layoutItem.x,
            y: layoutItem.y,
            width: layoutItem.width,
            height: layoutItem.height,
            groupId: rowData.groupId,
          });
        }
      }
    }

    return result;
  });

  /** 可见的分组头部 */
  const visibleHeaders = computed<VisibleHeader[]>(() => {
    if (!layoutResult.value) return [];

    const viewTop = scrollTop.value - config.headerHeight; // 提前一个头部高度开始
    const viewBottom = scrollTop.value + viewportHeight.value + config.headerHeight;

    const result: VisibleHeader[] = [];

    for (const group of layoutResult.value.groupLayouts) {
      // 头部在可见范围内
      if (group.headerY < viewBottom && group.headerY + group.headerHeight > viewTop) {
        result.push({
          groupId: group.groupId,
          label: group.label,
          y: group.headerY,
          height: group.headerHeight,
        });
      }

      // 内容区域在可见范围内（确保头部也显示）
      const contentEnd = group.contentY + group.contentHeight;
      if (group.contentY < viewBottom && contentEnd > viewTop) {
        // 头部可能已添加，检查是否重复
        if (!result.find((h) => h.groupId === group.groupId)) {
          result.push({
            groupId: group.groupId,
            label: group.label,
            y: group.headerY,
            height: group.headerHeight,
          });
        }
      }
    }

    return result;
  });

  /** 当前粘性头部 */
  const currentStickyHeader = computed(() => {
    if (!layoutResult.value) return null;
    return getCurrentStickyHeader(layoutResult.value.groupLayouts, scrollTop.value);
  });

  /** 总高度（用于滚动容器） */
  const totalHeight = computed(() => layoutResult.value?.totalHeight || 0);

  /** 滚动进度 (0-1) */
  const scrollProgress = computed(() => {
    if (!containerRef.value || totalHeight.value <= viewportHeight.value) {
      return 0;
    }
    const maxScroll = totalHeight.value - viewportHeight.value;
    return Math.min(1, Math.max(0, scrollTop.value / maxScroll));
  });

  /**
   * 当前视口内可见的 dayKey 集合
   * 仅返回内容区域与视口有重叠的 group id（即 dayKey）。
   * TimelineView 在此基础上扩展前后缓冲后调用 ensureDaysLoaded。
   */
  const visibleDayKeys = computed<string[]>(() => {
    if (!layoutResult.value) return [];
    const viewTop = scrollTop.value;
    const viewBottom = scrollTop.value + viewportHeight.value;

    return layoutResult.value.groupLayouts
      .filter(g => g.contentY < viewBottom && g.contentY + g.contentHeight > viewTop)
      .map(g => g.groupId);
  });

  return {
    visibleRowRange,
    visibleItems,
    visibleHeaders,
    currentStickyHeader,
    totalHeight,
    scrollProgress,
    visibleDayKeys,
  };
}
