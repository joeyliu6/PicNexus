<script setup lang="ts">
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { save } from '@tauri-apps/plugin-dialog';
import { computed, inject, onActivated, onDeactivated, onMounted, ref, watch } from 'vue';
import type { Ref } from 'vue';
import { useHistoryManager } from '../../composables/useHistory';
import { useLinkCheckBulkActions } from '../../composables/link-check/useLinkCheckBulkActions';
import { useLinkCheckManager } from '../../composables/useLinkCheck';
import { useConfigManager } from '../../composables/useConfig';
import { useToast } from '../../composables/useToast';
import { applyZhihuSourceFromConfig } from '../../utils/zhihuSource';
import type { LinkCheckRow } from '../../types/linkCheck';
import BatchMigratePanel from './linkcheck/BatchMigratePanel.vue';
import HistoryCheckPanel from './linkcheck/HistoryCheckPanel.vue';
import MdRescueInline from './linkcheck/MdRescueInline.vue';

const toast = useToast();
const configManager = useConfigManager();

type LinkCheckTab = 'monitor' | 'rescue' | 'migrate';

const activeTab = ref<LinkCheckTab>('monitor');
const linkCheckTargetTab = inject<Ref<string | null>>('linkCheckTargetTab');

function applyTargetTab(): void {
  if (!linkCheckTargetTab?.value) return;

  if (
    linkCheckTargetTab.value === 'rescue'
    || linkCheckTargetTab.value === 'monitor'
    || linkCheckTargetTab.value === 'migrate'
  ) {
    activeTab.value = linkCheckTargetTab.value;
  }

  linkCheckTargetTab.value = null;
}

if (linkCheckTargetTab) {
  watch(linkCheckTargetTab, (value) => {
    if (value) applyTargetTab();
  });
}

const {
  isChecking: monitorChecking,
  isPaused: monitorPaused,
  isLoading,
  isPhase2Loading,
  phase2Duration,
  progress: monitorProgress,
  progressSource,
  checkRows,
  loadHistoryRows,
  checkAllHistoryLinks,
  checkSubset,
  recheckSingle,
  cancelCheck,
  pauseCheck,
  resumeCheck,
  exportCsv,
  removeRowsByKeys,
  setFadingOutRows,
  onViewActivated,
  onViewDeactivated,
} = useLinkCheckManager();

const { deleteHistoryResult, bulkDeleteHistoryResults } = useHistoryManager();

const monitorIsChecking = computed(
  () => monitorChecking.value && progressSource.value !== 'rescue',
);

async function handleExportCsv(): Promise<void> {
  const csv = exportCsv(checkRows.value);
  const path = await save({
    defaultPath: `link-check-${Date.now()}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });

  if (!path) return;

  await writeTextFile(path, csv);
  toast.success('导出成功', `已保存至 ${path}`);
}

async function handleExportCsvSelected(rows: LinkCheckRow[]): Promise<void> {
  const csv = exportCsv(rows);
  const path = await save({
    defaultPath: `link-check-selected-${Date.now()}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });

  if (!path) return;

  await writeTextFile(path, csv);
  toast.success('导出成功', `已保存至 ${path}`);
}

function handleCopyUrl(url: string): void {
  const finalUrl = applyZhihuSourceFromConfig(url, configManager.config.value);
  void navigator.clipboard.writeText(finalUrl);
  toast.silent('log', '已复制到剪贴板');
}

async function handleRecheckSingle(
  row: LinkCheckRow,
  filter?: 'unchecked' | 'invalid' | 'timeout' | 'suspicious' | 'valid' | 'all' | null,
): Promise<void> {
  await recheckSingle(row, filter ?? undefined);
}

async function deleteRowsByTargets(rows: LinkCheckRow[]): Promise<boolean> {
  const ok = await bulkDeleteHistoryResults(
    rows.map((r) => ({ historyId: r.historyId, serviceId: r.serviceId })),
  );
  if (ok) {
    setFadingOutRows(rows, true);
    await new Promise((resolve) => setTimeout(resolve, 380));
    removeRowsByKeys(rows);
  }
  return ok;
}

