<script setup lang="ts">
/**
 * 补充备份 · 进行中 / 完成（同一块面板）
 *
 * 顶部结论卡：进行中报进度与剩余时间（暂停 / 停止），完成后一句结论 + 这一刻该点的按钮
 * （有失败先「重试失败的」）；下面「全部 / 失败」+ 搜索，一张图一行。导出报告在卡片的「⋯」里。
 */
import { computed, inject, nextTick, ref, watch } from 'vue';
import Menu from 'primevue/menu';
import type { MenuItem } from 'primevue/menuitem';
import { watchDebounced } from '@vueuse/core';
import { useToast } from '@/composables/useToast';
import { useConfigManager } from '@/composables/useConfig';
import { makeCopyBadgeKey, useCopyBadgeFeedback } from '@/composables/useCopyBadgeFeedback';
import { applyConfiguredUrlWithConfig } from '@/composables/useCopyLink';
import { createLogger } from '@/utils/logger';
import { historyDB } from '@/services/database';
import { getServiceDisplayName } from '@/constants/serviceNames';
import { MIGRATE_KEY } from './keys';
import { buildCsvReport, buildTxtReport } from './reportExport';
import type { MigrateItemStatus } from '@/types/batchMigrate';
import MigrateItemRow from './components/MigrateItemRow.vue';
import type { MigrateRowItem } from './components/migrateRowTypes';
import SummaryCard from '@/components/views/link-check/common/SummaryCard.vue';
import ViewSwitch from '@/components/views/link-check/common/ViewSwitch.vue';
import SearchField from '@/components/views/link-check/common/SearchField.vue';
import ListPager from '@/components/views/link-check/common/ListPager.vue';
import { buildDoneVerdict, buildRunVerdict, type MigrateVerdictAction } from '@/composables/batch-migrate/migrateVerdict';
import { exportTextFile } from '@/utils/userFiles';
import { getCopiesThumbnailCandidates } from '@/composables/image/useThumbCache';
import { getConfirmedHttpHosts } from '@/security/networkPolicy';

const PAGE_SIZE = 100;

const log = createLogger('MigrateProgressPhase');
const toast = useToast();
const configManager = useConfigManager();
const { copiedKey, markCopied } = useCopyBadgeFeedback();

const ctx = inject(MIGRATE_KEY)!;
const {
  phase, allItemStatuses, checkedTargets, cancelMigrate,
  migrateResult, resetToConfiguring, retryingIds, retryFailed, retrySingleFailed,
  isPaused, isPausing, isCancelling, pauseMigrate, resumeMigrate,
  migrateStats, globalProgress, cumulativeCounts, estimatedTimeRemaining,
} = ctx;

// ---- 列表数据：进行中读实时状态，完成后读终态快照 ----

function hasFailedTarget(item: Pick<MigrateRowItem, 'serviceResults'>): boolean {
  return Object.values(item.serviceResults ?? {}).some(state => state === 'failed');
}

function isFailedRow(item: MigrateRowItem): boolean {
  return item.status === 'failed' || hasFailedTarget(item);
}

function toRowItem(item: MigrateItemStatus, detailsOverride?: MigrateItemStatus['failureDetails']): MigrateRowItem {
  return {
    historyId: item.historyId,
    fileName: item.fileName,
    sourceUrl: item.sourceUrl,
    sourceServiceId: item.sourceServiceId,
    status: item.status,
    skipReason: item.skipReason,
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
      toRowItem(item, (item.status === 'failed' || hasFailedTarget(item)) ? failureDetailsById.get(item.historyId) : undefined),
    );
  }
  return allItemStatuses.value.map(item => toRowItem(item));
});

const currentTargetServiceIds = computed(() => {
  if (phase.value === 'done') return migrateResult.value?.targetServiceIds ?? [];
  return checkedTargets.value.map(t => t.serviceId);
});
const targetNames = computed(() => currentTargetServiceIds.value.map(id => getServiceDisplayName(id)));

// ---- 「全部 / 失败」+ 搜索 + 分页 ----

type ListView = 'all' | 'failed';
const view = ref<ListView>('all');
const searchInput = ref('');
const searchQuery = ref('');
const page = ref(1);
const listRef = ref<HTMLElement | null>(null);

