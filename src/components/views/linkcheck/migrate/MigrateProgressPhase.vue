<script setup lang="ts">
/**
 * 迁移执行面板 — migrating / done 双态统一
 *
 * 结构：MigrateFilterBar（chip 过滤条 + 搜索框 + 来源图床筛选）
 *       + 单行列表（MigrateItemRow）+ 底栏。
 * 搜索和来源图床筛选逻辑由 useFilterBar composable 管理。
 */
import { inject, computed, ref, watch, nextTick } from 'vue';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useToast } from '../../../../composables/useToast';
import { useConfigManager } from '../../../../composables/useConfig';
import { makeCopyBadgeKey, useCopyBadgeFeedback } from '../../../../composables/useCopyBadgeFeedback';
import { applyConfiguredUrlWithConfig } from '../../../../composables/useCopyLink';
import { createLogger } from '../../../../utils/logger';
import { historyDB } from '../../../../services/database';
import { MIGRATE_KEY } from './keys';
import { buildCsvReport, buildTxtReport } from './reportExport';
import { buildMigrateProgressTooltip } from './utils';
import { useFilterBar } from './composables/useFilterBar';
import type { MigrateItemStatus } from '../../../../types/batchMigrate';
import MigrateItemRow from './components/MigrateItemRow.vue';
import type { MigrateRowItem } from './components/migrateRowTypes';
import MigrateBottomBar from './components/MigrateBottomBar.vue';
import type { StatePill } from '../common/StatePill.vue';
import MigratePagination from './components/MigratePagination.vue';
import MigrateFilterBar from './components/MigrateFilterBar.vue';
import { type MigrateStatusFilter } from './components/chips/MigrateStatusFilterChips.vue';

const PAGE_SIZE = 100;

const log = createLogger('MigrateProgressPhase');
const toast = useToast();
const configManager = useConfigManager();
const {
  copiedKey: copiedMigrateKey,
  markCopied: markMigrateCopied,
} = useCopyBadgeFeedback();

const ctx = inject(MIGRATE_KEY)!;
const {
  phase, allItemStatuses, checkedTargets, cancelMigrate,
  migrateResult, resetToConfiguring, retryingIds, retryFailed,
  retrySingleFailed,
  isPaused, isPausing, isCancelling, pauseMigrate, resumeMigrate,
  migrateStats, globalProgress, cumulativeCounts,
  estimatedTimeRemaining, averageSpeed, concurrentCount,
} = ctx;

// ============================================
// chip 过滤状态 & 分页 & 滚动控制
// ============================================

const activeFilter = ref<MigrateStatusFilter>('all');
const listRef = ref<HTMLElement | null>(null);
const pageByFilter = new Map<MigrateStatusFilter, number>();
const currentPage = ref(1);

// ============================================
// 数据源：migrating 用 allItemStatuses；done 用 migrateResult.itemsSnapshot
// ============================================

const ACTIVE_STATUSES = new Set<MigrateItemStatus['status']>([
  'pending', 'downloading', 'converting', 'uploading',
]);

function toRowItem(item: MigrateItemStatus, detailsOverride?: MigrateItemStatus['failureDetails']): MigrateRowItem {
  return {
    historyId: item.historyId,
    fileName: item.fileName,
    sourceUrl: item.sourceUrl,
    status: item.status,
    errorType: item.errorType,
    convertedFormat: item.convertedFormat,
    error: item.error,
    details: detailsOverride ?? item.failureDetails,
    existingServiceIds: item.existingServiceIds,
    serviceResults: item.serviceResults,
  };
}

const rawList = computed<MigrateRowItem[]>(() => {
  if (phase.value === 'done' && migrateResult.value) {
    const r = migrateResult.value;
    const failureDetailsById = new Map(r.failures.map(f => [f.historyId, f.details]));
    return r.itemsSnapshot.map(item =>
      toRowItem(item, item.status === 'failed' ? failureDetailsById.get(item.historyId) : undefined),
    );
  }
  return allItemStatuses.value.map(item => toRowItem(item));
});

// ============================================
// 搜索 & 来源图床筛选（useFilterBar）
// ============================================

const {
  searchInput,
  searchQuery,
  selectedSourceServiceId,
  showServiceMenu,
  sourceServiceOptions,
  applyFilters,
  resetFilters,
} = useFilterBar(rawList);

// 搜索/来源图床筛选变化时把分页拉回首页，
// 否则 displayList 缩短后 visibleList 会先闪一帧空白再被 totalPages watcher clamp 回来
watch([searchQuery, selectedSourceServiceId], () => {
  currentPage.value = 1;
});

const hasActiveFilter = computed(() =>
  !!searchQuery.value || !!selectedSourceServiceId.value,
);

