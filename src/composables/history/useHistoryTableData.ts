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

interface TablePageResult {
  items: HistoryItem[];
  total: number;
}

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
  const pageCache = new Map<string, TablePageResult>();

  function getPageCacheKey(pageNumber: number): string {
    return [
      filter.value,
      searchTerm.value?.trim() ?? '',
      pageSize.value,
      pageNumber,
    ].join('\u0000');
  }

  function clearPageCache(): void {
    pageCache.clear();
  }

  async function fetchPage(pageNumber: number): Promise<TablePageResult> {
    const hasSearch = searchTerm.value?.trim();

    if (hasSearch) {
      return historyManager.searchHistory(searchTerm.value, {
        serviceFilter: filter.value === 'all' ? undefined : filter.value,
        limit: pageSize.value,
        offset: (pageNumber - 1) * pageSize.value,
      });
    }

    return historyManager.loadPageByNumber(
      pageNumber, pageSize.value, filter.value,
    );
  }

  async function peekPage(pageNumber: number): Promise<TablePageResult> {
    const target = Math.max(1, Math.min(pageNumber, totalPages.value));
    const key = getPageCacheKey(target);
    const cached = pageCache.get(key);
    if (cached) return cached;

    const result = await fetchPage(target);
    pageCache.set(key, result);
    return result;
  }

  async function loadCurrentPage() {
    const version = ++loadVersion;
    try {
      isLoadingPage.value = true;
      const result = await peekPage(currentPage.value);

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

  const totalPages = computed(() =>
    Math.max(1, Math.ceil(totalRecords.value / pageSize.value))
  );

  /**
   * 程序化翻页（灯箱跨页驱动用）。
   * 返回加载完成的 Promise，以便调用方在新页就绪后落位 lightboxItem。
   * 与 onPageChange 不同：不守卫 isLoadingPage（顺序 await 即可串行，
   * 避免在"灯箱触发加载"与 PrimeVue Paginator 点击冲突时静默忽略导航意图）。
   */
  async function goToPage(pageNumber: number): Promise<void> {
    const target = Math.max(1, Math.min(pageNumber, totalPages.value));
    if (target === currentPage.value) return;
    currentPage.value = target;
    first.value = (target - 1) * pageSize.value;
    await loadCurrentPage();
  }

  // ---- 生命周期 ----
  let unlistenUpdated: (() => void) | null = null;
  let unlistenDeleted: (() => void) | null = null;
  let unlistenCleared: (() => void) | null = null;

  onMounted(async () => {
    [unlistenUpdated, unlistenDeleted, unlistenCleared] = await Promise.all([
      onCacheEventType('history-updated', () => {
        clearPageCache();
        currentPage.value = 1;
        first.value = 0;
        loadCurrentPage();
      }),
      onCacheEventType('history-deleted', () => {
        clearPageCache();
        loadCurrentPage();
      }),
      onCacheEventType('history-cleared', () => {
        clearPageCache();
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
    clearPageCache();
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
    totalPages,
    isLoadingPage,
    first,
    selectAll,
    skeletonData,
    isSkeleton,
    formatTime,
    loadCurrentPage,
    peekPage,
    onPageChange,
    goToPage,
    handleHeaderCheckboxChange,
    getSuccessfulServices,
    selectedAvailableServices,
  };
}
