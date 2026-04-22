<script setup lang="ts">
/**
 * 迁移执行面板 — migrating / done 双态统一
 *
 * 结构简化为：chip 过滤条（含可选"全部重试"按钮） + 统一单行列表（MigrateItemRow）+ 底栏。
 * 顶部不再有"正在处理 / 已暂停 / 全部成功"这类指示——运行状态收到底栏的 state-pill。
 *
 * migrating 态列表数据源为 allItemStatuses（含正在处理和已落地两类），
 * 由 chip 过滤分桶；done 态列表数据源为 migrateResult.itemsSnapshot。
 */
import { inject, computed, ref, watch, nextTick } from 'vue';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useToast } from '../../../../composables/useToast';
import { createLogger } from '../../../../utils/logger';
import { historyDB } from '../../../../services/database';
import { MIGRATE_KEY } from './keys';
import { buildCsvReport, buildTxtReport } from './reportExport';
import type { MigrateItemStatus } from '../../../../types/batchMigrate';
import MigrateItemRow, { type MigrateRowItem } from './components/MigrateItemRow.vue';
import MigrateBottomBar from './components/MigrateBottomBar.vue';
import MigratePagination from './components/MigratePagination.vue';
import MigrateStatusFilterChips, {
  type MigrateStatusFilter,
} from './components/chips/MigrateStatusFilterChips.vue';

const PAGE_SIZE = 100;

const log = createLogger('MigrateProgressPhase');
const toast = useToast();

const ctx = inject(MIGRATE_KEY)!;
const {
  phase, allItemStatuses, checkedTargets, cancelMigrate,
  migrateResult, resetToConfiguring, retryingIds, retryFailed,
  retrySingleFailed,
  isPaused, isPausing, pauseMigrate, resumeMigrate,
} = ctx;

// ============================================
// chip 过滤状态 & 分页 & 滚动控制
// ============================================

const activeFilter = ref<MigrateStatusFilter>('all');
const listRef = ref<HTMLElement | null>(null);
/** 每个 filter 独立保留当前页码，切换 filter 不丢上下文 */
const pageByFilter = new Map<MigrateStatusFilter, number>();
const currentPage = ref(1);

watch(phase, (p) => {
  // 进入 done：有失败自动选中「失败」chip，全成功则「全部」
  if (p === 'done') {
    const failCount = migrateResult.value?.failedCount ?? 0;
    activeFilter.value = failCount > 0 ? 'failed' : 'all';
  } else if (p === 'migrating') {
    activeFilter.value = 'all';
  }
  // 重置分页记忆
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
  // migrating 态：allItemStatuses 头部是最新一批（批次开始时 prepend）
  return allItemStatuses.value.map(item => toRowItem(item));
});

// ============================================
// 过滤 & 排序
// ============================================

const displayList = computed<MigrateRowItem[]>(() => {
  const f = activeFilter.value;
  let items = rawList.value;
  if (f === 'processing') {
    items = items.filter(s => ACTIVE_STATUSES.has(s.status));
  } else if (f === 'success') {
    items = items.filter(s => s.status === 'success');
  } else if (f === 'failed') {
    items = items.filter(s => s.status === 'failed');
  } else if (f === 'skipped') {
    items = items.filter(s => s.status === 'skipped');
  }
  // migrating 态的「全部」视图：活跃项在前，终态在后
  if (phase.value === 'migrating' && f === 'all') {
    const grouped = [...items];
    grouped.sort((a, b) => {
      const aActive = ACTIVE_STATUSES.has(a.status) ? 0 : 1;
      const bActive = ACTIVE_STATUSES.has(b.status) ? 0 : 1;
      return aActive - bActive;
    });
    return grouped;
  }
  return items;
});

const filterCounts = computed(() => {
  const items = rawList.value;
  let processing = 0, success = 0, failed = 0, skipped = 0;
  for (const it of items) {
    if (ACTIVE_STATUSES.has(it.status)) processing++;
    else if (it.status === 'success') success++;
    else if (it.status === 'failed') failed++;
    else if (it.status === 'skipped') skipped++;
  }
  return { all: items.length, processing, success, failed, skipped };
});

// ============================================
// 分页切片：displayList → visibleList（仅渲染当前页）
// ============================================

