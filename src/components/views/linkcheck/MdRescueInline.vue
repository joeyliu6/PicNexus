<script setup lang="ts">
// Markdown 链接救援主容器
// 子组件：RescueIdleZone（拖放区）、RescueBrokenGroups（分组列表）、RescueFixingCards（修复卡片）

import { ref, computed, watch, onBeforeUnmount } from 'vue';
import Button from 'primevue/button';
import MdRepairDialog from './MdRepairDialog.vue';
import RescueIdleZone from './rescue/RescueIdleZone.vue';
import RescueBrokenGroups from './rescue/RescueBrokenGroups.vue';
import RescueFixingCards from './rescue/RescueFixingCards.vue';
import { useMdRescueManager } from '../../../composables/useMdRescue';
import type { RepairStrategy } from '../../../composables/useMdRescue';
import { smartTruncateUrl } from '../../../utils/mdParser';
import { formatTimeRemaining } from '../../../composables/useLinkStatusDisplay';

const {
  phase, imageLinks, isAnalyzing, isCollecting, collectProgress,
  isChecking, progress, fileHealthList, availableBackupServices,
  fixingProgress, repairReceipt, hostPreference, includeSubfolders,
  bottomStats, selectMdFile, selectFolder, handleDropPaths,
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

const readyHealthyFiles = computed(() =>
  fileHealthList.value.filter((f) => f.ready && f.status === 'healthy'),
);

const recentHealthyFiles = computed(() =>
  readyHealthyFiles.value.slice(-8).reverse(),
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

// ---- 扫描完成停留 ----

const scanFinishing = ref(false);
let scanFinishTimer: ReturnType<typeof setTimeout> | null = null;

const showScanSkeleton = computed(() =>
  isCollecting.value
  || (phase.value === 'scanning' && !['complete', 'cancelled'].includes(scanStage.value))
  || scanFinishing.value,
);

watch(() => scanStage.value, async (stage) => {
  if (stage === 'complete') {
    await loadHostPreference();
    tempPreference.value = hostPreference.value.length > 0
      ? [...hostPreference.value]
      : [...availableBackupServices.value];
    scanFinishing.value = true;
    scanFinishTimer = setTimeout(() => { scanFinishing.value = false; scanFinishTimer = null; }, 1500);
  } else if (stage === 'cancelled') {
    scanFinishing.value = true;
    scanFinishTimer = setTimeout(() => { scanFinishing.value = false; scanFinishTimer = null; }, 2000);
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

function parsePath(path: string): string[] {
  return path.replace(/\\/g, '/').split('/').filter(Boolean);
}

function truncatePath(path: string): string {
  const parts = parsePath(path);
  return parts.length <= 2 ? path : '.../' + parts.slice(-2).join('/');
}

onBeforeUnmount(() => {
  if (scanFinishTimer) { clearTimeout(scanFinishTimer); scanFinishTimer = null; }
});

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
    />

    <!-- working: scanning / fixing / done -->
    <div v-else class="rescue-phase rescue-working">

      <!-- fixing / done 顶栏 -->
      <Transition name="fade" mode="out-in">
        <div v-if="phase === 'fixing'" key="fixing-header" class="wk-header">
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

      <!-- fixing 进度条 -->
      <Transition name="fade">
        <div v-if="phase === 'fixing'" class="wk-progress">
          <div class="wk-progress-fill" :style="{ width: fixingPercent + '%' }" />
        </div>
      </Transition>

      <!-- 内容区 -->
      <div class="wk-body">

        <!-- 扫描骨架屏 -->
        <Transition name="scan-bar">
          <div v-if="showScanSkeleton" class="mr-scan-skeleton" :class="{ 'is-finishing': scanFinishing }">
            <i :class="[
              scanFinishing && scanStage !== 'cancelled' ? 'pi pi-check-circle mr-scan-skeleton-done'
              : scanStage === 'cancelled' ? 'pi pi-info-circle mr-scan-skeleton-done'
              : 'pi pi-spin pi-spinner mr-scan-skeleton-spinner',
            ]" />
            <span class="mr-scan-skeleton-text">
              <template v-if="scanFinishing && scanStage === 'cancelled'">已取消扫描 · 已检测 {{ scanProgress?.checked ?? 0 }} / {{ scanProgress?.total ?? 0 }} 张图片</template>
              <template v-else-if="scanFinishing">扫描完成 · {{ bottomStats.totalImages }} 张图片</template>
              <template v-else-if="isCollecting">
                <template v-if="collectProgress && collectProgress.processedFiles > 0">
                  正在读取文件… · {{ collectProgress.processedFiles }} / {{ collectProgress.scannedFiles }}<template v-if="collectProgress.currentFile"> · {{ collectProgress.currentFile }}</template>
                </template>
                <template v-else-if="collectProgress && collectProgress.scannedFiles > 0">正在扫描文件列表… · 已找到 {{ collectProgress.scannedFiles }} 个文件</template>
                <template v-else>正在扫描文件列表…</template>
              </template>
              <template v-else-if="scanStage === 'cancelling'">正在取消… · 等待进行中的请求完成</template>
              <template v-else-if="scanStage === 'backups'">正在验证备用链接…</template>
              <template v-else-if="scanProgress && scanProgress.total > 0">
                正在扫描图片 · {{ scanProgress.checked }} / {{ scanProgress.total }}<template v-if="estimatedTimeRemaining !== null"> · 预计剩余 {{ formatTimeRemaining(estimatedTimeRemaining) }}</template><template v-else-if="currentScanFileName"> · {{ currentScanFileName }}</template>
              </template>
              <template v-else>正在扫描图片…</template>
            </span>
            <span v-if="!scanFinishing && (bottomStats.totalFiles > 0 || (isCollecting && collectProgress && collectProgress.foundLinks > 0))" class="mr-scan-skeleton-meta">
              <template v-if="isCollecting && collectProgress && collectProgress.foundLinks > 0">已找到 {{ collectProgress.foundLinks }} 张图片</template>
              <template v-else-if="bottomStats.totalFiles > 0">{{ bottomStats.totalFiles }} 文件 · {{ bottomStats.totalImages }} 图片<template v-if="skippedDirs.length > 0"> · {{ skippedDirs.length }} 个目录受限</template></template>
            </span>
            <button v-if="isCollecting && !scanFinishing" class="mr-scan-skeleton-cancel" title="取消收集" @click="cancelCollect">
              <i class="pi pi-times" />
            </button>
          </div>
        </Transition>

        <!-- 健康文件流水 -->
        <Transition name="fade">
          <div v-if="phase === 'scanning' && !['complete', 'cancelling', 'cancelled'].includes(scanStage) && readyBrokenFiles.length === 0 && recentHealthyFiles.length > 0" class="mr-healthy-stream">
            <div v-for="f in recentHealthyFiles" :key="f.path" class="mr-healthy-row">
              <i class="pi pi-check-circle mr-healthy-icon" />
              <span class="mr-healthy-name">{{ f.name }}</span>
              <span class="mr-healthy-meta">{{ f.totalCount }} 张图片均正常</span>
            </div>
          </div>
        </Transition>

        <!-- scanning / done: 分组链接列表（子组件） -->
        <template v-if="phase === 'scanning' || phase === 'done'">
          <RescueBrokenGroups :image-links="imageLinks" :is-repaired="isRepaired" :phase="phase" :scan-stage="scanStage" />

          <!-- 全部正常 -->
          <Transition name="slide-up">
            <div v-if="phase === 'scanning' && scanStage === 'complete' && readyBrokenFiles.length === 0 && readyHealthyFiles.length > 0" class="report-empty">
              <i class="pi pi-check-circle report-empty-icon" />
              <p>所有图片链接正常</p>
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
          <template v-if="phase === 'scanning' && (scanStage === 'checking' || scanStage === 'backups')">
            <button class="btn-danger btn-sm" @click="cancelScan"><i class="pi pi-stop" /> 取消</button>
          </template>
          <template v-else-if="phase === 'scanning' && scanStage === 'cancelling'">
            <button class="btn-ghost btn-sm" disabled><i class="pi pi-spin pi-spinner" /> 正在取消…</button>
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

.wk-title-group { display: flex; align-items: center; gap: var(--space-md); }
.wk-title { font-size: var(--text-base); font-weight: var(--weight-semibold); color: var(--text-main); }
.wk-subtitle { font-size: var(--text-sm); color: var(--text-tertiary); }
.wk-done-icon { font-size: var(--text-lg-xl); color: var(--success); }
.wk-actions { display: flex; gap: var(--space-sm); }

.wk-progress { height: 4px; background: var(--border-subtle); flex-shrink: 0; }
.wk-progress-fill { height: 100%; background: var(--primary); transition: width var(--duration-slow) ease; border-radius: 0 2px 2px 0; }

.wk-body {
  flex: 1; overflow-y: auto; padding: var(--space-sm-md) var(--space-xl) var(--space-sm-md) 0;
  display: flex; flex-direction: column; gap: var(--space-sm);
}

/* 扫描骨架屏 */
.mr-scan-skeleton {
  display: flex; align-items: center; gap: var(--space-sm-md);
  padding: var(--space-md) var(--space-md-lg); flex-shrink: 0;
  border: 1px dashed var(--border-subtle); border-radius: var(--radius-md);
  background: var(--hover-overlay-subtle); max-height: 60px;
  animation: k-pulse 2s ease-in-out infinite;
}

.mr-scan-skeleton-spinner { font-size: var(--text-sm); color: var(--text-tertiary); flex-shrink: 0; }
.mr-scan-skeleton-done { font-size: var(--text-sm); color: var(--success); flex-shrink: 0; }
.mr-scan-skeleton.is-finishing { animation: none; }
.mr-scan-skeleton.is-finishing .mr-scan-skeleton-text { color: var(--success); }

.mr-scan-skeleton-text {
  flex: 1; min-width: 0; font-size: var(--text-xs); font-weight: var(--weight-medium); color: var(--text-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.mr-scan-skeleton-meta {
  flex-shrink: 0; font-size: var(--text-xs); color: var(--text-tertiary); font-variant-numeric: tabular-nums;
}

.mr-scan-skeleton-cancel {
  flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border: none; border-radius: var(--radius-xs);
  background: transparent; color: var(--text-tertiary); cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast); font-family: inherit;
}
.mr-scan-skeleton-cancel:hover { background: var(--hover-overlay); color: var(--text-primary); }

/* 健康文件流水 */
.mr-healthy-stream { display: flex; flex-direction: column; gap: var(--space-2xs); padding: var(--space-sm) var(--space-md-lg); }
.mr-healthy-row { display: flex; align-items: center; gap: var(--space-sm); height: 32px; font-size: var(--text-xs); animation: k-fade-slide-down 0.25s ease; }
.mr-healthy-icon { font-size: var(--text-xs); color: var(--success); flex-shrink: 0; }
.mr-healthy-name { color: var(--text-muted); font-weight: var(--weight-medium); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
.mr-healthy-meta { flex-shrink: 0; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }

/* 全部正常 */
.report-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-sm-md); flex: 1; color: var(--text-tertiary); font-size: var(--text-sm); }
.report-empty-icon { font-size: var(--text-4xl); color: var(--success); }

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
.btn-ghost, .btn-primary, .btn-danger {
  display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 11px;
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

.scan-bar-enter-active { transition: opacity var(--duration-normal) ease, transform var(--duration-normal) ease; }

.scan-bar-leave-active {
  transition: opacity 0.8s var(--ease-standard), transform 0.8s var(--ease-standard),
    max-height 0.6s 0.3s var(--ease-standard), padding 0.6s 0.3s var(--ease-standard), border-width 0.6s 0.3s var(--ease-standard);
  overflow: hidden;
}
.scan-bar-enter-from { opacity: 0; transform: translateY(-4px); }
.scan-bar-leave-to { opacity: 0; transform: translateY(-8px); max-height: 0; padding-top: 0; padding-bottom: 0; border-width: 0; }

.slide-up-enter-active { transition: opacity var(--duration-medium) ease, transform var(--duration-medium) ease; }
.slide-up-enter-from { opacity: 0; transform: translateY(12px); }
.slide-up-leave-active { transition: opacity var(--duration-normal) ease, transform var(--duration-normal) ease; }
.slide-up-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
