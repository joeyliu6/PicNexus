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
import { useRescueScanHeader } from '../../../composables/md-rescue/useRescueScanHeader';
import { removeMruEntry, type MruEntry } from '../../../composables/md-rescue/useMdRescueMru';
import { useToast } from '../../../composables/useToast';
import { exists } from '@tauri-apps/plugin-fs';

const {
  phase, imageLinks, isAnalyzing, isCollecting, collectProgress,
  isChecking, fileHealthList, availableBackupServices,
  fixingProgress, repairReceipt, hostPreference, includeSubfolders,
  bottomStats, selectMdFile, selectFolder, handleDropPaths,
  loadFilePath, loadFolderPath,
  analyzeFile, applyRepairStrategy, loadHostPreference, saveHostPreference,
  cancelCollect, cancelScan, cancelFix, undoReplace, executeReplace,
  reset: resetRescue, scanStage, scanProgress, skippedDirs,
} = useMdRescueManager();

// ---- 计算属性 ----

const rescuableCount = computed(() =>
  imageLinks.value.filter((l) =>
    l.checkResult && !l.checkResult.is_valid
    && l.backupLinks?.some((b) => b.checkResult?.is_valid),
  ).length,
);

const hasRescuable = computed(() => rescuableCount.value > 0);

const fixingPercent = computed(() => {
  const { current, total } = fixingProgress.value;
  return total === 0 ? 0 : Math.round((current / total) * 100);
});

const isRepaired = computed(() => phase.value === 'done');

// ---- 扫描取消能力 / 百分比 / 空态文案 / 完成停留（详见 useRescueScanHeader）----

const {
  canCancelScan, isCancelling, scanPercent,
  emptyIcon, emptyTitle, emptyDesc,
  handleCancelScan, triggerScanFinishing,
} = useRescueScanHeader({
  phase, scanStage, isCollecting, collectProgress, scanProgress, bottomStats,
  onCancelCollect: cancelCollect, onCancelScan: cancelScan,
});

// 底部进度条：显示条件 / 百分比 / 不定态（参照 CheckBottomBar 的位置与样式）
// 只在"真正进行中"的阶段显示；complete / cancelled 立即隐藏，避免扫完后进度条残留
const showBottomProgress = computed(() => {
  if (phase.value === 'fixing') return true;
  if (isCollecting.value) return true;
  if (phase.value === 'scanning') return ['checking', 'backups', 'cancelling'].includes(scanStage.value);
  return false;
});
const bottomProgressPercent = computed(() =>
  phase.value === 'fixing' ? fixingPercent.value : scanPercent.value,
);
// cancelling 时切换到 indeterminate（扫动动画），告诉用户"正在停止"而不是僵在某个百分比
const bottomProgressIndeterminate = computed(() =>
  isCollecting.value
  || scanStage.value === 'cancelling'
  || (phase.value === 'scanning' && scanPercent.value === 0),
);

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

      <!-- 顶栏：仅"修复完成"阶段保留（扫描/修复进行中的状态与进度统一由底栏承担，对齐链接监控） -->
      <Transition name="fade">
        <div v-if="phase === 'done'" class="wk-header">
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

      <!-- 内容区 -->
      <div class="wk-body">

        <!-- scanning / done / collecting：Chips 行常驻顶部（含扫描状态 spinner），内容区内部切换分组列表 / 空态 -->
        <template v-if="phase === 'scanning' || phase === 'done' || isCollecting">
          <RescueBrokenGroups
            :image-links="imageLinks" :is-repaired="isRepaired" :phase="phase" :scan-stage="scanStage"
            :is-collecting="isCollecting"
            :empty-icon="emptyIcon" :empty-title="emptyTitle" :empty-desc="emptyDesc"
          />

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
      <!-- 极简进度条（与链接监控 CheckBottomBar 一致），scanning / collecting / fixing 共用 -->
      <Transition name="fade">
        <div v-if="showBottomProgress" class="progress-bar" role="progressbar" :aria-valuenow="bottomProgressPercent" aria-valuemin="0" aria-valuemax="100">
          <div class="progress-bar-inner">
            <div
              class="progress-bar-fill"
              :class="{ 'progress-bar-fill--indeterminate': bottomProgressIndeterminate }"
              :style="bottomProgressIndeterminate ? undefined : { width: bottomProgressPercent + '%' }"
            ></div>
          </div>
        </div>
      </Transition>
      <div class="rescue-bottom-main">
        <div class="rescue-bottom-left">
          <i v-if="skippedDirs.length > 0" class="pi pi-exclamation-triangle rescue-stat-skip" v-tooltip.top="skippedDirs.length + ' 个目录因权限限制被跳过：\n' + skippedDirs.join('\n')" />
          <template v-if="isCollecting">
            <span class="rescue-stat"><i class="pi pi-search rescue-stat-icon" />{{ collectProgress && collectProgress.scannedFiles > 0 ? `正在扫描文件列表 · 已找到 ${collectProgress.scannedFiles} 个` : '正在扫描文件列表...' }}</span>
          </template>
          <template v-else-if="phase === 'fixing'">
            <span class="rescue-stat"><i class="pi pi-wrench rescue-stat-icon" />正在修复 {{ fixingProgress.current }} / {{ fixingProgress.total }}</span>
          </template>
          <template v-else-if="isRepaired">
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
            <span class="rescue-stat"><i class="pi pi-image rescue-stat-icon" />已检测 {{ bottomStats.checkedCount }} / {{ bottomStats.totalImages }} 图片</span>
            <template v-if="bottomStats.normalFileCount > 0">
              <span class="rescue-stat-sep" />
              <span class="rescue-stat rescue-stat--success"><i class="pi pi-check-circle rescue-stat-icon" />{{ bottomStats.normalFileCount }} 文件正常</span>
            </template>
            <template v-if="bottomStats.problemCount > 0">
              <span class="rescue-stat-sep" />
              <span class="rescue-stat rescue-stat--warning"><i class="pi pi-exclamation-triangle rescue-stat-icon" />{{ bottomStats.problemCount }} 问题</span>
            </template>
          </template>
        </div>

        <div class="bottom-actions">
          <template v-if="canCancelScan">
            <button class="btn-ghost btn-sm" :disabled="isCancelling" @click="handleCancelScan">
              <i :class="isCancelling ? 'pi pi-spin pi-spinner' : 'pi pi-times'" /> {{ isCancelling ? '取消中...' : '取消' }}
            </button>
          </template>
          <template v-else-if="phase === 'scanning' && scanStage === 'cancelled'">
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
.wk-actions { display: flex; gap: var(--space-sm); flex-shrink: 0; }

