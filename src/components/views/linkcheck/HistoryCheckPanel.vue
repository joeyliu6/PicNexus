<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import { useConfigManager } from '../../../composables/useConfig';
import { makeCopyBadgeKey, useCopyBadgeFeedback } from '../../../composables/useCopyBadgeFeedback';
import { useToast } from '../../../composables/useToast';
import CheckBottomBar from './history-check/CheckBottomBar.vue';
import CheckFilterBar from './history-check/CheckFilterBar.vue';
import CheckLinkList from './history-check/CheckLinkList.vue';
import LinkCheckSkeleton from './history-check/LinkCheckSkeleton.vue';
import type { StatePill } from './common/StatePill.vue';
import { rowKey, useCheckFilter } from '../../../composables/link-check/useCheckFilter';
import { useCheckStats, type CheckStatsResult } from '../../../composables/link-check/useCheckStats';
import { useCheckStrategy } from '../../../composables/link-check/useCheckStrategy';
import type { MoreMenuKind } from '../../../composables/link-check/useCheckStrategy';
import type { BatchCheckProgress, LinkCheckRow, StatusFilter } from '../../../types/linkCheck';
import { applyZhihuSourceFromConfig } from '../../../utils/zhihuSource';

const props = defineProps<{
  checkRows: LinkCheckRow[];
  isChecking: boolean;
  isPaused: boolean;
  isLoading: boolean;
  loadError?: string | null;
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
    searchQuery?: string;
  }): void;
  (e: 'cancel-check'): void;
  (e: 'pause-check'): void;
  (e: 'resume-check'): void;
  (e: 'recheck-single', row: LinkCheckRow, filter: StatusFilter): void;
  (e: 'export-csv', rows?: LinkCheckRow[]): void;
  (e: 'export-csv-selected', rows: LinkCheckRow[]): void;
  (e: 'delete-row', row: LinkCheckRow): void;
  (e: 'bulk-recheck', rows: LinkCheckRow[]): void;
  (e: 'bulk-copy', rows: LinkCheckRow[]): void;
  (e: 'bulk-delete', rows: LinkCheckRow[]): void;
}>();

const checkRows = computed(() => props.checkRows);
const progress = computed(() => props.progress);
const isMonitorChecking = computed(() => props.isChecking && props.progressSource !== 'rescue');
const isHighThroughputSignal = ref(false);
const configManager = useConfigManager();
const toast = useToast();
const {
  copiedKey: copiedLinkKey,
  markCopied: markLinkCopied,
} = useCopyBadgeFeedback();

const {
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
  suppressListMotion,
  handleToggleSelect,
  toggleSelectAll,
  clearSelection,
} = useCheckFilter({ checkRows, isChecking: isMonitorChecking, isHighThroughput: isHighThroughputSignal });

const {
  stats,
  serviceList,
  progressPercent,
  progressTooltip,
  progressTooltipDetails,
  isHighThroughput,
} = useCheckStats({
  scopedRows,
  checkRows,
  progress,
  statusFilter,
});

const frozenStats = ref<CheckStatsResult | null>(null);
let frozenStatsTimer: ReturnType<typeof setTimeout> | null = null;

function clearFrozenStatsTimer(): void {
  if (frozenStatsTimer !== null) {
    clearTimeout(frozenStatsTimer);
    frozenStatsTimer = null;
  }
}

function cloneStats(value: CheckStatsResult): CheckStatsResult {
  return { ...value };
}

const displayStats = computed(() => frozenStats.value ?? stats.value);
const showStatsSkeleton = computed(() => isMonitorChecking.value || frozenStats.value !== null);

watch(isMonitorChecking, (active, wasActive) => {
  clearFrozenStatsTimer();
  if (active) {
    frozenStats.value = cloneStats(stats.value);
    return;
  }
  if (wasActive) {
    frozenStatsTimer = setTimeout(() => {
      frozenStats.value = null;
      frozenStatsTimer = null;
    }, 450);
  }
}, { immediate: true });

