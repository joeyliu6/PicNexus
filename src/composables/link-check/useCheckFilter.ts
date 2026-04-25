import { computed, ref, shallowRef, watch, type Ref } from 'vue';
import { watchDebounced } from '@vueuse/core';
import type { LinkCheckRow, StatusFilter } from '../../types/linkCheck';
import { SEVERITY } from '../../types/linkCheck';
import { shiftSelect, type ShiftSelectAnchor } from '../../utils/shiftSelect';

const PAGE_SIZE = 100;

interface UseCheckFilterOptions {
  checkRows: Ref<LinkCheckRow[]>;
  /** 是否正在批量检测——为 true 时冻结 filteredRows 集合，避免行因状态实时变化而消失/重排 */
  isChecking?: Ref<boolean>;
}

export function rowKey(row: Pick<LinkCheckRow, 'historyId' | 'serviceId'>): string {
  return `${row.historyId}|${row.serviceId}`;
}

function matchesStatusFilter(row: LinkCheckRow, filter: StatusFilter): boolean {
  const result = row.checkResult;
  switch (filter) {
    case null:
      return result != null && !result.is_valid;
    case 'invalid':
      return result != null
        && !result.is_valid
        && result.error_type !== 'timeout'
        && result.error_type !== 'suspicious'
        && !result.browser_might_work;
    case 'suspicious':
      return result?.error_type === 'suspicious' || result?.browser_might_work === true;
    case 'timeout':
      return result?.error_type === 'timeout';
    case 'unchecked':
      return !result;
    case 'valid':
      return result?.is_valid === true;
    case 'all':
      return true;
    default:
      return true;
  }
}