// rawList → 搜索+图床筛选后的中间列表（再由 displayList 做状态过滤）
const scopedList = computed<MigrateRowItem[]>(() => applyFilters(rawList.value));

// ============================================
// 过滤
// ============================================

const displayList = computed<MigrateRowItem[]>(() => {
  const f = activeFilter.value;
  const items = scopedList.value;
  if (f === 'processing') return items.filter(s => ACTIVE_STATUSES.has(s.status));
  if (f === 'success') return items.filter(s => s.status === 'success');
  if (f === 'failed') return items.filter(s => s.status === 'failed');
  if (f === 'skipped') return items.filter(s => s.status === 'skipped');
  return items;
});

const filterCounts = computed(() => {
  const items = scopedList.value;
  let success = 0, failed = 0, skipped = 0;
  for (const it of items) {
    if (it.status === 'success') success++;
    else if (it.status === 'failed') failed++;
    else if (it.status === 'skipped') skipped++;
  }
  // "已加载/总数" 预填仅在 migrating 且无搜索/图床筛选时有意义
  const showTotal = phase.value === 'migrating' && !hasActiveFilter.value;
  const total = showTotal ? migrateStats.value.totalCount : undefined;
  const effectiveTotal = showTotal && total && total > 0 ? total : items.length;
  const processing = Math.max(0, effectiveTotal - success - failed - skipped);
  return { all: items.length, processing, success, failed, skipped, total };
});

// ============================================
// 分页切片
// ============================================

const effectiveTotalCount = computed(() => {
  if (phase.value === 'migrating' && activeFilter.value === 'all' && !hasActiveFilter.value) {
    const known = migrateStats.value.totalCount;
    if (known > 0) return known;
  }
  return displayList.value.length;
});

const totalPages = computed(() =>
  Math.max(1, Math.ceil(effectiveTotalCount.value / PAGE_SIZE)),
);

watch([totalPages, currentPage], ([tp, cp]) => {
  if (cp > tp) currentPage.value = tp;
  if (cp < 1) currentPage.value = 1;
});

const visibleList = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE;
  return displayList.value.slice(start, start + PAGE_SIZE);
});

const showPagination = computed(() => effectiveTotalCount.value > 0);

// ============================================
// Phase 切换：重置分页 + 所有筛选状态
// ============================================

watch(phase, (p) => {
  if (p === 'done') {
    const failCount = migrateResult.value?.failedCount ?? 0;
    activeFilter.value = failCount > 0 ? 'failed' : 'all';
  } else if (p === 'migrating') {
    activeFilter.value = 'all';
  }
  resetFilters();
  pageByFilter.clear();
  currentPage.value = 1;
  nextTick(() => {
    if (listRef.value) listRef.value.scrollTop = 0;
  });
});

watch(activeFilter, (next, prev) => {
  if (prev !== undefined) pageByFilter.set(prev, currentPage.value);
  currentPage.value = pageByFilter.get(next) ?? 1;
  nextTick(() => {
    if (listRef.value) listRef.value.scrollTop = 0;
  });
});

// ============================================
// 派生 UI
// ============================================

const emptyHint = computed(() => {
  if (displayList.value.length > 0) {
    return phase.value === 'migrating' ? '正在加载更多数据…' : '';
  }
  if (hasActiveFilter.value) return '没有匹配的条目';
  if (phase.value === 'migrating' && rawList.value.length === 0) return '正在启动迁移…';
  switch (activeFilter.value) {
    case 'processing': return '当前没有正在处理的项';
    case 'success': return '暂无已完成项';
    case 'failed': return '暂无失败项';
    case 'skipped': return '暂无跳过项';
    default: return '暂无数据';
  }
});

const canRetryAll = computed(() =>
  phase.value === 'done'
    && !!migrateResult.value
    && migrateResult.value.failures.length > 0,
);

const statePill = computed<StatePill | null>(() => {
  if (phase.value !== 'migrating') return null;
  const tooltip = migrateProgressTooltip.value;
  // 取消状态优先——用户点取消同时若在途条目未落定，pausing 会被短暂命中，以取消语义为准
  if (isCancelling.value) return { tone: 'cancelling', icon: 'pi pi-spin pi-spinner', label: '正在取消…', tooltip };
  if (isPausing.value) return { tone: 'pausing', icon: 'pi pi-spin pi-spinner', label: '正在暂停…', tooltip };
  if (isPaused.value) return { tone: 'paused', icon: 'pi pi-pause', label: '已暂停', tooltip };
  return { tone: 'running', label: '运行中', tooltip };
});

