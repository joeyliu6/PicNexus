/**
 * useCheckFilter — 链接监控面板的筛选、分页、选择逻辑
 * 从 HistoryCheckPanel.vue 提取
 */
import { ref, computed, watch, type Ref } from 'vue';
import { watchDebounced } from '@vueuse/core';
import { SEVERITY, type StatusFilter, type LinkCheckRow } from '../../types/linkCheck';
import { shiftSelect, type ShiftSelectAnchor } from '../../utils/shiftSelect';

const PAGE_SIZE = 100;

interface UseCheckFilterOptions {
  checkRows: Ref<LinkCheckRow[]>;
}

export function useCheckFilter({ checkRows }: UseCheckFilterOptions) {
  // ---- 筛选状态 ----
  const statusFilter = ref<StatusFilter>('invalid');
  const selectedServiceId = ref<string | null>(null);
  const showServiceMenu = ref(false);
  const searchInput = ref('');
  const searchQuery = ref('');
  const currentPage = ref(1);
  const pageByFilter = new Map<StatusFilter, number>();
  const showCheckMenu = ref(false);
  const searchFocused = ref(false);
  const progressHover = ref(false);

  function resetPageState(): void {
    pageByFilter.clear();
    currentPage.value = 1;
  }

  watch(selectedServiceId, () => { resetPageState(); });
  watchDebounced(searchInput, (val) => { searchQuery.value = val; resetPageState(); }, { debounce: 200 });
  watch(statusFilter, (newFilter, oldFilter) => {
    pageByFilter.set(oldFilter!, currentPage.value);
    currentPage.value = pageByFilter.get(newFilter!) ?? 1;
  });

  // ---- 作用域行：图床 + 搜索筛选（供 stats 和 filteredRows 共用） ----
  const scopedRows = computed(() => {
    let rows: LinkCheckRow[] = checkRows.value;
    if (selectedServiceId.value) {
      rows = rows.filter((row) => row.serviceId === selectedServiceId.value);
    }
    const q = searchQuery.value.trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) =>
        row.url.toLowerCase().includes(q) || row.fileName.toLowerCase().includes(q) || row.serviceId.toLowerCase().includes(q),
      );
    }
    return rows;
  });

  // ---- 按状态筛选 + 排序 ----
  const filteredRows = computed(() => {
    let rows = scopedRows.value.filter((row) => {
      if (row.recheckResult || row.fadingOut) return true;
      const r = row.checkResult;
      switch (statusFilter.value) {
        case null: return r && !r.is_valid;
        case 'invalid': return r != null && !r.is_valid && r.error_type !== 'timeout' && r.error_type !== 'suspicious' && !r.browser_might_work;
        case 'suspicious': return r?.error_type === 'suspicious' || r?.browser_might_work === true;
        case 'timeout': return r?.error_type === 'timeout';
        case 'unchecked': return !r;
        case 'valid': return r?.is_valid;
        case 'all': return true;
        default: return true;
      }
    });
    rows = [...rows].sort((a, b) =>
      (a.pinnedSortWeight ?? SEVERITY[a.checkResult?.error_type ?? 'success'] ?? 5) -
      (b.pinnedSortWeight ?? SEVERITY[b.checkResult?.error_type ?? 'success'] ?? 5),
    );
    return rows;
  });

  // ---- 分页 ----
  const totalPages = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / PAGE_SIZE)));
  watch(totalPages, (newTotal) => {
    if (currentPage.value > newTotal) currentPage.value = newTotal;
  });
  const visibleRows = computed(() => {
    const start = (currentPage.value - 1) * PAGE_SIZE;
    return filteredRows.value.slice(start, start + PAGE_SIZE);
  });

  const pageInput = ref(String(currentPage.value));
  watch(currentPage, (val) => { pageInput.value = String(val); });

  const bottomSummary = computed(() => {
    const filtered = filteredRows.value.length;
    if (filtered === 0) return '';
    return `共 ${filtered.toLocaleString()} 条`;
  });

  function handlePageInput(e: Event) {
    const raw = (e.target as HTMLInputElement).value.trim();
    const val = parseInt(raw, 10);
    currentPage.value = (!raw || Number.isNaN(val) || val < 1) ? 1 : Math.min(val, totalPages.value);
    pageInput.value = String(currentPage.value);
  }

  // ---- 选择 ----
  const selectedIds = ref<Set<string>>(new Set());
  const selectAnchor = ref<ShiftSelectAnchor>({ lastId: null, wasSelect: true });
  const hasSelection = computed(() => selectedIds.value.size > 0);
  const filteredHistoryIds = computed(() => [...new Set(filteredRows.value.map((r) => r.historyId))]);
  const isAllSelected = computed(() =>
    filteredHistoryIds.value.length > 0 && filteredHistoryIds.value.every((id) => selectedIds.value.has(id)),
  );
  const selectedCount = computed(() => selectedIds.value.size);

  function toggleSelect(historyId: string) {
    const next = new Set(selectedIds.value);
    if (next.has(historyId)) next.delete(historyId);
    else next.add(historyId);
    selectedIds.value = next;
  }

  function handleToggleSelect(historyId: string, event: MouseEvent): void {
    const result = shiftSelect(historyId, event.shiftKey, filteredHistoryIds.value, selectedIds.value, selectAnchor.value);
    selectedIds.value = result.nextSet;
    selectAnchor.value = result.anchor;
  }

  function toggleSelectAll() {
    if (isAllSelected.value) {
      selectedIds.value = new Set();
    } else {
      selectedIds.value = new Set(filteredHistoryIds.value);
    }
  }

  function clearSelection() {
    selectedIds.value = new Set();
    selectAnchor.value = { lastId: null, wasSelect: true };
  }

  return {
    // 筛选状态
    statusFilter,
    selectedServiceId,
    showServiceMenu,
    searchInput,
    searchQuery,
    searchFocused,
    showCheckMenu,
    progressHover,
    // 计算结果
    scopedRows,
    filteredRows,
    visibleRows,
    // 分页
    currentPage,
    totalPages,
    pageInput,
    handlePageInput,
    bottomSummary,
    // 选择
    selectedIds,
    hasSelection,
    selectedCount,
    isAllSelected,
    toggleSelect,
    handleToggleSelect,
    toggleSelectAll,
    clearSelection,
  };
}