const totalPages = computed(() =>
  Math.max(1, Math.ceil(displayList.value.length / PAGE_SIZE)),
);

// 当前列表收缩导致页码越界时自动 clamp
watch([totalPages, currentPage], ([tp, cp]) => {
  if (cp > tp) currentPage.value = tp;
  if (cp < 1) currentPage.value = 1;
});

const visibleList = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE;
  return displayList.value.slice(start, start + PAGE_SIZE);
});

const showPagination = computed(() => displayList.value.length > PAGE_SIZE);

// ============================================
// 派生 UI
// ============================================

const emptyHint = computed(() => {
  if (displayList.value.length > 0) return '';
  if (phase.value === 'migrating' && rawList.value.length === 0) return '正在启动迁移…';
  switch (activeFilter.value) {
    case 'processing': return '当前没有正在处理的项';
    case 'success': return '暂无已完成项';
    case 'failed': return '暂无失败项';
    case 'skipped': return '暂无跳过项';
    default: return '暂无数据';
  }
});

/** "全部重试" 按钮仅 done 态 + 有失败时显示 */
const canRetryAll = computed(() =>
  phase.value === 'done'
    && !!migrateResult.value
    && migrateResult.value.failures.length > 0,
);

// ============================================
// 服务 ID（chip group 消费）
// ============================================

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

async function handleCopyNewUrl(historyId: string) {
  try {
    // 定位本次新增的目标图床：在 rawList 里找到该条，取 serviceResults=success 且不在 existingServiceIds 中的第一个
    const row = rawList.value.find(r => r.historyId === historyId);
    if (!row) return;
    const existing = new Set(row.existingServiceIds ?? []);
    const newTargetId = Object.entries(row.serviceResults ?? {})
      .find(([sid, state]) => state === 'success' && !existing.has(sid))?.[0];
    if (!newTargetId) {
      toast.warn('未找到新 URL', '该图床尚无成功记录');
      return;
    }
    const items = await historyDB.getItemsByIds([historyId]);
    const url = items[0]?.results.find(r => r.serviceId === newTargetId && r.status === 'success')?.result?.url;
    if (!url) {
      toast.warn('复制失败', 'URL 未就绪');
      return;
    }
    await navigator.clipboard.writeText(url);
    toast.success('已复制新 URL');
  } catch (e) {
    log.error('复制新 URL 失败', e);
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
  <div class="focus-area">
    <div class="chip-row">
      <MigrateStatusFilterChips
        v-model="activeFilter"
        :counts="filterCounts"
        :show-processing="phase === 'migrating'"
      />
      <span class="chip-row__spacer" />
      <button
        v-if="canRetryAll"
        class="chip-row__retry-all"
        type="button"
        :disabled="retryingIds.size > 0"
        @click="handleRetryAll"
      >
        <i class="pi pi-refresh" /> 全部重试
      </button>
    </div>

    <div ref="listRef" class="focus-list">
      <template v-if="visibleList.length > 0">
        <MigrateItemRow
          v-for="(item, idx) in visibleList"
          :key="item.historyId || `${item.fileName}-${idx}`"
          :item="item"
          :target-service-ids="currentTargetServiceIds"
          :show-retry="phase === 'done' && item.status === 'failed'"
          :retrying="!!(item.historyId && retryingIds.has(item.historyId))"
          @retry="handleRetryOne"
          @copy-url="handleCopyNewUrl"
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
    @pause="handlePause"
    @resume="handleResume"
    @cancel="cancelMigrate"
    @done="resetToConfiguring"
    @restart="resetToConfiguring"
    @export="handleExport"
  >
    <template #pagination>
      <MigratePagination
        v-if="showPagination"
        :current-page="currentPage"
        :total-pages="totalPages"
        :total-items="displayList.length"
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

.chip-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.chip-row__spacer { flex: 1; }

.chip-row__retry-all {
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
.chip-row__retry-all:disabled { opacity: 0.55; cursor: not-allowed; }

.chip-row__retry-all:hover:not(:disabled) {
  background: color-mix(in srgb, var(--error) 85%, black);
}
.chip-row__retry-all i { font-size: var(--text-2xs); }

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
