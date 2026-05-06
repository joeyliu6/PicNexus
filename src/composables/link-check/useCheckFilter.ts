import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import { watchDebounced } from '@vueuse/core';
import type { LinkCheckRow, StatusFilter } from '../../types/linkCheck';
import { SEVERITY } from '../../types/linkCheck';
import { shiftSelect, type ShiftSelectAnchor } from '../../utils/shiftSelect';

const PAGE_SIZE = 100;
const HIGH_THROUGHPUT_COMMIT_MS = 400;

interface UseCheckFilterOptions {
  checkRows: Ref<LinkCheckRow[]>;
  isChecking?: Ref<boolean>;
  isHighThroughput?: Ref<boolean>;
}

export function rowKey(row: Pick<LinkCheckRow, 'historyId' | 'serviceId'>): string {
  return `${row.historyId}|${row.serviceId}`;
}

function matchesStatusFilter(row: LinkCheckRow, filter: StatusFilter): boolean {
  const result = row.checkResult;
  switch (filter) {
    case null:
      return true;
    case 'problems':
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

export function useCheckFilter({ checkRows, isChecking, isHighThroughput }: UseCheckFilterOptions) {
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
  const displayedRows = shallowRef<LinkCheckRow[]>([]);
  const suppressListMotion = ref(false);
  const runSnapshotKeys = shallowRef<Set<string> | null>(null);
  const isRunSnapshotActive = ref(false);
  const suppressPostRunHeldRows = ref(false);

  let snapshotCommitTimer: ReturnType<typeof setTimeout> | null = null;
  let autoApplyFilterTimer: ReturnType<typeof setTimeout> | null = null;
  let restoreMotionCancel: (() => void) | null = null;
  let hasInitializedDisplay = false;
  let restoringFromHighThroughput = false;

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

  function inHighThroughputMode(): boolean {
    return isHighThroughput?.value === true;
  }

  function shouldSuppressListMotion(): boolean {
    return inHighThroughputMode() || isRunSnapshotActive.value;
  }

  function clearSnapshotCommitTimer(): void {
    if (snapshotCommitTimer !== null) {
      clearTimeout(snapshotCommitTimer);
      snapshotCommitTimer = null;
    }
  }

  function clearAutoApplyFilterTimer(): void {
    if (autoApplyFilterTimer !== null) {
      clearTimeout(autoApplyFilterTimer);
      autoApplyFilterTimer = null;
    }
  }

  function cancelMotionRestore(): void {
    restoreMotionCancel?.();
    restoreMotionCancel = null;
  }

  function scheduleMotionRestore(): void {
    cancelMotionRestore();
    let cancelled = false;
    const restore = () => {
      if (cancelled) return;
      restoreMotionCancel = null;
      restoringFromHighThroughput = false;
      suppressListMotion.value = false;
    };

    if (typeof requestAnimationFrame === 'function') {
      const id = requestAnimationFrame(restore);
      restoreMotionCancel = () => {
        cancelled = true;
        cancelAnimationFrame(id);
      };
    } else {
      const id = setTimeout(restore, 0);
      restoreMotionCancel = () => {
        cancelled = true;
        clearTimeout(id);
      };
    }
  }

  function commitDisplayedRows(suppressMotion: boolean, restoreMotionNextFrame = false): void {
    cancelMotionRestore();
    if (!restoreMotionNextFrame) restoringFromHighThroughput = false;
    suppressListMotion.value = suppressMotion;
    displayedRows.value = displaySourceRows.value;
    if (restoreMotionNextFrame) scheduleMotionRestore();
  }

  function refreshDisplayedRowsReference(): void {
    displayedRows.value = displayedRows.value.slice();
  }

  function scheduleHighThroughputCommit(): void {
    cancelMotionRestore();
    suppressListMotion.value = true;
    refreshDisplayedRowsReference();

    if (snapshotCommitTimer !== null) return;
    snapshotCommitTimer = setTimeout(() => {
      snapshotCommitTimer = null;
      commitDisplayedRows(true);
    }, HIGH_THROUGHPUT_COMMIT_MS);
  }

  function forceCommitForScopeChange(): void {
    clearSnapshotCommitTimer();
    clearAutoApplyFilterTimer();
    if (isChecking?.value) {
      captureRunSnapshot();
    } else {
      isRunSnapshotActive.value = false;
      runSnapshotKeys.value = null;
    }
    commitDisplayedRows(shouldSuppressListMotion());
  }

  watch(selectedServiceId, () => {
    resetPageState();
    resetSelectionOnScopeChange();
    forceCommitForScopeChange();
  }, { flush: 'sync' });
  watchDebounced(
    searchInput,
    (value) => {
      searchQuery.value = value;
      resetPageState();
      resetSelectionOnScopeChange();
      forceCommitForScopeChange();
    },
    { debounce: 200, flush: 'sync' },
  );
  watch(statusFilter, (nextFilter, previousFilter) => {
    pageByFilter.set(previousFilter!, currentPage.value);
    currentPage.value = pageByFilter.get(nextFilter!) ?? 1;
    resetSelectionOnScopeChange();
    forceCommitForScopeChange();
  }, { flush: 'sync' });

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
   * 实时过滤——每次 checkRows 变化都会重算（scopedRows 返回新引用，链上 hasChanged 都为 true）。
   *
   * 已检测完的行在「未检测」tab 享受 `recentlyCompletedAt` hold 窗口（HOLD_MS≈2s 见 useLinkCheck.ts），
   * 让用户先看清新状态再走 TransitionGroup leave 动画淡出；目标 tab（valid/invalid 等）
   * 没有 hold 概念，新状态命中 matchesStatusFilter 立即出现。
   */
  function liveFilter(includeHeldRows = true): LinkCheckRow[] {
    const filter = statusFilter.value;
    const sortWeight = (row: LinkCheckRow): number => {
      if (includeHeldRows && filter === 'unchecked' && row.recentlyCompletedAt !== undefined) {
        return SEVERITY.success;
      }
      return row.pinnedSortWeight ?? SEVERITY[row.checkResult?.error_type ?? 'success'] ?? SEVERITY.success;
    };

    return scopedRows.value
      .filter((row) => {
        if (row.fadingOut) return true;
        if (row.recheckResult) return true;
        if (matchesStatusFilter(row, filter)) return true;
        // 仅"未检测"tab 享受 hold；高速模式下进入离场窗口后交给快照批量移除，不播放逐行动画。
        if (includeHeldRows && filter === 'unchecked' && row.recentlyCompletedAt !== undefined) {
          return !inHighThroughputMode() || row.uncheckedLeavingAt === undefined;
        }
        return false;
      })
      .slice()
      .sort((left, right) => sortWeight(left) - sortWeight(right));
  }

  const liveRows = computed(() => liveFilter(!suppressPostRunHeldRows.value));
  const strictRows = computed(() => liveFilter(false));
  const snapshotRows = computed(() => {
    const keys = runSnapshotKeys.value;
    if (!keys) return liveRows.value;

    const order = new Map<string, number>();
    let index = 0;
    for (const key of keys) {
      order.set(key, index++);
    }

    return scopedRows.value
      .filter((row) => keys.has(rowKey(row)))
      .slice()
      .sort((left, right) => (order.get(rowKey(left)) ?? 0) - (order.get(rowKey(right)) ?? 0));
  });
  const displaySourceRows = computed(() =>
    isRunSnapshotActive.value ? snapshotRows.value : liveRows.value,
  );
  const filteredRows = computed(() => displayedRows.value);

  function captureRunSnapshot(): void {
    isRunSnapshotActive.value = true;
    runSnapshotKeys.value = new Set(liveRows.value.map(rowKey));
  }

  function applyCurrentFilter(): void {
    clearAutoApplyFilterTimer();
    clearSnapshotCommitTimer();
    const rows = strictRows.value;
    suppressPostRunHeldRows.value = true;
    if (isChecking?.value) {
      isRunSnapshotActive.value = true;
      runSnapshotKeys.value = new Set(rows.map(rowKey));
    } else {
      isRunSnapshotActive.value = false;
      runSnapshotKeys.value = null;
    }
    cancelMotionRestore();
    restoringFromHighThroughput = false;
    suppressListMotion.value = false;
    displayedRows.value = rows;
  }

  watch(displaySourceRows, () => {
    if (!hasInitializedDisplay) {
      hasInitializedDisplay = true;
      commitDisplayedRows(shouldSuppressListMotion());
      return;
    }
    if (inHighThroughputMode()) {
      scheduleHighThroughputCommit();
      return;
    }
    clearSnapshotCommitTimer();
    commitDisplayedRows(shouldSuppressListMotion() || restoringFromHighThroughput, restoringFromHighThroughput);
  }, { immediate: true });

  if (isHighThroughput) {
    watch(isHighThroughput, (active, wasActive) => {
      if (active) {
        restoringFromHighThroughput = false;
        suppressListMotion.value = true;
        refreshDisplayedRowsReference();
        return;
      }
      if (wasActive) {
        restoringFromHighThroughput = true;
        clearSnapshotCommitTimer();
        commitDisplayedRows(true, true);
      }
    });
  }

  if (isChecking) {
    watch(isChecking, (active, wasActive) => {
      clearAutoApplyFilterTimer();
      if (active) {
        suppressPostRunHeldRows.value = false;
        captureRunSnapshot();
        commitDisplayedRows(true);
        return;
      }
      if (wasActive && isRunSnapshotActive.value) {
        autoApplyFilterTimer = setTimeout(() => {
          applyCurrentFilter();
        }, 450);
      }
    }, { immediate: true });
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      clearSnapshotCommitTimer();
      clearAutoApplyFilterTimer();
      cancelMotionRestore();
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
    suppressListMotion,
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
