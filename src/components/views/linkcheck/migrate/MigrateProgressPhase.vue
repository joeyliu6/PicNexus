<script setup lang="ts">
/**
 * 迁移执行面板 — migrating / done 双态统一
 *
 * 两态共享同一结构：
 *   顶部 chip 过滤条（全部 / 处理中仅 migrating / 已完成 / 失败 / 已跳过）
 *   + 可滚动的统一列表（migrating 用 MigrateActiveCard，done 用 MigrateDoneRow）
 *
 * done 态进入时，有失败自动选中「失败」chip；切换 phase 时滚动重置到顶部。
 */
import { inject, computed, ref, watch, nextTick } from 'vue';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { createLogger } from '../../../../utils/logger';
import { MIGRATE_KEY } from './keys';
import { buildCsvReport, buildTxtReport } from './reportExport';
import type { MigrateFailureDetail, MigrateItemStatus } from '../../../../types/batchMigrate';
import MigrateActiveCard from './components/MigrateActiveCard.vue';
import MigrateSkeletonCard from './components/MigrateSkeletonCard.vue';
import MigrateDoneRow, { type DoneRowItem } from './components/MigrateDoneRow.vue';
import MigrateBottomBar from './components/MigrateBottomBar.vue';
import MigrateStatusFilterChips, {
  type MigrateStatusFilter,
} from './components/chips/MigrateStatusFilterChips.vue';

const log = createLogger('MigrateProgressPhase');

const ctx = inject(MIGRATE_KEY)!;
const {
  phase, allItemStatuses, checkedTargets, cancelMigrate,
  migrateResult, resetToConfiguring, retryingIds, retryFailed,
  retrySingleFailed,
  slots, hasAnyActive,
  isPaused, isPausing, pauseMigrate, resumeMigrate,
  sourceServiceFilter, availableSourceServices,
} = ctx;

// ============================================
// chip 过滤状态 & 滚动控制
// ============================================

const activeFilter = ref<MigrateStatusFilter>('all');
const listRef = ref<HTMLElement | null>(null);

watch(phase, (p) => {
  // 进入 done：有失败自动选中「失败」chip，全成功则「全部」
  if (p === 'done') {
    const failCount = migrateResult.value?.failedCount ?? 0;
    activeFilter.value = failCount > 0 ? 'failed' : 'all';
  } else if (p === 'migrating') {
    activeFilter.value = 'all';
  }
  nextTick(() => {
    if (listRef.value) listRef.value.scrollTop = 0;
  });
});

// ============================================
// migrating 态数据源
// ============================================

const activeItems = computed<MigrateItemStatus[]>(() =>
  slots.value.map(s => s.item).filter((x): x is MigrateItemStatus => !!x),
);

const processedItems = computed<MigrateItemStatus[]>(() =>
  allItemStatuses.value
    .filter(s => s.status === 'success' || s.status === 'failed' || s.status === 'skipped')
    .slice()
    .reverse(),
);

// ============================================
// done 态数据源：以 itemsSnapshot 为基础，失败项合并 migrateResult.failures 的 details
// ============================================

function toDoneRowItem(item: MigrateItemStatus, detailsOverride?: MigrateFailureDetail[]): DoneRowItem {
  return {
    historyId: item.historyId,
    fileName: item.fileName,
    status: item.status,
    errorType: item.errorType,
    convertedFormat: item.convertedFormat,
    error: item.error,
    details: detailsOverride ?? item.failureDetails,
  };
}

const doneItems = computed<DoneRowItem[]>(() => {
  const r = migrateResult.value;
  if (!r) return [];
  const failureDetailsById = new Map(r.failures.map(f => [f.historyId, f.details]));
  return r.itemsSnapshot.map(item =>
    toDoneRowItem(item, item.status === 'failed' ? failureDetailsById.get(item.historyId) : undefined),
  );
});

// ============================================
// chip 计数（两态共用）
// ============================================

