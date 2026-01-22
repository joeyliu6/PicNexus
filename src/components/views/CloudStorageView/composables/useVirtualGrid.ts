// 虚拟滚动网格核心逻辑

import { ref, computed, watch, onMounted, onUnmounted, type Ref } from 'vue';
import { DEFAULT_VIRTUAL_GRID_CONFIG, type VirtualGridConfig, type ViewMode } from '../types';

export interface VirtualGridOptions<T> {
  /** 数据项列表 */
  items: Ref<T[]>;
  /** 容器元素引用 */
  containerRef: Ref<HTMLElement | null>;
  /** 配置项（可选，使用默认值） */
  config?: Partial<VirtualGridConfig>;
  /** 视图模式 */
  viewMode?: Ref<ViewMode>;
}

export interface VirtualGridReturn<T> {
  /** 可见项列表（带位置信息） */
  visibleItems: Ref<Array<{ item: T; index: number; style: Record<string, string> }>>;
  /** 内容区域总高度 */
  totalHeight: Ref<number>;
  /** 每行列数 */
  columns: Ref<number>;
  /** 当前项目宽度 */
  currentItemWidth: Ref<number>;
  /** 当前项目高度 */
  currentItemHeight: Ref<number>;
  /** 滚动处理函数 */
  onScroll: (e: Event) => void;
  /** 重新计算布局 */
  recalculate: () => void;
}

export function useVirtualGrid<T>(options: VirtualGridOptions<T>): VirtualGridReturn<T> {
  const { items, containerRef, config: customConfig, viewMode } = options;

  // 合并配置
  const config = { ...DEFAULT_VIRTUAL_GRID_CONFIG, ...customConfig };
  const { itemWidth, itemHeight, gap, overscan } = config;

  // 列表模式配置
  const LIST_ITEM_HEIGHT = 56;

  // 内部状态
  const scrollTop = ref(0);
  const containerWidth = ref(0);
  const containerHeight = ref(0);

  // 当前项目尺寸（根据视图模式动态计算）
  const currentItemWidth = computed(() => {
    if (viewMode?.value === 'list') {
      return containerWidth.value - gap * 2;
    }
    return itemWidth;
  });

  const currentItemHeight = computed(() => {
    if (viewMode?.value === 'list') {
      return LIST_ITEM_HEIGHT;
    }
    return itemHeight;
  });

  // 计算每行列数
  const columns = computed(() => {
    if (viewMode?.value === 'list') {
      return 1;
    }
    if (containerWidth.value === 0) return 1;
    const availableWidth = containerWidth.value;
    const cols = Math.floor((availableWidth + gap) / (itemWidth + gap));
    return Math.max(1, cols);
  });

  // 计算总行数
  const totalRows = computed(() => Math.ceil(items.value.length / columns.value));

  // 计算内容区域总高度
  const totalHeight = computed(() => {
    if (totalRows.value === 0) return 0;
    return totalRows.value * (currentItemHeight.value + gap) - gap;
  });

  // 计算可见行范围
  const visibleRange = computed(() => {
    const rowHeight = currentItemHeight.value + gap;
    const startRow = Math.max(0, Math.floor(scrollTop.value / rowHeight) - overscan);
    const visibleRows = Math.ceil(containerHeight.value / rowHeight) + overscan * 2;
    const endRow = Math.min(totalRows.value - 1, startRow + visibleRows);

    return { startRow, endRow };
  });

  // 计算可见项（带位置样式）
  const visibleItems = computed(() => {
    const { startRow, endRow } = visibleRange.value;
    const result: Array<{ item: T; index: number; style: Record<string, string> }> = [];
    const effectiveItemWidth = currentItemWidth.value;
    const effectiveItemHeight = currentItemHeight.value;

    for (let row = startRow; row <= endRow; row++) {
      for (let col = 0; col < columns.value; col++) {
        const index = row * columns.value + col;
        if (index >= items.value.length) break;

        const item = items.value[index];
        const left = viewMode?.value === 'list' ? gap : col * (itemWidth + gap);
        const top = row * (effectiveItemHeight + gap);

        result.push({
          item,
          index,
          style: {
            position: 'absolute',
            left: `${left}px`,
            top: `${top}px`,
            width: `${effectiveItemWidth}px`,
            height: `${effectiveItemHeight}px`,
          },
        });
      }
    }

    return result;
  });

  // 滚动处理
  const onScroll = (e: Event) => {
    const target = e.target as HTMLElement;
    scrollTop.value = target.scrollTop;
  };

  // 重新计算容器尺寸
  const recalculate = () => {
    if (!containerRef.value) return;
    containerWidth.value = containerRef.value.clientWidth;
    containerHeight.value = containerRef.value.clientHeight;
  };

  // ResizeObserver 监听容器尺寸变化
  let resizeObserver: ResizeObserver | null = null;

  onMounted(() => {
    recalculate();

    if (containerRef.value) {
      resizeObserver = new ResizeObserver(() => {
        recalculate();
      });
      resizeObserver.observe(containerRef.value);
    }
  });

  onUnmounted(() => {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  });

  // 监听容器引用变化
  watch(containerRef, (newRef) => {
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
    if (newRef) {
      recalculate();
      resizeObserver = new ResizeObserver(() => {
        recalculate();
      });
      resizeObserver.observe(newRef);
    }
  });

  return {
    visibleItems,
    totalHeight,
    columns,
    currentItemWidth,
    currentItemHeight,
    onScroll,
    recalculate,
  };
}
