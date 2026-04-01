<script setup lang="ts">
/**
 * 链接检测主视图
 * 检测面板 ↔ 文档修复内联面板 通过 rescueActive 切换
 */
import { ref, onMounted, onActivated, onDeactivated } from 'vue';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import HistoryCheckPanel from './linkcheck/HistoryCheckPanel.vue';
import MdRescueInline from './linkcheck/MdRescueInline.vue';
import { useLinkCheckManager } from '../../composables/useLinkCheck';
import { useHistoryManager } from '../../composables/useHistory';
import { useToast } from '../../composables/useToast';
import type { LinkCheckRow } from '../../types/linkCheck';

const toast = useToast();
const rescueActive = ref(false);

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
  setFadingOut,
  onViewActivated,
  onViewDeactivated,
} = useLinkCheckManager();

const { deleteHistoryItem, bulkDeleteRecords } = useHistoryManager();

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

// KeepAlive 生命周期：空闲释放内存
onActivated(onViewActivated);
onDeactivated(onViewDeactivated);
</script>

<template>
  <div class="link-check-view">
    <Transition name="view-fade" mode="out-in">
      <HistoryCheckPanel
        v-if="!rescueActive"
        key="monitor"
        :check-rows="checkRows"
        :is-checking="monitorChecking"
        :is-loading="isLoading"
        :progress="monitorProgress"
        @check-all="checkAllHistoryLinks"
        @check-subset="(f: { statusFilter?: 'unchecked' | 'invalid' | 'timeout' | 'suspicious' | 'valid' | 'problems'; serviceId?: string }) => checkSubset(f)"
        @cancel-check="cancelCheck"
        @recheck-single="handleRecheckSingle"
        @copy-url="handleCopyUrl"
        @export-csv="handleExportCsv"
        @open-md-rescue="rescueActive = true"
        @delete-row="handleDeleteRow"
        @delete-batch="handleDeleteBatch"
        @recheck-batch="handleRecheckBatch"
      />
      <MdRescueInline
        v-else
        key="rescue"
        @back="rescueActive = false"
      />
    </Transition>
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

/* 视图切换过渡 */
.view-fade-enter-active,
.view-fade-leave-active {
  transition: opacity 0.15s ease;
}

.view-fade-enter-from,
.view-fade-leave-to {
  opacity: 0;
}
</style>
