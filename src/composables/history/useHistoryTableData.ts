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
}

const log = createLogger('HistoryTableData');

export function useHistoryTableData({ filter, searchTerm, onPageLoaded }: UseHistoryTableDataOptions) {
  const toast = useToast();
  const historyManager = useHistoryManager();
  const viewState = useHistoryViewState();

  const currentPageData = shallowRef<HistoryItem[]>([]);
  const currentPage = ref(1);
  const pageSize = ref(100);
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

  async function loadCurrentPage() {
    try {
      isLoadingPage.value = true;
      const hasSearch = searchTerm.value?.trim();

      if (hasSearch) {
        const result = await historyManager.searchHistory(searchTerm.value, {
          serviceFilter: filter.value === 'all' ? undefined : filter.value,
          limit: pageSize.value,
          offset: (currentPage.value - 1) * pageSize.value,
        });
        currentPageData.value = result.items;
        totalRecords.value = result.total;
      } else {
        const result = await historyManager.loadPageByNumber(
          currentPage.value, pageSize.value, filter.value,
        );
        currentPageData.value = result.items;
        totalRecords.value = result.total;
      }
    } catch (error) {
      log.error('加载失败', error);
      toast.error('加载失败', String(error));
      currentPageData.value = [];
      totalRecords.value = 0;
    } finally {
      isLoadingPage.value = false;
      nextTick(() => onPageLoaded?.());
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

  onMounted(async () => {
    unlistenUpdated = await onCacheEventType('history-updated', () => {
      currentPage.value = 1;
      first.value = 0;
      loadCurrentPage();
    });
    unlistenDeleted = await onCacheEventType('history-deleted', () => {
      loadCurrentPage();
    });
    await loadCurrentPage();
  });

  onUnmounted(() => {
    unlistenUpdated?.();
    unlistenDeleted?.();
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


  const selectedAvailableServices = computed<ServiceType[]>(() => {
    const ids = viewState.selectedIdList.value;
    if (ids.length === 0) return [];
    const idSet = new Set(ids);
    const serviceSet = new Set<ServiceType>();
    for (const item of currentPageData.value) {
      if (!idSet.has(item.id)) continue;
      for (const r of item.results) {
        if (r.status === 'success') serviceSet.add(r.serviceId as ServiceType);
      }
    }
    return Array.from(serviceSet);
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
