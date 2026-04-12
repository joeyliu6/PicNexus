<script setup lang="ts">
/**
 * 链接维护主视图
 * 「链接监控」「文档修复」「批量迁移」通过 Tab 栏平行切换
 */
import { ref, computed, watch, inject, onMounted, onActivated, onDeactivated } from 'vue';
import type { Ref } from 'vue';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import HistoryCheckPanel from './linkcheck/HistoryCheckPanel.vue';
import MdRescueInline from './linkcheck/MdRescueInline.vue';
import BatchMigratePanel from './linkcheck/BatchMigratePanel.vue';
import { useLinkCheckManager } from '../../composables/useLinkCheck';
import { useHistoryManager } from '../../composables/useHistory';
import { useToast } from '../../composables/useToast';
import type { LinkCheckRow } from '../../types/linkCheck';

const toast = useToast();

type LinkCheckTab = 'monitor' | 'rescue' | 'migrate';
const activeTab = ref<LinkCheckTab>('monitor');

// 外部导航支持（与 settingsTargetTab 模式一致）
const linkCheckTargetTab = inject<Ref<string | null>>('linkCheckTargetTab');

function applyTargetTab() {
  if (linkCheckTargetTab?.value) {
    if (linkCheckTargetTab.value === 'rescue' || linkCheckTargetTab.value === 'monitor' || linkCheckTargetTab.value === 'migrate') {
      activeTab.value = linkCheckTargetTab.value;
    }
    linkCheckTargetTab.value = null;
  }
}

if (linkCheckTargetTab) {
  watch(linkCheckTargetTab, (val) => { if (val) applyTargetTab(); });
}

const {
  isChecking: monitorChecking,
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
  exportCsv,
  removeRowsByHistoryIds,
  setFadingOut,
  onViewActivated,
  onViewDeactivated,
} = useLinkCheckManager();

const { deleteHistoryItem, bulkDeleteRecords } = useHistoryManager();

// 仅当检测来源为 monitor 时，HistoryCheckPanel 才把自己视为"检测中"
// 否则文档修复扫描时会误禁用监控 Tab 的按钮
const monitorIsChecking = computed(
  () => monitorChecking.value && progressSource.value !== 'rescue',
);

// ============================================
// Monitor 操作
// ============================================

async function handleExportCsv() {
  const csv = exportCsv(checkRows.value);
  const path = await save({
    defaultPath: `link-check-${Date.now()}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (path) {
    await writeTextFile(path, csv);
    toast.success('导出成功', `已保存至 ${path}`);
  }
}

function handleCopyUrl(url: string) {
  navigator.clipboard.writeText(url);
  toast.success('已复制到剪贴板');
}

async function handleRecheckSingle(row: LinkCheckRow, filter?: 'unchecked' | 'invalid' | 'timeout' | 'suspicious' | 'valid' | 'all' | null) {
  await recheckSingle(row, filter ?? undefined);
}

async function handleDeleteRow(row: LinkCheckRow) {
  const ok = await deleteHistoryItem(row.historyId); // 确认弹窗在此，用户先确认
  if (ok) {
    setFadingOut([row.historyId], true);
    await new Promise((resolve) => setTimeout(resolve, 380));
    removeRowsByHistoryIds([row.historyId]);
  }
}

async function handleDeleteBatch(ids: string[]) {
  const ok = await bulkDeleteRecords(ids); // 确认弹窗在此
  if (ok) {
    setFadingOut(ids, true);
    await new Promise((resolve) => setTimeout(resolve, 380));
    removeRowsByHistoryIds(ids);
  }
}

async function handleRecheckBatch(ids: string[]) {
  await checkSubset({ historyIds: ids });
}

// ============================================
// 生命周期
// ============================================

onMounted(() => {
  loadHistoryRows();
});

onActivated(() => {
  onViewActivated();
  applyTargetTab();
});
onDeactivated(onViewDeactivated);
</script>

<template>
  <div class="link-check-view">
    <!-- Tab 栏 -->
    <div class="lc-tab-bar">
      <button
        class="lc-tab"
        :class="{ active: activeTab === 'monitor' }"
        @click="activeTab = 'monitor'"
      >
        <i class="pi pi-shield" />
        链接监控
      </button>
      <button
        class="lc-tab"
        :class="{ active: activeTab === 'rescue' }"
        @click="activeTab = 'rescue'"
      >
        <i class="pi pi-file-edit" />
        文档修复
      </button>
      <button
        class="lc-tab"
        :class="{ active: activeTab === 'migrate' }"
        @click="activeTab = 'migrate'"
      >
        <i class="pi pi-sync" />
        批量迁移
      </button>
    </div>

    <!-- Tab 内容区 -->
    <KeepAlive>
      <HistoryCheckPanel
        v-if="activeTab === 'monitor'"
        key="monitor"
        :check-rows="checkRows"
        :is-checking="monitorIsChecking"
        :is-loading="isLoading"
        :is-phase2-loading="isPhase2Loading"
        :phase2-duration="phase2Duration"
        :progress="monitorProgress"
        :progress-source="progressSource"
        @check-all="checkAllHistoryLinks"
        @check-subset="(f: { statusFilter?: 'unchecked' | 'invalid' | 'timeout' | 'suspicious' | 'valid' | 'problems'; serviceId?: string }) => checkSubset(f)"
        @cancel-check="cancelCheck"
        @recheck-single="handleRecheckSingle"
        @copy-url="handleCopyUrl"
        @export-csv="handleExportCsv"
        @delete-row="handleDeleteRow"
        @delete-batch="handleDeleteBatch"
        @recheck-batch="handleRecheckBatch"
      />
      <MdRescueInline
        v-else-if="activeTab === 'rescue'"
        key="rescue"
      />
      <BatchMigratePanel
        v-else-if="activeTab === 'migrate'"
        key="migrate"
      />
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

/* Tab 栏 —— 对齐浏览页 .dashboard-strip + .tab-nav */
.lc-tab-bar {
  display: flex;
  gap: 2px;
  height: 48px;
  padding: 0 12px;
  align-items: stretch;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.lc-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  cursor: pointer;
  position: relative;
  transition: color var(--duration-fast), background var(--duration-fast);
  border-radius: 8px 8px 0 0;
  font-family: inherit;
}

.lc-tab i { font-size: var(--text-base); }

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
  border-radius: 1px 1px 0 0;
}
</style>