const filterCounts = computed(() => {
  if (phase.value === 'done') {
    const all = doneItems.value;
    return {
      all: all.length,
      processing: 0,
      success: all.filter(s => s.status === 'success').length,
      failed: all.filter(s => s.status === 'failed').length,
      skipped: all.filter(s => s.status === 'skipped').length,
    };
  }
  return {
    all: activeItems.value.length + processedItems.value.length,
    processing: activeItems.value.length,
    success: processedItems.value.filter(s => s.status === 'success').length,
    failed: processedItems.value.filter(s => s.status === 'failed').length,
    skipped: processedItems.value.filter(s => s.status === 'skipped').length,
  };
});

// ============================================
// 过滤结果 —— migrating：ListEntry；done：DoneRowItem
// ============================================

interface MigratingListEntry {
  item: MigrateItemStatus;
  role: 'active' | 'done';
}

const filteredMigratingList = computed<MigratingListEntry[]>(() => {
  const f = activeFilter.value;
  const active = activeItems.value.map(it => ({ item: it, role: 'active' as const }));
  const doneOf = (predicate: (s: MigrateItemStatus) => boolean) =>
    processedItems.value.filter(predicate).map(it => ({ item: it, role: 'done' as const }));
  if (f === 'processing') return active;
  if (f === 'success') return doneOf(s => s.status === 'success');
  if (f === 'failed') return doneOf(s => s.status === 'failed');
  if (f === 'skipped') return doneOf(s => s.status === 'skipped');
  return [...active, ...doneOf(() => true)];
});

const filteredDoneList = computed<DoneRowItem[]>(() => {
  const f = activeFilter.value;
  const all = doneItems.value;
  if (f === 'success') return all.filter(s => s.status === 'success');
  if (f === 'failed') return all.filter(s => s.status === 'failed');
  if (f === 'skipped') return all.filter(s => s.status === 'skipped');
  return all; // 'all' / 'processing'（done 态不出现 processing，兜底）
});

// ============================================
// 派生 UI
// ============================================

const showInitialSkeleton = computed(() =>
  phase.value === 'migrating' && !hasAnyActive.value && processedItems.value.length === 0,
);

const emptyHint = computed(() => {
  if (showInitialSkeleton.value) return '';
  const listLen = phase.value === 'done' ? filteredDoneList.value.length : filteredMigratingList.value.length;
  if (listLen > 0) return '';
  switch (activeFilter.value) {
    case 'processing': return '当前没有正在处理的项';
    case 'success': return '暂无已完成项';
    case 'failed': return '暂无失败项';
    case 'skipped': return '暂无跳过项';
    default: return '暂无数据';
  }
});

const focusTitle = computed(() => (phase.value === 'done' ? '迁移结果' : '正在处理'));

/** done 态全成功指示器（失败时不显示，red chip 已足够） */
const showAllSuccess = computed(() =>
  phase.value === 'done'
    && !!migrateResult.value
    && migrateResult.value.failedCount === 0
    && migrateResult.value.successCount > 0,
);

/** "全部重试" 按钮仅 done 态 + 有失败时显示 */
const canRetryAll = computed(() =>
  phase.value === 'done'
    && !!migrateResult.value
    && migrateResult.value.failures.length > 0,
);

// ============================================
// 服务 ID（chip group 消费）
// ============================================

const targetServiceIds = computed(() => checkedTargets.value.map(t => t.serviceId));

const sourceServiceIds = computed(() => {
  const filterIds = sourceServiceFilter.value;
  const all = availableSourceServices.value;
  const active = filterIds.length > 0 ? all.filter(s => filterIds.includes(s.id)) : all;
  return active.map(s => s.id);
});

const doneTargetServiceIds = computed(() => migrateResult.value?.targetServiceIds ?? []);

// ============================================
// 操作处理
// ============================================

