<script setup lang="ts">
/**
 * 文档修复：选文档（拖放区）→ 顶部结论卡（现在怎么样 + 该点的按钮）→ 按文档分组的打不开的图
 *
 * 子组件：RescueIdleZone（拖放区）、RescueBrokenGroups（分组列表）、RescueFixingCards（修复中）。
 * 结论卡的文字与按钮由 rescueVerdict.ts 决定；修改前自动备份原文件、改完可撤销，所以不弹确认框。
 */
import { computed, watch } from 'vue';
import RescueIdleZone from './rescue/RescueIdleZone.vue';
import RescueBrokenGroups from './rescue/RescueBrokenGroups.vue';
import RescueFixingCards from './rescue/RescueFixingCards.vue';
import SummaryCard from './common/SummaryCard.vue';
import { useMdRescueManager } from '@/composables/md-rescue/useMdRescue';
import { buildRescueVerdict, type RescueVerdictAction } from '@/composables/md-rescue/rescueVerdict';
import { removeMruEntry, type MruEntry } from '@/composables/md-rescue/useMdRescueMru';
import { useToast } from '@/composables/useToast';
import { allowUserPaths } from '@/security/fsScope';
import { exists } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { getErrorMessage } from '@/types/errors';

const {
  phase, imageLinks, isAnalyzing, isCollecting, collectProgress,
  isChecking, fileHealthList,
  fixingProgress, repairReceipt, healedFiles, hostPreference, includeSubfolders, includeCodeBlocks,
  bottomStats, selectMdFile, selectFolder, handleDropPaths,
  loadFilePath, loadFolderPath,
  analyzeFile, applyDefaultBackups, preferServiceForAll, loadHostPreference, saveHostPreference,
  cancelCollect, cancelScan, cancelFix, undoReplace, executeReplace,
  reset: resetRescue, scanStage, scanProgress, skippedDirs, selectAny,
} = useMdRescueManager();

const toast = useToast();

const rescuableCount = computed(() =>
  imageLinks.value.filter((l) =>
    l.checkResult && !l.checkResult.is_valid
    && l.backupLinks?.some((b) => b.checkResult?.is_valid),
  ).length,
);

/** 已点停止、后台还在收尾这一批请求：停止按钮保持灰着 */
const isCancelling = computed(() => phase.value === 'scanning' && scanStage.value === 'cancelling');

const scanPercent = computed(() => {
  const p = scanProgress.value;
  return !p || p.total === 0 ? 0 : (p.checked / p.total) * 100;
});

function handleCancelScan(): void {
  if (isCollecting.value) cancelCollect();
  else cancelScan();
}

watch(() => scanStage.value, async (stage) => {
  if (stage === 'complete' || stage === 'cancelled') {
    // 扫完（含取消后保留的部分结果）立刻定好每张图的替换来源：列表所见即修复所改
    await loadHostPreference();
    applyDefaultBackups(hostPreference.value);
  }
});

const failedFiles = computed(() => repairReceipt.value?.failedFiles ?? []);

const verdict = computed(() => buildRescueVerdict({
  phase: phase.value,
  collectingFound: isCollecting.value ? (collectProgress.value?.scannedFiles ?? 0) : null,
  scan: {
    stage: scanStage.value,
    checked: scanProgress.value?.checked ?? 0,
    total: scanProgress.value?.total ?? 0,
  },
  stats: {
    files: bottomStats.value.totalFiles,
    images: bottomStats.value.totalImages,
    problems: bottomStats.value.problemCount,
    problemFiles: bottomStats.value.problemFileCount,
    manual: bottomStats.value.manualCount,
    repaired: bottomStats.value.repairedCount,
  },
  fixable: rescuableCount.value,
  fixing: phase.value === 'fixing' ? fixingProgress.value : null,
  failedFiles: failedFiles.value.length,
  failedReason: failedFiles.value[0]?.error ?? null,
}));

const progressPercent = computed(() => {
  if (phase.value === 'fixing') {
    const { current, total } = fixingProgress.value;
    return total === 0 ? 0 : (current / total) * 100;
  }
  if (phase.value === 'scanning' && (scanStage.value === 'checking' || scanStage.value === 'backups')) return scanPercent.value;
  return null;
});

const failedFilesTooltip = computed(() =>
  failedFiles.value.map((item) => `${truncatePath(item.file)}：${item.error}`).join('\n'),
);

const hasBrokenRows = computed(() =>
  imageLinks.value.some((l) => l.checkResult && !l.checkResult.is_valid),
);

const scanRunning = computed(() =>
  isCollecting.value || (phase.value === 'scanning' && ['checking', 'backups', 'cancelling'].includes(scanStage.value)),
);

function runAction(action: RescueVerdictAction): void {
  switch (action) {
    case 'cancel':
      if (phase.value === 'fixing') cancelFix();
      else handleCancelScan();
      break;
    case 'repair': void executeReplace(); break;
    case 'undo': void undoReplace(); break;
    case 'reset':
    case 'finish':
      resetRescue();
      break;
  }
}

function isActionDisabled(action: RescueVerdictAction): boolean {
  if (action === 'cancel') return isCancelling.value;
  if (action === 'undo') return !repairReceipt.value?.fileBackupMap.length;
  return false;
}

// ---- 选文档 ----

async function handleSelectFile() {
  const ok = await selectMdFile();
  if (ok && imageLinks.value.length > 0) await analyzeFile();
}

async function handleSelectFolder() {
  const ok = await selectFolder();
  if (ok && imageLinks.value.length > 0) await analyzeFile();
}