.wk-body {
  flex: 1; overflow-y: auto; padding: var(--space-md) var(--space-xl) var(--space-sm-md) 0;
  display: flex; flex-direction: column; gap: var(--space-sm);
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

/* 极简进度条（样式与 CheckBottomBar 一致，确保视觉节奏对齐链接监控） */
.progress-bar {
  width: 100%; flex-shrink: 0; cursor: default;
  padding: var(--space-xs) 0; position: relative;
}

.progress-bar-inner {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 3px 为进度条高度，无 spacing token */
  width: 100%; height: 3px; background: var(--bg-input);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1.5px 为进度条圆角，无 radius token */
  border-radius: 1.5px; overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- fallback 颜色 #60a5fa 用于 --primary-light 未定义时 */
  background: linear-gradient(90deg, var(--primary), var(--primary-light, #60a5fa));
  transition: width var(--duration-slower) var(--ease-standard);
  position: relative; overflow: hidden;
}

.progress-bar-fill::after {
  content: '';
  position: absolute; inset: 0;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 光泽动画中的白色半透明无语义变量 */
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 40%), transparent);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1.5s 为扫光动画周期，无 duration token */
  animation: k-sweep 1.5s ease-in-out infinite;
}

/* 不定态（总量未知时的连续扫动） */
.progress-bar-fill--indeterminate {
  width: 40%;
  animation: k-progress-indeterminate var(--duration-shimmer) linear infinite;
  transition: none;
}
.progress-bar-fill--indeterminate::after { animation: none; }

@keyframes k-progress-indeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(250%); }
}
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

/* 底栏容器 .bottom-actions 与按钮基类 .btn-primary/.btn-ghost/.btn-danger
   已集中定义在 src/styles/bottom-bar-buttons.css */
.mr-cancelled-hint { font-size: var(--text-xs); color: var(--text-muted); margin-right: auto; }

/* 动画 */
.fade-enter-active { transition: opacity var(--duration-normal) var(--ease-standard); }
.fade-leave-active { transition: opacity var(--duration-medium) var(--ease-accelerate); }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.slide-up-enter-active { transition: opacity var(--duration-medium) ease, transform var(--duration-medium) ease; }
.slide-up-enter-from { opacity: 0; transform: translateY(12px); }
.slide-up-leave-active { transition: opacity var(--duration-normal) ease, transform var(--duration-normal) ease; }
.slide-up-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
