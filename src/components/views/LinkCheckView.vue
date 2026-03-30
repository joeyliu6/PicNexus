<script setup lang="ts">
/**
 * 链接检测主视图
 * 直接展示链接监控面板，文档修复通过弹窗触发
 */
import { ref, onMounted, onActivated, onDeactivated } from 'vue';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import HistoryCheckPanel from './linkcheck/HistoryCheckPanel.vue';
import MdRescueDialog from './linkcheck/MdRescueDialog.vue';
import { useLinkCheckManager } from '../../composables/useLinkCheck';
import { useHistoryManager } from '../../composables/useHistory';
import { useToast } from '../../composables/useToast';
import type { LinkCheckRow } from '../../types/linkCheck';

const toast = useToast();
const showMdRescueDialog = ref(false);

const {
  isChecking: monitorChecking,
  isLoading,
  progress: monitorProgress,
  checkRows,
  loadHistoryRows,
  checkAllHistoryLinks,
  checkSubset,
  recheckSingle,
  cancelCheck,
  exportCsv,
  removeRowsByHistoryIds,
  onViewActivated,
  onViewDeactivated,
} = useLinkCheckManager();

const { deleteHistoryItem, bulkDeleteRecords, totalCount } = useHistoryManager();

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

async function handleRecheckSingle(row: LinkCheckRow) {
  await recheckSingle(row);
}

async function handleDeleteRow(row: LinkCheckRow) {
  const before = totalCount.value;
  await deleteHistoryItem(row.historyId);
  // totalCount 变化说明用户确认了删除
  if (totalCount.value < before) {
    removeRowsByHistoryIds([row.historyId]);
  }
}

async function handleDeleteBatch(ids: string[]) {
  const before = totalCount.value;
  await bulkDeleteRecords(ids);
  if (totalCount.value < before) {
    removeRowsByHistoryIds(ids);
  }
}

// ============================================
// 生命周期
// ============================================

onMounted(() => {
  loadHistoryRows();
});

// KeepAlive 生命周期：空闲释放内存
onActivated(onViewActivated);
onDeactivated(onViewDeactivated);
</script>

<template>
  <div class="link-check-view">
    <HistoryCheckPanel
      :check-rows="checkRows"
      :is-checking="monitorChecking"
      :is-loading="isLoading"
      :progress="monitorProgress"
      @check-all="checkAllHistoryLinks"
      @check-subset="(f: { statusFilter?: 'unchecked' | 'invalid'; serviceId?: string }) => checkSubset(f)"
      @cancel-check="cancelCheck"
      @recheck-single="handleRecheckSingle"
      @copy-url="handleCopyUrl"
      @export-csv="handleExportCsv"
      @open-md-rescue="showMdRescueDialog = true"
      @delete-row="handleDeleteRow"
      @delete-batch="handleDeleteBatch"
    />

    <MdRescueDialog v-model:visible="showMdRescueDialog" />
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
</style>