const migrateProgressTooltip = computed(() => {
  const counts = cumulativeCounts.value;
  const total = globalProgress.value.total || migrateStats.value.totalCount;
  return buildMigrateProgressTooltip({
    success: counts.success,
    failed: counts.failed,
    skipped: counts.skipped,
    total,
    avgBytesPerSec: averageSpeed.value,
    etaMs: estimatedTimeRemaining.value,
    concurrentCount: concurrentCount.value,
    state: isCancelling.value ? 'cancelling' : isPausing.value ? 'pausing' : isPaused.value ? 'paused' : 'running',
  });
});

const currentTargetServiceIds = computed(() => {
  if (phase.value === 'done') return migrateResult.value?.targetServiceIds ?? [];
  return checkedTargets.value.map(t => t.serviceId);
});

// ============================================
// 操作处理
// ============================================

function handleRetryAll() {
  if (!migrateResult.value) return;
  const ids = migrateResult.value.failures.map(f => f.historyId);
  if (ids.length > 0) retryFailed(ids);
}
function handleRetryOne(id: string) { retrySingleFailed(id); }

async function handleCopyUrl(historyId: string, serviceId: string) {
  try {
    const items = await historyDB.getItemsByIds([historyId]);
    const url = items[0]?.results.find(r => r.serviceId === serviceId && r.status === 'success')?.result?.url;
    if (!url) {
      toast.warn('复制失败', 'URL 未就绪');
      return;
    }
    const finalUrl = applyConfiguredUrlWithConfig(url, serviceId, configManager.config.value);
    await navigator.clipboard.writeText(finalUrl);
    markMigrateCopied(makeCopyBadgeKey('migrate', historyId, serviceId));
    toast.silent('log', '已复制链接');
  } catch (e) {
    log.error('复制链接失败', e);
    toast.error('复制失败', String(e));
  }
}

async function handleExport(format: 'csv' | 'txt') {
  const r = migrateResult.value;
  if (!r) return;
  try {
    const filePath = await saveDialog({
      defaultPath: `picnexus-migrate-${Date.now()}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (!filePath) return;
    const content = format === 'csv' ? buildCsvReport(r) : buildTxtReport(r);
    await writeTextFile(filePath, content);
  } catch (e) {
    log.error('导出失败', e);
  }
}

function handlePause() { pauseMigrate(); }
function handleResume() { resumeMigrate(); }
</script>

<template>
  <div class="focus-area" @click="showServiceMenu = false">
    <MigrateFilterBar
      v-model:active-filter="activeFilter"
      v-model:selected-source-service-id="selectedSourceServiceId"
      v-model:show-service-menu="showServiceMenu"
      v-model:search-input="searchInput"
      :counts="filterCounts"
      :show-processing="phase === 'migrating'"
      :source-service-options="sourceServiceOptions"
    />

    <div ref="listRef" class="focus-list">
      <template v-if="visibleList.length > 0">
        <MigrateItemRow
          v-for="(item, idx) in visibleList"
          :key="item.historyId || `${item.fileName}-${idx}`"
          :item="item"
          :target-service-ids="currentTargetServiceIds"
          :show-retry="phase === 'done' && item.status === 'failed'"
          :retrying="!!(item.historyId && retryingIds.has(item.historyId))"
          :copied-key="copiedMigrateKey"
          @retry="handleRetryOne"
          @copy-url="handleCopyUrl"
        />
      </template>
      <div v-else class="focus-empty">
        <i class="pi pi-inbox focus-empty-ic" />
        <span>{{ emptyHint }}</span>
      </div>
    </div>
  </div>

  <MigrateBottomBar
    :mode="phase === 'done' ? 'done' : 'migrating'"
    :is-paused="isPaused"
    :is-pausing="isPausing"
    :is-cancelling="isCancelling"
    :state-pill="statePill"
    :can-retry-all="canRetryAll"
    :retrying-count="retryingIds.size"
    @pause="handlePause"
    @resume="handleResume"
    @cancel="cancelMigrate"
    @done="resetToConfiguring"
    @restart="resetToConfiguring"
    @retry-all="handleRetryAll"
    @export="handleExport"
  >
    <template #pagination>
      <MigratePagination
        v-if="showPagination"
        :current-page="currentPage"
        :total-pages="totalPages"
        :total-items="effectiveTotalCount"
        @update:current-page="(p: number) => { currentPage = p; if (listRef) listRef.scrollTop = 0; }"
      />
    </template>
  </MigrateBottomBar>
</template>

<style scoped>
@import url('./migrate-shared.css');

.focus-area {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm-md);
  flex: 1 1 auto;
  min-height: 0;
}

.focus-list {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  padding-right: var(--space-lg);
}

.focus-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  padding: var(--space-2xl) 0;
}

.focus-empty-ic {
  font-size: var(--text-2xl);
  opacity: 0.6;
}
</style>
