<script setup lang="ts">
// Markdown 链接救援主容器
// 子组件：RescueIdleZone（拖放区）、RescueBrokenGroups（分组列表）、RescueFixingCards（修复卡片）

import { ref, computed, watch } from 'vue';
import Button from 'primevue/button';
import MdRepairDialog from './MdRepairDialog.vue';
import RescueIdleZone from './rescue/RescueIdleZone.vue';
import RescueBrokenGroups from './rescue/RescueBrokenGroups.vue';
import RescueFixingCards from './rescue/RescueFixingCards.vue';
import { useMdRescueManager } from '../../../composables/useMdRescue';
import type { RepairStrategy } from '../../../composables/useMdRescue';
import { smartTruncateUrl } from '../../../utils/mdParser';
import { useRescueScanHeader } from '../../../composables/md-rescue/useRescueScanHeader';
import { removeMruEntry, type MruEntry } from '../../../composables/md-rescue/useMdRescueMru';
import { useToast } from '../../../composables/useToast';
import { exists } from '@tauri-apps/plugin-fs';

const {
  phase, imageLinks, isAnalyzing, isCollecting, collectProgress,
  isChecking, progress, fileHealthList, availableBackupServices,
  fixingProgress, repairReceipt, hostPreference, includeSubfolders,
  bottomStats, selectMdFile, selectFolder, handleDropPaths,
  loadFilePath, loadFolderPath,
  analyzeFile, applyRepairStrategy, loadHostPreference, saveHostPreference,
  cancelCollect, cancelScan, cancelFix, undoReplace, executeReplace,
  reset: resetRescue, scanStage, scanProgress, skippedDirs, estimatedTimeRemaining,
} = useMdRescueManager();

// ---- 计算属性 ----

const rescuableCount = computed(() =>
  imageLinks.value.filter((l) =>
    l.checkResult && !l.checkResult.is_valid
    && l.backupLinks?.some((b) => b.checkResult?.is_valid),
  ).length,
);

const hasRescuable = computed(() => rescuableCount.value > 0);

const readyBrokenFiles = computed(() =>
  fileHealthList.value.filter((f) => f.ready && f.status !== 'healthy'),
);

const fixingPercent = computed(() => {
  const { current, total } = fixingProgress.value;
  return total === 0 ? 0 : Math.round((current / total) * 100);
});

const currentScanFileName = computed(() => {
  if (!progress.value?.current_url) return '';
  const url = progress.value.current_url;
  const link = imageLinks.value.find((l) => l.url === url);
  return link ? link.sourceFileName : smartTruncateUrl(url, 40);
});

const isRepaired = computed(() => phase.value === 'done');

// ---- 扫描 header / 占位 / 完成停留（详见 useRescueScanHeader）----

const {
  scanFinishing, scanHeaderTitle, scanHeaderSubtitle, scanHeaderIconClass, canCancelScan, scanPercent,
  showScanPlaceholder, scanPlaceholderTitle, scanPlaceholderHint,
  handleCancelScan, triggerScanFinishing,
} = useRescueScanHeader({
  phase, scanStage, isCollecting, collectProgress, scanProgress,
  bottomStats, estimatedTimeRemaining, currentScanFileName, readyBrokenFiles,
  onCancelCollect: cancelCollect, onCancelScan: cancelScan,
});

watch(() => scanStage.value, async (stage) => {
  if (stage === 'complete') {
    await loadHostPreference();
    tempPreference.value = hostPreference.value.length > 0
      ? [...hostPreference.value]
      : [...availableBackupServices.value];
    triggerScanFinishing('complete');
  } else if (stage === 'cancelled') {
    triggerScanFinishing('cancelled');
  }
});

// ---- 方法 ----

async function handleSelectFile() {
  const ok = await selectMdFile();
  if (ok && imageLinks.value.length > 0) await analyzeFile();
}

async function handleSelectFolder() {
  const ok = await selectFolder();
  if (ok && imageLinks.value.length > 0) await analyzeFile();
}