function handleRetryAll() {
  if (!migrateResult.value) return;
  const ids = migrateResult.value.failures.map(f => f.historyId);
  if (ids.length > 0) retryFailed(ids);
}
function handleRetryOne(id: string) { retrySingleFailed(id); }

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
  <div class="focus-area">
    <div class="focus-header">
      <span class="focus-title">{{ focusTitle }}</span>
      <!-- migrating: 暂停指示 -->
      <span
        v-if="phase === 'migrating' && isPausing"
        class="focus-pause-tag focus-pause-tag--pending"
      >
        <i class="pi pi-spin pi-spinner" /> 正在暂停…
      </span>
      <span
        v-else-if="phase === 'migrating' && isPaused"
        class="focus-pause-tag focus-pause-tag--paused"
      >
        <i class="pi pi-pause-circle" /> 已暂停
      </span>
      <!-- done: 全成功指示 -->
      <span
        v-else-if="showAllSuccess"
        class="focus-status focus-status--ok"
      >
        <span class="focus-status-dot" /> 全部成功
      </span>
      <span class="focus-spacer" />
      <button
        v-if="canRetryAll"
        class="focus-retry-all"
        type="button"
        :disabled="retryingIds.size > 0"
        @click="handleRetryAll"
      >
        <i class="pi pi-refresh" /> 全部重试
      </button>
    </div>

    <MigrateStatusFilterChips
      v-model="activeFilter"
      :counts="filterCounts"
      :show-processing="phase === 'migrating'"
    />

    <div ref="listRef" class="focus-list">
      <!-- migrating -->
      <template v-if="phase === 'migrating'">
        <template v-if="showInitialSkeleton">
          <MigrateSkeletonCard v-for="slot in slots" :key="slot.id" />
        </template>
        <template v-else-if="filteredMigratingList.length > 0">
          <MigrateActiveCard
            v-for="entry in filteredMigratingList"
            :key="entry.item.historyId"
            :item="entry.item"
            :source-service-ids="sourceServiceIds"
            :target-service-ids="targetServiceIds"
            :variant="entry.role === 'active' ? 'slot' : 'snapshot'"
            :slot-state="entry.role === 'active' ? 'active' : 'complete'"
          />
        </template>
        <div v-else class="focus-empty">
          <i class="pi pi-inbox focus-empty-ic" />
          <span>{{ emptyHint }}</span>
        </div>
      </template>

      <!-- done -->
      <template v-else-if="phase === 'done'">
        <template v-if="filteredDoneList.length > 0">
          <MigrateDoneRow
            v-for="item in filteredDoneList"
            :key="item.historyId"
            :item="item"
            :source-service-ids="sourceServiceIds"
            :target-service-ids="doneTargetServiceIds"
            :show-retry="item.status === 'failed'"
            :retrying="!!(item.historyId && retryingIds.has(item.historyId))"
            @retry="handleRetryOne"
          />
        </template>
        <div v-else class="focus-empty">
          <i class="pi pi-inbox focus-empty-ic" />
          <span>{{ emptyHint }}</span>
        </div>
      </template>
    </div>
  </div>

  <MigrateBottomBar
    :mode="phase === 'done' ? 'done' : 'migrating'"
    :is-paused="isPaused"
    :is-pausing="isPausing"
    @pause="handlePause"
    @resume="handleResume"
    @cancel="cancelMigrate"
    @done="resetToConfiguring"
    @restart="resetToConfiguring"
    @export="handleExport"
  />
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

.focus-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--text-sm);
  flex-shrink: 0;
}
.focus-title { font-weight: var(--weight-semibold); color: var(--text-primary); }
.focus-spacer { flex: 1; }

.focus-pause-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-xs-sm);
  border-radius: var(--radius-sm);
  font-size: var(--text-2xs);
  font-weight: var(--weight-medium);
}
.focus-pause-tag i { font-size: var(--text-2xs); }

.focus-pause-tag--pending {
  background: var(--state-warn-bg-soft);
  color: var(--state-warn-text);
}

.focus-pause-tag--paused {
  background: var(--bg-input);
  color: var(--text-muted);
}

.focus-status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.focus-status-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--success);
}

.focus-retry-all {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm-md);
  border: none;
  border-radius: var(--radius-sm-md);
  background: var(--error);
  color: var(--text-on-error, #fff);
  font-family: inherit;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  cursor: pointer;
  flex-shrink: 0;
  transition: background var(--duration-fast);
}
.focus-retry-all:disabled { opacity: 0.55; cursor: not-allowed; }

.focus-retry-all:hover:not(:disabled) {
  background: color-mix(in srgb, var(--error) 85%, black);
}
.focus-retry-all i { font-size: var(--text-2xs); }

.focus-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm-md);
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  padding-right: var(--space-xs);
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
