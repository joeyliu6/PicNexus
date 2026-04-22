import { computed, ref, watch, type Ref } from 'vue';
import { watchDebounced } from '@vueuse/core';
import type { LinkCheckRow, StatusFilter } from '../../types/linkCheck';
import { SEVERITY } from '../../types/linkCheck';
import { shiftSelect, type ShiftSelectAnchor } from '../../utils/shiftSelect';

const PAGE_SIZE = 100;

interface UseCheckFilterOptions {
  checkRows: Ref<LinkCheckRow[]>;
}

export function rowKey(row: Pick<LinkCheckRow, 'historyId' | 'serviceId'>): string {
  return `${row.historyId}|${row.serviceId}`;
}

function matchesStatusFilter(row: LinkCheckRow, filter: StatusFilter): boolean {
  if (filter === 'skipped') {
    return row.linkCheckSkip;
  }

  if (row.linkCheckSkip) {
    return false;
  }

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

export function useCheckFilter({ checkRows }: UseCheckFilterOptions) {
  const statusFilter = ref<StatusFilter>('invalid');
  const selectedServiceId = ref<string | null>(null);
  const showServiceMenu = ref(false);
  const searchInput = ref('');
  const searchQuery = ref('');
  const currentPage = ref(1);
  const pageByFilter = new Map<StatusFilter, number>();
  const showCheckMenu = ref(false);
  const searchFocused = ref(false);

  function resetPageState(): void {
    pageByFilter.clear();
    currentPage.value = 1;
  }

  watch(selectedServiceId, resetPageState);
  watchDebounced(
    searchInput,
    (value) => {
      searchQuery.value = value;
      resetPageState();
    },
    { debounce: 200 },
  );
  watch(statusFilter, (nextFilter, previousFilter) => {
    pageByFilter.set(previousFilter!, currentPage.value);
    currentPage.value = pageByFilter.get(nextFilter!) ?? 1;
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

  const filteredRows = computed(() => {
    const rows = scopedRows.value
      .filter((row) => {
        if (row.fadingOut) return true;
        if (row.recheckResult && statusFilter.value !== 'skipped') return !row.linkCheckSkip;
        return matchesStatusFilter(row, statusFilter.value);
      })
      .slice()
      .sort((left, right) =>
        (left.pinnedSortWeight ?? SEVERITY[left.checkResult?.error_type ?? 'success'] ?? 5)
        - (right.pinnedSortWeight ?? SEVERITY[right.checkResult?.error_type ?? 'success'] ?? 5),
      );

    return rows;
  });

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

  const selectedIds = ref<Set<string>>(new Set());
  const selectAnchor = ref<ShiftSelectAnchor>({ lastId: null, wasSelect: true });
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
    showCheckMenu,
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