const toast = useToast();

async function handlePickRecent(entry: MruEntry) {
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

function parsePath(path: string): string[] {
  return path.replace(/\\/g, '/').split('/').filter(Boolean);
}

function truncatePath(path: string): string {
  const parts = parsePath(path);
  return parts.length <= 2 ? path : '.../' + parts.slice(-2).join('/');
}

// ---- 修复策略 ----

const showRepairDialog = ref(false);
const tempPreference = ref<string[]>([]);

const rescuableLinks = computed(() =>
  imageLinks.value.filter(
    (l) => l.checkResult && !l.checkResult.is_valid
      && l.backupLinks?.some((b) => b.checkResult?.is_valid),
  ),
);

async function handleRepairConfirm(strategy: RepairStrategy, preference: string[]) {
  if (strategy.type === 'priority') {
    hostPreference.value = preference;
    await saveHostPreference();
  }
  applyRepairStrategy(strategy);
  await executeReplace();
}
</script>

<template>
  <div class="md-rescue">

    <!-- idle: 拖放区（子组件） -->
    <RescueIdleZone
      v-if="phase === 'idle' && !isCollecting"
      :is-analyzing="isAnalyzing"
      :is-checking="isChecking"
      :include-subfolders="includeSubfolders"
      @select-file="handleSelectFile"
      @select-folder="handleSelectFolder"
      @update:include-subfolders="includeSubfolders = $event"
      @drop-paths="handleDropPaths"
      @pick-recent="handlePickRecent"
    />

    <!-- working: scanning / fixing / done -->
    <div v-else class="rescue-phase rescue-working">

      <!-- 统一顶栏 header（collecting / scanning / fixing / done 共用风格） -->
      <Transition name="fade" mode="out-in">
        <div v-if="phase === 'scanning' || isCollecting" key="scanning-header" class="wk-header">
          <div class="wk-title-group">
            <i :class="['wk-scan-icon', scanHeaderIconClass]" />
            <span class="wk-title">{{ scanHeaderTitle }}</span>
            <span v-if="scanHeaderSubtitle" class="wk-subtitle">{{ scanHeaderSubtitle }}</span>
          </div>
          <div class="wk-actions">
            <button v-if="canCancelScan" type="button" class="btn-ghost btn-sm" @click="handleCancelScan">
              <i class="pi pi-times" /> 取消
            </button>
          </div>
        </div>
        <div v-else-if="phase === 'fixing'" key="fixing-header" class="wk-header">
          <span class="wk-title">正在修复...</span>
          <span class="wk-subtitle">{{ fixingProgress.current }}/{{ fixingProgress.total }} ({{ fixingPercent }}%)</span>
        </div>
        <div v-else-if="phase === 'done'" key="done-header" class="wk-header">
          <div class="wk-title-group">
            <i class="pi pi-check-circle wk-done-icon" />
            <span class="wk-title">修复完成</span>
            <span v-if="repairReceipt" class="wk-subtitle">共修复 {{ repairReceipt.linksFixed }} 张图片链接</span>
          </div>
          <div class="wk-actions">
            <Button label="撤销" severity="secondary" size="small" icon="pi pi-undo" outlined :disabled="!repairReceipt?.fileBackupMap.length" @click="undoReplace" />
          </div>
        </div>
      </Transition>

      <!-- 顶部进度条 -->
      <Transition name="fade">
        <div v-if="phase === 'fixing'" class="wk-progress">
          <div class="wk-progress-fill" :style="{ width: fixingPercent + '%' }" />
        </div>
        <div v-else-if="(phase === 'scanning' && !scanFinishing) || isCollecting" class="wk-progress">
          <div
            class="wk-progress-fill"
            :class="{ 'wk-progress-fill--indeterminate': scanPercent === 0 }"
            :style="scanPercent > 0 ? { width: scanPercent + '%' } : undefined"
          />
        </div>
      </Transition>

      <!-- 内容区 -->
      <div class="wk-body">

        <!-- scanning / done: 分组链接列表（子组件） -->
        <template v-if="phase === 'scanning' || phase === 'done'">
          <RescueBrokenGroups :image-links="imageLinks" :is-repaired="isRepaired" :phase="phase" :scan-stage="scanStage" />

          <!-- 扫描期空态：没有破损文件时居中占位 -->
          <Transition name="slide-up">
            <div v-if="showScanPlaceholder" class="rescue-scan-placeholder">
              <i
                class="rescue-scan-placeholder-icon"
                :class="scanStage === 'cancelled' ? 'pi pi-info-circle' : 'pi pi-shield'"
              />
              <p class="rescue-scan-placeholder-title">{{ scanPlaceholderTitle }}</p>
              <p v-if="scanPlaceholderHint" class="rescue-scan-placeholder-hint">{{ scanPlaceholderHint }}</p>
            </div>
          </Transition>

          <!-- done 备份提示 -->
          <Transition name="fade">
            <div v-if="phase === 'done' && repairReceipt?.backupPath" class="done-backup">
              <i class="pi pi-save" />
              <span v-tooltip.top="repairReceipt.backupPath">原文件已备份至 {{ truncatePath(repairReceipt.backupPath) }}</span>
            </div>
          </Transition>
        </template>

        <!-- fixing: 三态卡片（子组件） -->
        <RescueFixingCards v-if="phase === 'fixing'" :file-health-list="fileHealthList" :image-links="imageLinks" :fixing-progress="fixingProgress" />
      </div>
    </div>

    <!-- 底栏 -->
    <Transition name="slide-up">
    <div v-if="phase !== 'idle' || isCollecting" class="rescue-bottom">
      <div class="rescue-bottom-main">
        <div class="rescue-bottom-left">
          <i v-if="skippedDirs.length > 0" class="pi pi-exclamation-triangle rescue-stat-skip" v-tooltip.top="skippedDirs.length + ' 个目录因权限限制被跳过：\n' + skippedDirs.join('\n')" />
          <template v-if="isRepaired">
            <span class="rescue-stat rescue-stat--success"><i class="pi pi-check-circle rescue-stat-icon" />已修复 {{ bottomStats.repairedCount }} 条链接</span>
            <template v-if="bottomStats.manualCount > 0">
              <span class="rescue-stat-sep" />
              <span class="rescue-stat rescue-stat--warning"><i class="pi pi-exclamation-triangle rescue-stat-icon" />{{ bottomStats.manualCount }} 需手动</span>
            </template>
          </template>
          <template v-else-if="scanStage === 'complete' || scanStage === 'cancelled'">
            <span v-if="bottomStats.problemCount > 0" class="rescue-stat rescue-stat--warning"><i class="pi pi-exclamation-triangle rescue-stat-icon" />{{ bottomStats.problemCount }} 条问题链接</span>
            <span v-else class="rescue-stat rescue-stat--success"><i class="pi pi-check-circle rescue-stat-icon" />全部正常</span>
            <template v-if="bottomStats.problemFileCount > 0">
              <span class="rescue-stat-sep" />
              <span class="rescue-stat">{{ bottomStats.problemFileCount }} 个文件受影响</span>
            </template>
          </template>
          <template v-else-if="bottomStats.checkedCount > 0 || bottomStats.totalImages > 0">
            <span class="rescue-stat"><i class="pi pi-image rescue-stat-icon" />已检测 {{ bottomStats.checkedCount }} / {{ bottomStats.totalImages }}</span>
            <template v-if="bottomStats.problemCount > 0">
              <span class="rescue-stat-sep" />
              <span class="rescue-stat rescue-stat--warning"><i class="pi pi-exclamation-triangle rescue-stat-icon" />{{ bottomStats.problemCount }} 问题</span>
            </template>
          </template>
        </div>

        <div class="rescue-bottom-actions">
          <template v-if="phase === 'scanning' && scanStage === 'cancelled'">
            <span v-if="scanProgress" class="mr-cancelled-hint">已检测 {{ scanProgress.checked }} / {{ scanProgress.total }}</span>
            <button class="btn-ghost btn-sm" @click="resetRescue"><i class="pi pi-refresh" /> 重新扫描</button>
            <button :class="['btn-sm', hasRescuable ? 'btn-primary' : 'btn-ghost']" :disabled="!hasRescuable" v-tooltip.top="hasRescuable ? '基于已检测的部分结果修复' : '已检测部分无可修复链接'" @click="showRepairDialog = true">
              <i class="pi pi-wrench" /> 修复链接
            </button>
          </template>
          <template v-else-if="phase === 'scanning' && scanStage === 'complete'">
            <button :class="['btn-sm', hasRescuable ? 'btn-ghost' : 'btn-primary']" @click="resetRescue"><i class="pi pi-refresh" /> 重新扫描</button>
            <button :class="['btn-sm', hasRescuable ? 'btn-primary' : 'btn-ghost']" :disabled="!hasRescuable" v-tooltip.top="hasRescuable ? '自动修复有备用链接的图片' : '当前没有可自动修复的链接'" @click="showRepairDialog = true">
              <i class="pi pi-wrench" /> 修复链接
            </button>
          </template>
          <template v-else-if="phase === 'fixing'">
            <button class="btn-danger btn-sm" @click="cancelFix"><i class="pi pi-stop" /> 取消修复</button>
          </template>
          <template v-else-if="phase === 'done'">
            <button class="btn-ghost btn-sm" @click="resetRescue"><i class="pi pi-refresh" /> 重新扫描</button>
          </template>
        </div>
      </div>
    </div>
    </Transition>

    <MdRepairDialog
      v-model:visible="showRepairDialog"
      :available-backup-services="availableBackupServices"
      :rescuable-count="rescuableCount"
      :rescuable-links="rescuableLinks"
      :initial-preference="tempPreference"
      @confirm="handleRepairConfirm"
    />
  </div>
</template>

<style scoped>
.md-rescue {
  display: flex; flex-direction: column; height: 100%; overflow: hidden;
  padding: 0 0 var(--space-lg-xl) var(--space-xl); gap: var(--space-md-lg);
}

.rescue-phase {
  display: flex; flex-direction: column; height: 100%; overflow: hidden;
}

/* working 布局 */
.rescue-working { overflow: hidden; position: relative; }

.wk-header {
  display: flex; align-items: center; justify-content: space-between;
  padding-right: var(--space-xl); height: 48px; border-bottom: 1px solid var(--border-subtle); flex-shrink: 0;
}

.wk-title-group { display: flex; align-items: center; gap: var(--space-md); min-width: 0; flex: 1; }
.wk-title { font-size: var(--text-base); font-weight: var(--weight-semibold); color: var(--text-main); white-space: nowrap; }
.wk-subtitle { font-size: var(--text-sm); color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.wk-done-icon { font-size: var(--text-lg-xl); color: var(--success); }
.wk-scan-icon { font-size: var(--text-base); color: var(--text-tertiary); flex-shrink: 0; }
.wk-scan-icon--done { color: var(--success); }
.wk-scan-icon--warn { color: var(--warning); }
.wk-actions { display: flex; gap: var(--space-sm); flex-shrink: 0; }

.wk-progress { height: 4px; background: var(--border-subtle); flex-shrink: 0; overflow: hidden; }

.wk-progress-fill {
  height: 100%; background: var(--primary); transition: width var(--duration-slow) ease;
  border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
}

.wk-progress-fill--indeterminate {
  width: 40%;
  animation: k-scan-indeterminate var(--duration-shimmer) linear infinite;
}

@keyframes k-scan-indeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}

.wk-body {
  flex: 1; overflow-y: auto; padding: var(--space-md) var(--space-xl) var(--space-sm-md) 0;
  display: flex; flex-direction: column; gap: var(--space-sm);
}

/* 扫描期空态占位 */
.rescue-scan-placeholder {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: var(--space-sm); flex: 1; padding: var(--space-3xl) var(--space-lg);
  color: var(--text-tertiary); text-align: center;
}

.rescue-scan-placeholder-icon {
  font-size: var(--text-4xl); color: var(--success); opacity: 0.7;
  animation: k-pulse var(--duration-breathe) ease-in-out infinite;
}

.rescue-scan-placeholder-title {
  font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-muted);
  margin: 0; font-variant-numeric: tabular-nums;
}

