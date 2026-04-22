<script setup lang="ts">
import { computed, ref } from 'vue';
import CheckBottomBar from './history-check/CheckBottomBar.vue';
import CheckFilterBar from './history-check/CheckFilterBar.vue';
import CheckLinkList from './history-check/CheckLinkList.vue';
import { rowKey, useCheckFilter } from '../../../composables/link-check/useCheckFilter';
import { useCheckStats } from '../../../composables/link-check/useCheckStats';
import { useCheckStrategy } from '../../../composables/link-check/useCheckStrategy';
import type { BatchCheckProgress, LinkCheckRow, StatusFilter } from '../../../types/linkCheck';

const props = defineProps<{
  checkRows: LinkCheckRow[];
  isChecking: boolean;
  isLoading: boolean;
  isPhase2Loading: boolean;
  phase2Duration: number;
  progress: BatchCheckProgress | null;
  progressSource: 'monitor' | 'rescue' | null;
  isActionLocked: boolean;
}>();

const emit = defineEmits<{
  (e: 'check-all'): void;
  (e: 'check-subset', filter: {
    statusFilter?: 'unchecked' | 'invalid' | 'timeout' | 'suspicious' | 'valid' | 'problems';
    serviceId?: string;
  }): void;
  (e: 'cancel-check'): void;
  (e: 'recheck-single', row: LinkCheckRow, filter: StatusFilter): void;
  (e: 'restore-skip', row: LinkCheckRow): void;
  (e: 'copy-url', url: string): void;
  (e: 'export-csv'): void;
  (e: 'export-csv-selected', rows: LinkCheckRow[]): void;
  (e: 'delete-row', row: LinkCheckRow): void;
  (e: 'bulk-recheck', rows: LinkCheckRow[]): void;
  (e: 'bulk-skip', rows: LinkCheckRow[]): void;
  (e: 'bulk-restore', rows: LinkCheckRow[]): void;
  (e: 'bulk-copy', rows: LinkCheckRow[]): void;
  (e: 'bulk-delete', rows: LinkCheckRow[]): void;
}>();

const checkRows = computed(() => props.checkRows);
const progress = computed(() => props.progress);

const {
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
} = useCheckFilter({ checkRows });

const { stats, serviceList, progressPercent, progressTooltip } = useCheckStats({
  scopedRows,
  checkRows,
  progress,
  statusFilter,
});

const {
  smartCheckLabel,
  smartCheckTooltip,
  showDropdownArrow,
  buildDropdownItems,
  resolveSmartCheck,
  statusDotColor,
  errorBadgeClass,
  errorLabel,
  recheckLabel,
  errorTooltip,
} = useCheckStrategy({ stats, statusFilter });

const disableCheckActions = computed(() => statusFilter.value === 'skipped');
const filteredActionRows = computed(() => filteredRows.value.filter((row) => !row.linkCheckSkip));

const showBatchMenu = ref(false);
const batchFilterLabel = computed<string | null>(() => {
  if (statusFilter.value === 'all' || statusFilter.value === 'skipped') return null;
  if (filteredActionRows.value.length === 0) return null;
  switch (statusFilter.value) {
    case 'invalid': return '失效链接';
    case 'suspicious': return '可疑链接';
    case 'timeout': return '超时链接';
    case 'unchecked': return '未检测链接';
    case 'valid': return '正常链接';
    default: return '当前筛选链接';
  }
});

const dropdownItems = computed(() =>
  buildDropdownItems().map((item) => ({
    ...item,
    action: () => {
      if (item.action === 'check-all') {
        emit('check-all');
      } else {
        emit('check-subset', {
          statusFilter: item.filter as 'unchecked' | 'invalid' | 'timeout' | 'suspicious' | 'problems',
        });
      }
      showCheckMenu.value = false;
    },
  })),
);

function uniqueHistoryRows(rows: LinkCheckRow[]): LinkCheckRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.historyId)) return false;
    seen.add(row.historyId);
    return true;
  });
}

function handleSmartCheck(): void {
  if (disableCheckActions.value) return;
  showCheckMenu.value = false;

  const result = resolveSmartCheck();
  if (result.action === 'check-all') {
    emit('check-all');
  } else {
    emit('check-subset', {
      statusFilter: result.filter as 'unchecked' | 'invalid' | 'timeout' | 'suspicious' | 'problems',
    });
  }
}

function handleCopyUrl(row: LinkCheckRow): void {
  emit('copy-url', row.url);
}

function handleRecheck(row: LinkCheckRow): void {
  emit('recheck-single', row, statusFilter.value);
}