async function handleDeleteRow(row: LinkCheckRow): Promise<void> {
  const outcome = await deleteHistoryResult(row.historyId, row.serviceId);
  if (!outcome) return;
  setFadingOutRows([row], true);
  await new Promise((resolve) => setTimeout(resolve, 380));
  removeRowsByKeys([row]);
}

async function recheckRowsByIds(ids: string[]): Promise<void> {
  await checkSubset({ historyIds: ids });
}

const {
  isBulkActing,
  bulkRecheck,
  bulkCopyUrls,
  bulkDelete,
} = useLinkCheckBulkActions({
  recheckRows: recheckRowsByIds,
  deleteRows: deleteRowsByTargets,
});

onMounted(() => {
  void loadHistoryRows();
});

onActivated(() => {
  onViewActivated();
  applyTargetTab();
});

onDeactivated(onViewDeactivated);
</script>

<template>
  <div class="link-check-view">
    <div class="lc-tab-bar">
      <button class="lc-tab" :class="{ active: activeTab === 'monitor' }" @click="activeTab = 'monitor'">
        <i class="pi pi-link"></i>
        链接检测
      </button>
      <button class="lc-tab" :class="{ active: activeTab === 'rescue' }" @click="activeTab = 'rescue'">
        <i class="pi pi-eraser"></i>
        文档修复
      </button>
      <button class="lc-tab" :class="{ active: activeTab === 'migrate' }" @click="activeTab = 'migrate'">
        <i class="pi pi-arrow-right-arrow-left"></i>
        批量迁移
      </button>
    </div>

    <KeepAlive>
      <HistoryCheckPanel
        v-if="activeTab === 'monitor'"
        key="monitor"
        :check-rows="checkRows"
        :is-checking="monitorIsChecking"
        :is-paused="monitorPaused"
        :is-loading="isLoading"
        :is-phase2-loading="isPhase2Loading"
        :phase2-duration="phase2Duration"
        :progress="monitorProgress"
        :progress-source="progressSource"
        :is-action-locked="isBulkActing"
        @check-all="checkAllHistoryLinks"
        @check-subset="(filter) => checkSubset(filter)"
        @cancel-check="cancelCheck"
        @pause-check="pauseCheck"
        @resume-check="resumeCheck"
        @recheck-single="handleRecheckSingle"
        @copy-url="handleCopyUrl"
        @export-csv="handleExportCsv"
        @export-csv-selected="handleExportCsvSelected"
        @delete-row="handleDeleteRow"
        @bulk-recheck="bulkRecheck"
        @bulk-copy="bulkCopyUrls"
        @bulk-delete="bulkDelete"
      />

      <MdRescueInline v-else-if="activeTab === 'rescue'" key="rescue" />
      <BatchMigratePanel v-else-if="activeTab === 'migrate'" key="migrate" />
    </KeepAlive>
  </div>
</template>

<style scoped>
.link-check-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-app);
}

.lc-tab-bar {
  display: flex;
  gap: var(--space-2xs);
  height: 48px;
  padding: 0 var(--space-md);
  align-items: stretch;
  background-color: var(--bg-card);
  border-bottom: 1px solid var(--border-subtle);
  z-index: 10;
  flex-shrink: 0;
}

.lc-tab {
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  padding: 0 var(--space-md-lg);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  cursor: pointer;
  position: relative;
  transition: color var(--duration-fast), background var(--duration-fast);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  font-family: inherit;
}

.lc-tab i {
  font-size: var(--text-base);
}

.lc-tab:hover {
  color: var(--text-primary);
  background: var(--hover-overlay);
}

.lc-tab.active {
  color: var(--primary);
}

.lc-tab.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 8px;
  right: 8px;
  height: 2px;
  background: var(--primary);
  border-radius: var(--radius-xs) var(--radius-xs) 0 0;
}
</style>