watchDebounced(searchInput, (value) => { searchQuery.value = value.trim().toLowerCase(); }, { debounce: 200 });

const scoped = computed(() => {
  const query = searchQuery.value;
  return query ? rawList.value.filter(item => item.fileName.toLowerCase().includes(query)) : rawList.value;
});
const failedCount = computed(() => scoped.value.filter(isFailedRow).length);
const listed = computed(() => (view.value === 'failed' ? scoped.value.filter(isFailedRow) : scoped.value));
const totalPages = computed(() => Math.max(1, Math.ceil(listed.value.length / PAGE_SIZE)));
const visible = computed(() => listed.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const viewOptions = computed(() => [
  { value: 'all' as const, label: '全部', count: scoped.value.length },
  { value: 'failed' as const, label: '失败', count: failedCount.value },
]);

function scrollListTop(): void {
  nextTick(() => { if (listRef.value) listRef.value.scrollTop = 0; });
}

watch([view, searchQuery], () => { page.value = 1; scrollListTop(); });
watch(page, scrollListTop);
watch(totalPages, (count) => { if (page.value > count) page.value = count; });

// 进入完成态：有失败直接看失败的；重新开始：回到全部、清掉搜索
watch(phase, (p) => {
  view.value = p === 'done' && (migrateResult.value?.failures.length ?? 0) > 0 ? 'failed' : 'all';
  searchInput.value = '';
  searchQuery.value = '';
  page.value = 1;
  scrollListTop();
}, { immediate: true });

const emptyHint = computed(() => {
  if (searchQuery.value) return '没有找到相关图片';
  if (phase.value === 'migrating' && rawList.value.length === 0) return '正在准备要复制的图片…';
  if (view.value === 'failed') return '没有失败的';
  return '这里还没有图片';
});

// ---- 结论卡 ----

const verdict = computed(() => {
  if (phase.value === 'done' && migrateResult.value) {
    return buildDoneVerdict({ targets: targetNames.value, result: migrateResult.value, retrying: retryingIds.value.size });
  }
  const counts = cumulativeCounts.value;
  return buildRunVerdict({
    targets: targetNames.value,
    done: counts.success + counts.failed + counts.skipped,
    total: globalProgress.value.total || migrateStats.value.totalCount,
    success: counts.success,
    failed: counts.failed,
    paused: isPaused.value,
    pausing: isPausing.value,
    cancelling: isCancelling.value,
    etaMs: estimatedTimeRemaining.value,
  });
});

const progressPercent = computed(() => (phase.value === 'migrating' ? globalProgress.value.percent : null));

function retryAllFailed(): void {
  const ids = migrateResult.value?.failures.map(f => f.historyId) ?? [];
  if (ids.length > 0) void retryFailed(ids);
}

function runAction(action: MigrateVerdictAction): void {
  switch (action) {
    case 'pause': pauseMigrate(); break;
    case 'resume': resumeMigrate(); break;
    case 'cancel': cancelMigrate(); break;
    case 'retry-failed': retryAllFailed(); break;
    case 'done': void resetToConfiguring(); break;
    case 'start': break;
  }
}

const cardMenuRef = ref<InstanceType<typeof Menu> | null>(null);
const cardMenuItems: MenuItem[] = [
  { label: '导出报告（CSV）', icon: 'pi pi-file-excel', command: () => handleExport('csv') },
  { label: '导出报告（TXT）', icon: 'pi pi-file', command: () => handleExport('txt') },
];

async function handleExport(format: 'csv' | 'txt') {
  const r = migrateResult.value;
  if (!r) return;
  try {
    const content = format === 'csv' ? buildCsvReport(r) : buildTxtReport(r);
    const path = await exportTextFile(
      `picnexus-backup-${Date.now()}.${format}`,
      [{ name: format.toUpperCase(), extensions: [format] }],
      content,
    );
    if (path) toast.success('导出成功', `已保存至 ${path}`);
  } catch (e) {
    log.error('导出失败', e);
    toast.error('导出失败', e instanceof Error ? e.message : String(e));
  }
}

// ---- 行上的动作 ----

const confirmedHttpHosts = computed(() => getConfirmedHttpHosts(configManager.config.value));

function rowThumbSrcs(item: MigrateRowItem): string[] {
  if (!item.sourceUrl) return [];
  return getCopiesThumbnailCandidates(
    [{ serviceId: item.sourceServiceId ?? '', url: item.sourceUrl }],
    configManager.config.value,
  );
}

function needsRetry(item: MigrateRowItem): boolean {
  if (phase.value !== 'done' || !migrateResult.value || !item.historyId) return false;
  return migrateResult.value.failures.some(f => f.historyId === item.historyId);
}

async function handleCopyUrl(historyId: string, serviceId: string) {
  try {
    const items = await historyDB.getItemsByIds([historyId]);
    const url = items[0]?.results.find(r => r.serviceId === serviceId && r.status === 'success')?.result?.url;
    if (!url) {
      toast.warn('复制失败', '链接还没准备好');
      return;
    }
    await navigator.clipboard.writeText(applyConfiguredUrlWithConfig(url, serviceId, configManager.config.value));
    markCopied(makeCopyBadgeKey('migrate', historyId, serviceId));
    toast.silent('log', '已复制链接');
  } catch (e) {
    log.error('复制链接失败', e);
    toast.error('复制失败', String(e));
  }
}
</script>

<template>
  <SummaryCard
    :tone="verdict.tone"
    icon="pi pi-stop-circle"
    :title="verdict.title"
    :subtitle="verdict.subtitle"
    :progress="progressPercent"
  >
    <template v-if="verdict.primary || verdict.secondary || phase === 'done'" #actions>
      <button
        v-if="verdict.secondary"
        type="button"
        class="summary-btn summary-btn--ghost"
        :disabled="verdict.secondary.disabled"
        @click="runAction(verdict.secondary.action)"
      >
        {{ verdict.secondary.label }}
      </button>
      <button
        v-if="verdict.primary"
        type="button"
        class="summary-btn summary-btn--primary"
        :disabled="verdict.primary.disabled"
        @click="runAction(verdict.primary.action)"
      >
        {{ verdict.primary.label }}
      </button>
      <template v-if="phase === 'done'">
        <button type="button" class="summary-btn summary-btn--icon" aria-label="更多操作" @click="cardMenuRef?.toggle($event)">
          <i class="pi pi-ellipsis-h" aria-hidden="true"></i>
        </button>
        <Menu ref="cardMenuRef" :model="cardMenuItems" popup append-to="body" />
      </template>
    </template>
  </SummaryCard>

  <div class="progress-toolbar">
    <ViewSwitch v-model="view" :options="viewOptions" group-label="列表范围" />
    <div class="toolbar-spacer"></div>
    <SearchField v-model="searchInput" placeholder="搜索文件名" />
  </div>

  <div ref="listRef" class="progress-list">
    <template v-if="visible.length > 0">
      <MigrateItemRow
        v-for="(item, idx) in visible"
        :key="item.historyId || `${item.fileName}-${idx}`"
        :item="item"
        :target-service-ids="currentTargetServiceIds"
        :show-retry="needsRetry(item)"
        :retrying="!!(item.historyId && retryingIds.has(item.historyId))"
        :copied-key="copiedKey"
        :thumb-srcs="rowThumbSrcs(item)"
        :confirmed-http-hosts="confirmedHttpHosts"
        @retry="retrySingleFailed"
        @copy-url="handleCopyUrl"
      />
      <ListPager v-model:page="page" :total-pages="totalPages" />
    </template>
    <div v-else class="progress-empty">
      <i class="pi pi-inbox progress-empty-icon" aria-hidden="true"></i>
      <span>{{ emptyHint }}</span>
    </div>
  </div>
</template>

<style scoped>
.progress-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-sm-md);
  flex-shrink: 0;
}

.toolbar-spacer {
  flex: 1;
}

.progress-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  flex: 1;
  min-height: 0;
  margin: 0 calc(var(--space-xl) * -1);
  padding: 0 var(--space-xl) var(--space-lg-xl);
  overflow-y: auto;

  /* 滚动条出现、消失时行宽不变，右侧按钮不跳 */
  scrollbar-gutter: stable;
}

.progress-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-4xl) var(--space-xl);
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.progress-empty-icon {
  font-size: var(--text-3xl);
  color: var(--text-disabled);
}
</style>