.rescue-scan-placeholder-hint {
  font-size: var(--text-xs); color: var(--text-tertiary); margin: 0;
}

/* done 备份提示 */
.done-backup {
  display: flex; align-items: center; gap: var(--space-sm);
  font-size: var(--text-xs); color: var(--text-tertiary);
  padding: var(--space-sm) var(--space-md); background: var(--bg-input); border-radius: var(--radius-md);
}
.done-backup i { font-size: var(--text-base); flex-shrink: 0; }

/* 底栏 */
.rescue-bottom { display: flex; flex-direction: column; gap: var(--space-sm); flex-shrink: 0; padding-right: var(--space-xl); }
.rescue-bottom-main { display: flex; align-items: center; justify-content: space-between; }
.rescue-bottom-left { display: flex; align-items: center; gap: 0; flex-wrap: wrap; }

.rescue-stat {
  display: inline-flex; align-items: center; gap: var(--space-xs);
  font-size: var(--text-xs); font-weight: var(--weight-medium); color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.rescue-stat-icon { font-size: var(--text-xs); }
.rescue-stat--success { color: var(--success); }
.rescue-stat--warning { color: var(--warning); }
.rescue-stat-sep { width: 1px; height: 12px; background: var(--border-subtle); margin: 0 var(--space-sm-md); flex-shrink: 0; }
.rescue-stat-skip { color: var(--warning); font-size: var(--text-xs); cursor: help; margin-right: var(--space-2xs); }
.rescue-bottom-actions { display: flex; align-items: center; gap: var(--space-sm); margin-left: auto; }
.mr-cancelled-hint { font-size: var(--text-xs); color: var(--text-muted); margin-right: auto; }

/* 按钮 */
/* stylelint-disable-next-line no-duplicate-selectors -- MdRescueInline 按钮与 CheckBottomBar 同名但独立作用域 */
.btn-ghost, .btn-primary, .btn-danger {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 5px/28px/11px 无精确 spacing token */
  display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 11px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 7px 无精确 radius token */
  border-radius: 7px; font-size: var(--text-xs); font-weight: var(--weight-medium); cursor: pointer;
  white-space: nowrap; transition: background var(--duration-fast), opacity var(--duration-fast); border: none; font-family: inherit;
}
.btn-ghost i, .btn-primary i, .btn-danger i { font-size: var(--text-xs); }
.btn-ghost { background: var(--bg-input); color: var(--text-muted); }
.btn-ghost:hover:not(:disabled) { background: var(--hover-overlay); color: var(--text-main); }
.btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-primary { background: var(--primary); color: var(--text-on-primary); }
.btn-primary:hover:not(:disabled) { opacity: 0.9; }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-danger { background: var(--error-alpha-15); color: var(--error); }
.btn-danger:hover { background: var(--error-alpha-8); }

/* 动画 */
.fade-enter-active { transition: opacity var(--duration-normal) var(--ease-standard); }
.fade-leave-active { transition: opacity var(--duration-medium) var(--ease-accelerate); }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.slide-up-enter-active { transition: opacity var(--duration-medium) ease, transform var(--duration-medium) ease; }
.slide-up-enter-from { opacity: 0; transform: translateY(12px); }
.slide-up-leave-active { transition: opacity var(--duration-normal) ease, transform var(--duration-normal) ease; }
.slide-up-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