async function handleSelectAny() {
  const ok = await selectAny();
  if (ok && imageLinks.value.length > 0) await analyzeFile();
}

async function handlePickRecent(entry: MruEntry) {
  // 运行时授权不跨进程存活（未装 persisted-scope），所以每次从「最近打开」进来都要
  // 重新申请一次。少了这一步，重启后点历史条目会在下面 exists 处 `forbidden path`，
  // 而 catch 把它当成"存在"，接着 load* 再失败一次——用户看到两条不相干的报错
  await allowUserPaths([entry.path]);

  // 先判定路径是否还存在：不存在才从 MRU 剔除，其他错误交给 load* 内部 toast，避免误删 + 双 toast
  let pathExists = true;
  try {
    pathExists = await exists(entry.path);
  } catch {
    pathExists = true; // exists 自身抛错（权限等）视为"存在"，不擅自删 MRU
  }
  if (!pathExists) {
    removeMruEntry(entry.path);
    toast.warn('路径已失效', '已从最近打开中移除');
    return;
  }

  const ok = entry.kind === 'folder'
    ? await loadFolderPath(entry.path)
    : await loadFilePath(entry.path);
  if (!ok) return; // load* 内部已 toast，外层不再重复提示
  if (imageLinks.value.length > 0) await analyzeFile();
}

function truncatePath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length <= 2 ? path : '.../' + parts.slice(-2).join('/');
}

async function openBackupFolder(path: string): Promise<void> {
  try {
    await invoke('open_path', { path });
  } catch (err) {
    toast.error('无法打开文件夹', getErrorMessage(err));
  }
}

async function handlePreferService(serviceId: string) {
  preferServiceForAll(serviceId);
  await saveHostPreference();
}
</script>

<template>
  <div class="md-rescue">
    <RescueIdleZone
      v-if="phase === 'idle' && !isCollecting"
      :is-analyzing="isAnalyzing"
      :is-checking="isChecking"
      :include-subfolders="includeSubfolders"
      :include-code-blocks="includeCodeBlocks"
      @select-file="handleSelectFile"
      @select-folder="handleSelectFolder"
      @select-any="handleSelectAny"
      @update:include-subfolders="includeSubfolders = $event"
      @update:include-code-blocks="includeCodeBlocks = $event"
      @drop-paths="handleDropPaths"
      @pick-recent="handlePickRecent"
    />

    <template v-else>
      <SummaryCard
        :tone="verdict.tone"
        icon="pi pi-file"
        :title="verdict.title"
        :subtitle="verdict.subtitle"
        :progress="progressPercent"
      >
        <template v-if="verdict.note || skippedDirs.length > 0 || (phase === 'done' && repairReceipt?.backupPath)" #extra>
          <p v-if="verdict.note" class="summary-note">{{ verdict.note }}</p>
          <p v-if="phase === 'done' && repairReceipt?.backupPath" class="summary-note">
            原文件备份在
            <button
              type="button"
              class="summary-link"
              v-tooltip.top="repairReceipt.backupPath"
              @click="openBackupFolder(repairReceipt.backupPath)"
            >{{ truncatePath(repairReceipt.backupPath) }}</button>
          </p>
          <p v-if="failedFiles.length > 0" v-tooltip.top="failedFilesTooltip" class="summary-note summary-note--warning">
            没改成的文档：{{ failedFiles.map((f) => truncatePath(f.file)).join('、') }}
          </p>
          <p
            v-if="skippedDirs.length > 0"
            v-tooltip.top="skippedDirs.join('\n')"
            class="summary-note summary-note--warning"
          >
            {{ skippedDirs.length }} 个文件夹没有读取权限，跳过了
          </p>
        </template>
        <template v-if="verdict.primary || verdict.secondary" #actions>
          <button
            v-if="verdict.secondary"
            type="button"
            class="summary-btn summary-btn--ghost"
            :disabled="isActionDisabled(verdict.secondary.action)"
            @click="runAction(verdict.secondary.action)"
          >
            {{ verdict.secondary.label }}
          </button>
          <button
            v-if="verdict.primary"
            type="button"
            class="summary-btn summary-btn--primary"
            :disabled="isActionDisabled(verdict.primary.action)"
            @click="runAction(verdict.primary.action)"
          >
            {{ verdict.primary.label }}
          </button>
        </template>
      </SummaryCard>

      <div class="rescue-list">
        <RescueFixingCards
          v-if="phase === 'fixing'"
          :file-health-list="fileHealthList"
          :image-links="imageLinks"
          :fixing-progress="fixingProgress"
        />
        <RescueBrokenGroups
          v-else-if="hasBrokenRows"
          :image-links="imageLinks"
          :is-repaired="phase === 'done'"
          :healed-files="healedFiles"
          @prefer-service="handlePreferService"
        />
        <p v-else-if="scanRunning" class="rescue-placeholder">查出来的问题会陆续列在这里</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.md-rescue {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  height: 100%;
  padding: var(--space-lg-xl) var(--space-xl) 0;
  overflow: hidden;
}

.rescue-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  flex: 1;
  min-height: 0;
  margin: 0 calc(var(--space-xl) * -1);
  padding: 0 var(--space-xl) var(--space-lg-xl);
  overflow-y: auto;
}

.rescue-placeholder {
  margin: 0;
  padding: var(--space-4xl) 0;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}

.summary-note {
  margin: var(--space-xs) 0 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.summary-note--warning {
  color: var(--warning);
  cursor: default;
}

.summary-link {
  padding: 0;
  border: none;
  background: none;
  color: var(--primary);
  font-family: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
}

.summary-link:hover {
  text-decoration: underline;
}
</style>