watch([selectedServiceId, searchQuery], () => {
  if (isMonitorChecking.value) {
    frozenStats.value = cloneStats(stats.value);
  }
});

onScopeDispose(() => clearFrozenStatsTimer());

watch(isHighThroughput, (value) => {
  isHighThroughputSignal.value = value;
}, { immediate: true });

const {
  smartCheckLabel,
  smartCheckTooltip,
  buildMoreMenuItems,
  buildScopeLabel,
  resolveSmartCheck,
  statusDotColor,
  errorBadgeClass,
  errorLabel,
  recheckLabel,
  errorTooltip,
} = useCheckStrategy({ stats: displayStats, statusFilter });

const showOverflowMenu = ref(false);

/** 底栏运行状态 pill —— 仅在链接检测自己检测时显示，rescue/迁移不借此渲染 */
const statePill = computed<StatePill | null>(() => {
  if (!isMonitorChecking.value) return null;
  const progressMeta = {
    progressPercent: progressPercent.value,
    progressLabel: progressTooltip.value,
    tooltip: progressTooltipDetails.value,
  };
  if (props.isPaused) return { tone: 'paused', icon: 'pi pi-pause', label: '已暂停', ...progressMeta };
  return { tone: 'running', label: '检测中', ...progressMeta };
});

const moreMenuItems = computed(() => {
  if (hasSelection.value) {
    // recheck 已上升为底栏主按钮（重检选中），更多菜单里不再重复
    return buildMoreMenuItems({ mode: 'selection', count: selectedCount.value })
      .filter((item) => item.kind !== 'recheck');
  }
  return buildMoreMenuItems({ mode: 'filter', count: filteredRows.value.length });
});

const moreMenuScopeLabel = computed(() => {
  if (hasSelection.value) {
    return buildScopeLabel({ mode: 'selection', count: selectedCount.value });
  }
  return buildScopeLabel({ mode: 'filter', count: filteredRows.value.length });
});

const effectiveSmartCheckLabel = computed(() => {
  if (hasSelection.value) return `重检选中 (${selectedCount.value.toLocaleString()})`;
  return smartCheckLabel.value;
});

const effectiveSmartCheckTooltip = computed(() => {
  if (hasSelection.value) return `重新检测选中的 ${selectedCount.value.toLocaleString()} 条链接`;
  return smartCheckTooltip.value;
});

function currentSubsetScope(statusFilter?: 'unchecked' | 'invalid' | 'timeout' | 'suspicious' | 'valid' | 'problems') {
  const payload: {
    statusFilter?: 'unchecked' | 'invalid' | 'timeout' | 'suspicious' | 'valid' | 'problems';
    serviceId?: string;
    searchQuery?: string;
  } = {};

  if (statusFilter) payload.statusFilter = statusFilter;
  if (selectedServiceId.value) payload.serviceId = selectedServiceId.value;

  const query = searchInput.value.trim();
  if (query) payload.searchQuery = query;

  return payload;
}

function hasScopedSubset(): boolean {
  return !!selectedServiceId.value || searchInput.value.trim().length > 0;
}

function handleSmartCheck(): void {
  if (hasSelection.value) {
    handleBulkRecheck();
    return;
  }
  const result = resolveSmartCheck();
  if (result.action === 'check-all') {
    if (hasScopedSubset()) {
      emit('check-subset', currentSubsetScope());
      return;
    }
    emit('check-all');
  } else {
    emit(
      'check-subset',
      currentSubsetScope(result.filter as 'unchecked' | 'invalid' | 'timeout' | 'suspicious' | 'problems'),
    );
  }
}

function getLinkCopyKey(row: LinkCheckRow): string {
  return makeCopyBadgeKey('link-check', rowKey(row));
}