export function useCheckFilter({ checkRows, isChecking }: UseCheckFilterOptions) {
  const statusFilter = ref<StatusFilter>('invalid');
  const selectedServiceId = ref<string | null>(null);
  const showServiceMenu = ref(false);
  const searchInput = ref('');
  const searchQuery = ref('');
  const currentPage = ref(1);
  const pageByFilter = new Map<StatusFilter, number>();
  const searchFocused = ref(false);

  const selectedIds = ref<Set<string>>(new Set());
  const selectAnchor = ref<ShiftSelectAnchor>({ lastId: null, wasSelect: true });

  function resetPageState(): void {
    pageByFilter.clear();
    currentPage.value = 1;
  }

  /**
   * 视图作用域变化（切 statusFilter / 切图床 / 改搜索）时清空选择
   * 否则跨 tab 残留的 selectedIds 会让「重检/复制/删除选中」操作到用户看不见的行——
   * 尤其批量删除会误删另一个 tab 里的不可见选中行
   */
  function resetSelectionOnScopeChange(): void {
    if (selectedIds.value.size > 0) {
      selectedIds.value = new Set();
      selectAnchor.value = { lastId: null, wasSelect: true };
    }
  }

  watch(selectedServiceId, () => {
    resetPageState();
    resetSelectionOnScopeChange();
  });
  watchDebounced(
    searchInput,
    (value) => {
      searchQuery.value = value;
      resetPageState();
      resetSelectionOnScopeChange();
    },
    { debounce: 200 },
  );
  watch(statusFilter, (nextFilter, previousFilter) => {
    pageByFilter.set(previousFilter!, currentPage.value);
    currentPage.value = pageByFilter.get(nextFilter!) ?? 1;
    resetSelectionOnScopeChange();
  });

  const scopedRows = computed(() => {
    let rows = checkRows.value;

    if (selectedServiceId.value) {
      rows = rows.filter((row) => row.serviceId === selectedServiceId.value);
    }

    const query = searchQuery.value.trim().toLowerCase();
    if (query) {
      rows = rows.filter((row) =>
        row.url.toLowerCase().includes(query)
        || row.fileName.toLowerCase().includes(query)
        || row.serviceId.toLowerCase().includes(query),
      );
    }

    return rows;
  });

  /**
   * 检测期间冻结的可见集合 snapshot。
   * 进入检测时记录当时的 filteredRows，期间不再重新过滤/重排——
   * 即使行的 checkResult 实时变化（chips/徽章自动响应），列表行不会消失或乱序。
   */
  const lockedFilteredRows = shallowRef<LinkCheckRow[] | null>(null);

  function liveFilter(): LinkCheckRow[] {
    return scopedRows.value
      .filter((row) => {
        if (row.fadingOut) return true;
        if (row.recheckResult) return true;
        return matchesStatusFilter(row, statusFilter.value);
      })
      .slice()
      .sort((left, right) =>
        (left.pinnedSortWeight ?? SEVERITY[left.checkResult?.error_type ?? 'success'] ?? 5)
        - (right.pinnedSortWeight ?? SEVERITY[right.checkResult?.error_type ?? 'success'] ?? 5),
      );
  }

  const filteredRows = computed(() => lockedFilteredRows.value ?? liveFilter());

  if (isChecking) {
    watch(isChecking, (now, prev) => {
      if (now && !prev) {
        // 进入检测：冻结当时的可见集合（数组按值 snapshot，row 对象身份保留以便实时响应 mutation）
        lockedFilteredRows.value = liveFilter();
      } else if (!now && prev) {
        // 退出检测：解冻，恢复实时过滤
        lockedFilteredRows.value = null;
      }
    });
    // 检测期间用户主动改 filter/服务/搜索 时手动刷一次 snapshot——
    // 冻结只锁"行因 checkResult 变化而消失/重排"，不锁用户主观切换的视图
    watch([statusFilter, selectedServiceId, searchQuery], () => {
      if (isChecking.value) lockedFilteredRows.value = liveFilter();
    });
  }

  const totalPages = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / PAGE_SIZE)));
  watch(totalPages, (nextTotal) => {
    if (currentPage.value > nextTotal) currentPage.value = nextTotal;
  });

  const visibleRows = computed(() => {
    const start = (currentPage.value - 1) * PAGE_SIZE;
    return filteredRows.value.slice(start, start + PAGE_SIZE);
  });

  const pageInput = ref(String(currentPage.value));
  watch(currentPage, (value) => {
    pageInput.value = String(value);
  });

  const bottomSummary = computed(() => {
    const count = filteredRows.value.length;
    if (count === 0) return '';
    return `共 ${count.toLocaleString()} 条`;
  });

  function handlePageInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    const value = parseInt(raw, 10);
    currentPage.value = !raw || Number.isNaN(value) || value < 1
      ? 1
      : Math.min(value, totalPages.value);
    pageInput.value = String(currentPage.value);
  }

  const hasSelection = computed(() => selectedIds.value.size > 0);
  const filteredRowKeys = computed(() => filteredRows.value.map(rowKey));
  const isAllSelected = computed(() =>
    filteredRowKeys.value.length > 0
    && filteredRowKeys.value.every((key) => selectedIds.value.has(key)),
  );
  const selectedCount = computed(() => selectedIds.value.size);

  function handleToggleSelect(key: string, event: MouseEvent): void {
    const result = shiftSelect(
      key,
      event.shiftKey,
      filteredRowKeys.value,
      selectedIds.value,
      selectAnchor.value,
    );
    selectedIds.value = result.nextSet;
    selectAnchor.value = result.anchor;
  }

  function toggleSelectAll(): void {
    selectedIds.value = isAllSelected.value
      ? new Set()
      : new Set(filteredRowKeys.value);
  }

  function clearSelection(): void {
    selectedIds.value = new Set();
    selectAnchor.value = { lastId: null, wasSelect: true };
  }

  return {
    statusFilter,
    selectedServiceId,
    showServiceMenu,
    searchInput,
    searchQuery,
    searchFocused,
    scopedRows,
    filteredRows,
    visibleRows,
    currentPage,
    totalPages,
    pageInput,
    handlePageInput,
    bottomSummary,
    selectedIds,
    hasSelection,
    selectedCount,
    isAllSelected,
    handleToggleSelect,
    toggleSelectAll,
    clearSelection,
  };
}
