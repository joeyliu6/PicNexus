<script setup lang="ts">
/**
 * HistoryCheckPanel — 链接监控面板（方案A 极简克制）
 * 全宽单列、下划线 Tab、单行列表、hover 显示 URL
 */
import { computed } from 'vue';
import CheckFilterBar from './history-check/CheckFilterBar.vue';
import CheckLinkList from './history-check/CheckLinkList.vue';
import CheckBottomBar from './history-check/CheckBottomBar.vue';
import type { StatusFilter, LinkCheckRow, BatchCheckProgress } from '../../../types/linkCheck';
import { useCheckFilter } from '../../../composables/link-check/useCheckFilter';
import { useCheckStats } from '../../../composables/link-check/useCheckStats';
import { useCheckStrategy } from '../../../composables/link-check/useCheckStrategy';

const props = defineProps<{
  checkRows: LinkCheckRow[];
  isChecking: boolean;
  isLoading: boolean;
  isPhase2Loading: boolean;
  phase2Duration: number;
  progress: BatchCheckProgress | null;
  progressSource: 'monitor' | 'rescue' | null;
}>();

const emit = defineEmits<{
  (e: 'check-all'): void;
  (e: 'check-subset', filter: { statusFilter?: 'unchecked' | 'invalid' | 'timeout' | 'suspicious' | 'valid' | 'problems'; serviceId?: string }): void;
  (e: 'cancel-check'): void;
  (e: 'recheck-single', row: LinkCheckRow, filter: StatusFilter): void;
  (e: 'copy-url', url: string): void;
  (e: 'export-csv'): void;
  (e: 'delete-row', row: LinkCheckRow): void;
  (e: 'delete-batch', ids: string[]): void;
  (e: 'recheck-batch', ids: string[]): void;
}>();

// ---- Composables ----
const checkRows = computed(() => props.checkRows);
const progress = computed(() => props.progress);

const {
  statusFilter, selectedServiceId, showServiceMenu, searchInput, searchQuery,
  searchFocused, showCheckMenu, progressHover,
  scopedRows, filteredRows, visibleRows,
  currentPage, totalPages, pageInput, handlePageInput, bottomSummary,
  selectedIds, hasSelection, selectedCount, isAllSelected,
  toggleSelect, toggleSelectAll, clearSelection,
} = useCheckFilter({ checkRows });

const { stats, serviceList, progressPercent, progressTooltip } = useCheckStats({ scopedRows, checkRows, progress });

const {
  smartCheckLabel, smartCheckTooltip, showDropdownArrow, buildDropdownItems, resolveSmartCheck,
  statusDotColor, errorBadgeClass, errorLabel, recheckLabel, errorTooltip,
} = useCheckStrategy({ stats, statusFilter });

// ---- 下拉菜单选项（桥接 composable 与 emit） ----
const dropdownItems = computed(() =>
  buildDropdownItems().map((item) => ({
    ...item,
    action: () => {
      if (item.action === 'check-all') emit('check-all');
      else emit('check-subset', { statusFilter: item.filter as 'unchecked' | 'invalid' | 'timeout' | 'suspicious' | 'problems' });
      showCheckMenu.value = false;
    },
  })),
);

function handleSmartCheck() {
  showCheckMenu.value = false;
  const result = resolveSmartCheck();
  if (result.action === 'check-all') emit('check-all');
  else emit('check-subset', { statusFilter: result.filter as 'unchecked' | 'invalid' | 'timeout' | 'suspicious' | 'problems' });
}

function handleCopyUrl(row: LinkCheckRow) {
  emit('copy-url', row.url);
}

function handleRecheck(row: LinkCheckRow) {
  emit('recheck-single', row, statusFilter.value);
}

function handleDeleteBatch() {
  const ids = [...selectedIds.value];
  if (ids.length === 0) return;
  emit('delete-batch', ids);
  clearSelection();
}

function handleRecheckBatch() {
  const ids = [...selectedIds.value];
  if (ids.length === 0) return;
  emit('recheck-batch', ids);
  clearSelection();
}
</script>

<template>
  <div class="monitor-panel" @click="showCheckMenu = false; showServiceMenu = false">
    <!-- 芯片栏：统计 + 筛选 + 进度 + 搜索 -->
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

    <!-- 链接列表 -->
    <CheckLinkList
      :visible-rows="visibleRows"
      :filtered-rows="filteredRows"
      :stats="stats"
      :is-loading="isLoading"
      :is-checking="isChecking"
      :selected-ids="selectedIds"
      :status-dot-color="statusDotColor"
      :error-badge-class="errorBadgeClass"
      :error-label="errorLabel"
      :error-tooltip="errorTooltip"
      :recheck-label="recheckLabel"
      @toggle-select="toggleSelect"
      @check-all="emit('check-all')"
      @copy-url="handleCopyUrl"
      @recheck-single="handleRecheck"
      @delete-row="(row: LinkCheckRow) => emit('delete-row', row)"
    />

    <!-- 底部 -->
    <CheckBottomBar
      :is-checking="isChecking"
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
      v-model:current-page="currentPage"
      v-model:page-input="pageInput"
      v-model:progress-hover="progressHover"
      v-model:show-check-menu="showCheckMenu"
      @toggle-select-all="toggleSelectAll"
      @clear-selection="clearSelection"
      @recheck-batch="handleRecheckBatch"
      @delete-batch="handleDeleteBatch"
      @export-csv="emit('export-csv')"
      @smart-check="handleSmartCheck"
      @cancel-check="emit('cancel-check')"
      @page-input="handlePageInput"
    />
  </div>
</template>

<style scoped>
.monitor-panel {
  display: flex; flex-direction: column; height: 100%; gap: var(--space-md-lg);
  padding: var(--space-lg-xl) 0 var(--space-lg-xl) var(--space-xl); overflow: hidden;
}
</style>