async function handleCopyUrl(row: LinkCheckRow): Promise<void> {
  try {
    const finalUrl = applyZhihuSourceFromConfig(row.url, configManager.config.value);
    await navigator.clipboard.writeText(finalUrl);
    markLinkCopied(getLinkCopyKey(row));
    toast.silent('log', '已复制到剪贴板');
  } catch (error) {
    toast.error('复制失败', error instanceof Error ? error.message : String(error));
  }
}

function handleRecheck(row: LinkCheckRow): void {
  emit('recheck-single', row, statusFilter.value);
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
  return filteredRows.value;
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

function handleBulkCopy(): void {
  const rows = bulkTargetRows.value;
  if (rows.length === 0) return;
  emit('bulk-copy', rows);
}

function handleBulkDelete(): void {
  const rows = bulkTargetRows.value;
  if (rows.length === 0) return;
  emit('bulk-delete', rows);
  clearAfterBulk();
}

function handleExportAction(): void {
  if (hasSelection.value) {
    handleExportCsvSelected();
  } else {
    const rows = filteredRows.value;
    if (rows.length === 0) return;
    emit('export-csv', rows);
  }
}

function handleMoreAction(kind: MoreMenuKind): void {
  switch (kind) {
    case 'export': handleExportAction(); break;
    case 'recheck': handleBulkRecheck(); break;
    case 'copy': handleBulkCopy(); break;
    case 'delete': handleBulkDelete(); break;
  }
}
</script>

<template>
  <!-- 首次加载整屏骨架：覆盖 FilterBar/List/BottomBar，避免混显真实搜索框/分页/按钮 -->
  <LinkCheckSkeleton
    v-if="isLoading && stats.total === 0 && !loadError"
  />

  <div v-else class="monitor-panel" @click="showServiceMenu = false; showOverflowMenu = false">
    <CheckFilterBar
      :stats="displayStats"
      :service-list="serviceList"
      :is-loading="isLoading"
      :is-checking="showStatsSkeleton"
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
      :stats="displayStats"
      :status-filter="statusFilter"
      :is-loading="isLoading"
      :load-error="loadError"
      :is-checking="isChecking"
      :is-action-locked="isActionLocked"
      :suppress-list-motion="suppressListMotion"
      :selected-ids="selectedIds"
      :status-dot-color="statusDotColor"
      :error-badge-class="errorBadgeClass"
      :error-label="errorLabel"
      :error-tooltip="errorTooltip"
      :recheck-label="recheckLabel"
      :copied-key="copiedLinkKey"
      @toggle-select="handleToggleSelect"
      @copy-url="handleCopyUrl"
      @recheck-single="handleRecheck"
      @delete-row="(row: LinkCheckRow) => emit('delete-row', row)"
    />

    <CheckBottomBar
      :is-checking="isChecking"
      :is-paused="isPaused"
      :state-pill="statePill"
      :is-action-locked="isActionLocked"
      :progress-source="progressSource"
      :has-selection="hasSelection"
      :selected-count="selectedCount"
      :is-all-selected="isAllSelected"
      :total-pages="totalPages"
      :bottom-summary="bottomSummary"
      :is-loading="isLoading"
      :stats="displayStats"
      :smart-check-label="effectiveSmartCheckLabel"
      :smart-check-tooltip="effectiveSmartCheckTooltip"
      :more-menu-items="moreMenuItems"
      :more-menu-scope-label="moreMenuScopeLabel"
      v-model:current-page="currentPage"
      v-model:page-input="pageInput"
      v-model:show-overflow-menu="showOverflowMenu"
      @toggle-select-all="toggleSelectAll"
      @clear-selection="clearSelection"
      @smart-check="handleSmartCheck"
      @cancel-check="emit('cancel-check')"
      @pause-check="emit('pause-check')"
      @resume-check="emit('resume-check')"
      @page-input="handlePageInput"
      @more-action="handleMoreAction"
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