function handleRestoreSkip(row: LinkCheckRow): void {
  emit('restore-skip', row);
}

function handleExportCsvSelected(): void {
  const rows = checkRows.value.filter((row) => selectedIds.value.has(rowKey(row)));
  if (rows.length === 0) return;
  emit('export-csv-selected', rows);
}

const bulkTargetRows = computed<LinkCheckRow[]>(() => {
  if (hasSelection.value) {
    return checkRows.value.filter((row) => selectedIds.value.has(rowKey(row)));
  }
  return filteredActionRows.value;
});

function clearAfterBulk(): void {
  if (hasSelection.value) clearSelection();
}

function handleBulkRecheck(): void {
  const rows = bulkTargetRows.value;
  if (rows.length === 0) return;
  emit('bulk-recheck', rows);
  clearAfterBulk();
}

function handleBulkSkip(): void {
  const rows = bulkTargetRows.value;
  if (rows.length === 0) return;
  if (disableCheckActions.value) {
    emit('bulk-restore', rows);
  } else {
    emit('bulk-skip', rows);
  }
  clearAfterBulk();
}

function handleBulkCopy(): void {
  const rows = bulkTargetRows.value;
  if (rows.length === 0) return;
  emit('bulk-copy', rows);
}

function handleBulkDelete(): void {
  const rows = uniqueHistoryRows(bulkTargetRows.value);
  if (rows.length === 0) return;
  emit('bulk-delete', rows);
  clearAfterBulk();
}
</script>

<template>
  <div class="monitor-panel" @click="showCheckMenu = false; showServiceMenu = false; showBatchMenu = false">
    <CheckFilterBar
      :stats="stats"
      :service-list="serviceList"
      :is-loading="isLoading"
      :is-phase2-loading="isPhase2Loading"
      :phase2-duration="phase2Duration"
      v-model:status-filter="statusFilter"
      v-model:selected-service-id="selectedServiceId"
      v-model:show-service-menu="showServiceMenu"
      v-model:search-input="searchInput"
      v-model:search-query="searchQuery"
      v-model:search-focused="searchFocused"
    />

    <CheckLinkList
      :visible-rows="visibleRows"
      :filtered-rows="filteredRows"
      :stats="stats"
      :status-filter="statusFilter"
      :is-loading="isLoading"
      :is-checking="isChecking"
      :is-action-locked="isActionLocked"
      :selected-ids="selectedIds"
      :status-dot-color="statusDotColor"
      :error-badge-class="errorBadgeClass"
      :error-label="errorLabel"
      :error-tooltip="errorTooltip"
      :recheck-label="recheckLabel"
      @toggle-select="handleToggleSelect"
      @check-all="emit('check-all')"
      @copy-url="handleCopyUrl"
      @recheck-single="handleRecheck"
      @restore-skip="handleRestoreSkip"
      @delete-row="(row: LinkCheckRow) => emit('delete-row', row)"
    />

    <CheckBottomBar
      :is-checking="isChecking"
      :is-action-locked="isActionLocked"
      :disable-check-actions="disableCheckActions"
      :progress-source="progressSource"
      :progress-percent="progressPercent"
      :progress-tooltip="progressTooltip"
      :has-selection="hasSelection"
      :selected-count="selectedCount"
      :is-all-selected="isAllSelected"
      :total-pages="totalPages"
      :bottom-summary="bottomSummary"
      :is-loading="isLoading"
      :stats="stats"
      :smart-check-label="smartCheckLabel"
      :smart-check-tooltip="smartCheckTooltip"
      :show-dropdown-arrow="showDropdownArrow"
      :dropdown-items="dropdownItems"
      :batch-filter-label="batchFilterLabel"
      :batch-filter-count="filteredActionRows.length"
      v-model:current-page="currentPage"
      v-model:page-input="pageInput"
      v-model:show-check-menu="showCheckMenu"
      v-model:show-batch-menu="showBatchMenu"
      @toggle-select-all="toggleSelectAll"
      @export-csv="emit('export-csv')"
      @export-csv-selected="handleExportCsvSelected"
      @smart-check="handleSmartCheck"
      @cancel-check="emit('cancel-check')"
      @page-input="handlePageInput"
      @bulk-recheck="handleBulkRecheck"
      @bulk-skip="handleBulkSkip"
      @bulk-copy="handleBulkCopy"
      @bulk-delete="handleBulkDelete"
    />
  </div>
</template>

<style scoped>
.monitor-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: var(--space-md-lg);
  padding: var(--space-lg-xl) 0 var(--space-lg-xl) var(--space-xl);
  overflow: hidden;
}
</style>
