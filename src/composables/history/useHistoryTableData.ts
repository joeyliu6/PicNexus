/**
 * useHistoryTableData — 历史表格的数据加载、分页、生命周期
 * 从 HistoryTableView.vue 提取
 */
import { ref, shallowRef, computed, nextTick, onMounted, onUnmounted, watch, type Ref } from 'vue';
import type { HistoryItem, ServiceType } from '../../config/types';
import { useHistoryManager } from '../useHistory';
import { useHistoryViewState } from '../useHistoryViewState';
import { useToast } from '../useToast';
import { onCacheEventType } from '../../events/cacheEvents';
import { createLogger } from '../../utils/logger';
import { formatTime, getSuccessfulServices } from '../../utils/formatters';

interface SkeletonItem {
  id: string;
  _skeleton: true;
}

const DEFAULT_SKELETON_COUNT = 20;

function generateSkeletonData(count: number): SkeletonItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `skeleton-${i}`,
    _skeleton: true as const,
  }));
}

export function isSkeleton(data: HistoryItem | SkeletonItem): data is SkeletonItem {
  return '_skeleton' in data && data._skeleton === true;
}

interface UseHistoryTableDataOptions {
  filter: Ref<ServiceType | 'all'>;
  searchTerm: Ref<string>;
  onPageLoaded?: () => void;
  viewState?: ReturnType<typeof useHistoryViewState>;
}

const log = createLogger('HistoryTableData');

export function useHistoryTableData({ filter, searchTerm, onPageLoaded, viewState: externalViewState }: UseHistoryTableDataOptions) {
  const toast = useToast();
  const historyManager = useHistoryManager();
  const viewState = externalViewState ?? useHistoryViewState();

  const currentPageData = shallowRef<HistoryItem[]>([]);
  const currentPage = ref(1);
  // 50 是性能/UX 折中点：一屏可见 ~15 行，Chromium native lazy 边距覆盖剩余 35 行
  // flushJobs / SVG 解析 / 图像解码全部线性减半（详见性能调优记录）
  const pageSize = ref(50);
  const totalRecords = ref(0);
  const isLoadingPage = ref(true);
  const first = ref(0);
  const selectAll = ref(false);

  const skeletonData = computed(() => {
    if (totalRecords.value > 0) {
      const remaining = totalRecords.value - (currentPage.value - 1) * pageSize.value;
      return generateSkeletonData(Math.min(pageSize.value, remaining));
    }
    return generateSkeletonData(DEFAULT_SKELETON_COUNT);
  });

  let loadVersion = 0;

  async function loadCurrentPage() {
    const version = ++loadVersion;
    try {
      isLoadingPage.value = true;
      const hasSearch = searchTerm.value?.trim();

      let result: { items: HistoryItem[]; total: number };
      if (hasSearch) {
        result = await historyManager.searchHistory(searchTerm.value, {
          serviceFilter: filter.value === 'all' ? undefined : filter.value,
          limit: pageSize.value,
          offset: (currentPage.value - 1) * pageSize.value,
        });
      } else {
        result = await historyManager.loadPageByNumber(
          currentPage.value, pageSize.value, filter.value,
        );
      }

      if (version !== loadVersion) return;
      currentPageData.value = result.items;
      totalRecords.value = result.total;
    } catch (error) {
      if (version !== loadVersion) return;
      log.error('加载失败', error);
      toast.error('加载失败', String(error));
      currentPageData.value = [];
      totalRecords.value = 0;
    } finally {
      if (version === loadVersion) {
        isLoadingPage.value = false;
        nextTick(() => onPageLoaded?.());
      }
    }
  }

  function onPageChange(event: { page: number; first: number; rows: number }) {
    if (isLoadingPage.value) return;
    currentPage.value = event.page + 1;
    first.value = event.first;
    loadCurrentPage();
  }

  // ---- 生命周期 ----
  let unlistenUpdated: (() => void) | null = null;
  let unlistenDeleted: (() => void) | null = null;
  let unlistenCleared: (() => void) | null = null;

  onMounted(async () => {
    [unlistenUpdated, unlistenDeleted, unlistenCleared] = await Promise.all([
      onCacheEventType('history-updated', () => {
        currentPage.value = 1;
        first.value = 0;
        loadCurrentPage();
      }),
      onCacheEventType('history-deleted', () => {
        loadCurrentPage();
      }),
      onCacheEventType('history-cleared', () => {
        currentPage.value = 1;
        first.value = 0;
        loadCurrentPage();
      }),
    ]);
    await loadCurrentPage();
  });

  onUnmounted(() => {
    unlistenUpdated?.();
    unlistenDeleted?.();
    unlistenCleared?.();
  });

  watch([filter, searchTerm], () => {
    currentPage.value = 1;
    first.value = 0;
    viewState.clearSelection();
    loadCurrentPage();
  });

  // 全选联动
  watch(() => {
    if (currentPageData.value.length === 0) return false;
    return currentPageData.value.every((item) => viewState.isSelected(item.id));
  }, (allSelected) => {
    selectAll.value = allSelected;
  });

  function handleHeaderCheckboxChange(checked: boolean) {
    selectAll.value = checked;
    currentPageData.value.forEach((item) => {
      if (checked) viewState.select(item.id);
      else viewState.deselect(item.id);
    });
  }


  // 跨页服务缓存：记录每个已加载条目的成功图床，翻页后仍能保留跨页选中的服务信息
  // 注：总是覆盖。迁移/救援等操作会更新同 id 的 results 字段，守卫式去重会导致缓存过期
  const itemServiceCache = new Map<string, string[]>();
  watch(currentPageData, (pageData) => {
    for (const item of pageData) {
      itemServiceCache.set(item.id, getSuccessfulServices(item));
    }
  });

  // 返回带覆盖计数的图床列表，保持配置顺序（避免因选中量变化导致顺序突变困惑用户）
  const selectedAvailableServices = computed<{ serviceId: ServiceType; count: number }[]>(() => {
    const ids = viewState.selectedIdList.value;
    if (ids.length === 0) return [];
    const serviceCountMap = new Map<string, number>();
    for (const id of ids) {
      const services = itemServiceCache.get(id);
      if (services) {
        for (const s of services) {
          serviceCountMap.set(s, (serviceCountMap.get(s) ?? 0) + 1);
        }
      }
    }
    return Array.from(serviceCountMap.entries()).map(([serviceId, count]) => ({
      serviceId: serviceId as ServiceType,
      count,
    }));
  });

  return {
    currentPageData,
    currentPage,
    pageSize,
    totalRecords,
    isLoadingPage,
    first,
    selectAll,
    skeletonData,
    isSkeleton,
    formatTime,
    loadCurrentPage,
    onPageChange,
    handleHeaderCheckboxChange,
    getSuccessfulServices,
    selectedAvailableServices,
  };
}
