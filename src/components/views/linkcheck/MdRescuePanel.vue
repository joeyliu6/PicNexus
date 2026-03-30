<script setup lang="ts">
/**
 * MD 文档修复面板（内联修复模式）
 * 面包屑 + 统计药丸 + 自动修复横幅 + 筛选列表 + 底部操作栏
 * 确认弹窗 + Diff 预览弹窗
 */
import { ref, computed } from 'vue';
import Button from 'primevue/button';
import Select from 'primevue/select';
import Dialog from 'primevue/dialog';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { MdImageLinkWithFile } from '../../../composables/useMdRescue';
import { useMdRescueManager } from '../../../composables/useMdRescue';
import { useToast } from '../../../composables/useToast';
import { smartTruncateUrl } from '../../../utils/mdParser';
import type { BatchCheckProgress } from '../../../types/linkCheck';
import LinkStatusBadge from './LinkStatusBadge.vue';

// ============================================
// Props & Emits
// ============================================

const props = defineProps<{
  imageLinks: MdImageLinkWithFile[];
  stats: { total: number; checked: number; valid: number; broken: number; rescuable: number; unresolvable: number };
  displayPath: string | null;
  displayLabel: string | null;
  mode: 'file' | 'folder' | null;
  isAnalyzing: boolean;
  isReplacing: boolean;
  isChecking: boolean;
  progress: BatchCheckProgress | null;
  displayFilter: 'broken' | 'healthy' | 'all';
  brokenLinks: MdImageLinkWithFile[];
  healthyLinks: MdImageLinkWithFile[];
  filteredLinks: MdImageLinkWithFile[];
  dialogMode?: boolean;
}>();

const emit = defineEmits<{
  back: [];
  'change-file': [];
  'change-folder': [];
  analyze: [];
  'update-filter': [filter: 'broken' | 'healthy' | 'all'];
  'auto-fix': [];
  'execute-replace': [];
  'generate-diff': [];
}>();

const toast = useToast();
const { autoSelectAndGetSummary, generateDiff, executeReplace } = useMdRescueManager();

// ============================================
// 弹窗状态
// ============================================

const showConfirmDialog = ref(false);
const replaceSummary = ref<ReturnType<typeof autoSelectAndGetSummary> | null>(null);

const showDiffDialog = ref(false);
const diffLines = ref<Array<{ line: number; type: 'unchanged' | 'removed' | 'added'; text: string; file?: string }>>([]);

// ============================================
// 计算属性
// ============================================

const isLoading = computed(() => props.isAnalyzing || props.isChecking);
const hasResults = computed(() => props.stats.total > 0 && !isLoading.value);
const isFolderMode = computed(() => props.mode === 'folder');

const progressPercent = computed(() => {
  if (!props.progress || props.progress.total === 0) return 0;
  return Math.round((props.progress.checked / props.progress.total) * 100);
});

const selectedReplaceCount = computed(() =>
  props.imageLinks.filter((l) => l.selectedBackup).length,
);

/** diff 上下文：只显示变更行及其周围 2 行 */
const diffContext = computed(() => {
  const all = diffLines.value;
  if (all.length === 0) return [];
  const changedIndices = new Set<number>();
  all.forEach((l, i) => { if (l.type !== 'unchanged') changedIndices.add(i); });
  const visible = new Set<number>();
  for (const idx of changedIndices) {
    for (let i = Math.max(0, idx - 2); i <= Math.min(all.length - 1, idx + 2); i++) {
      visible.add(i);
    }
  }
  return all.filter((_, i) => visible.has(i));
});

// ============================================
// 操作方法
// ============================================

function handleAutoFix() {
  const summary = autoSelectAndGetSummary();
  if (summary.totalReplacements === 0) {
    toast.info('无可替换项', '没有找到可用的备用链接');
    return;
  }
  replaceSummary.value = summary;
  showConfirmDialog.value = true;
}

async function handleConfirmReplace() {
  showConfirmDialog.value = false;
  await executeReplace();
}

function handlePreviewDiff() {
  diffLines.value = generateDiff();
  showDiffDialog.value = true;
}

function handleManualReplace() {
  if (selectedReplaceCount.value === 0) return;
  const summary = autoSelectAndGetSummary();
  replaceSummary.value = summary;
  showConfirmDialog.value = true;
}

function truncatePath(path: string, maxLen = 50): string {
  if (path.length <= maxLen) return path;
  const parts = path.replace(/\\/g, '/').split('/');
  const fileName = parts.pop() || '';
  return '.../' + fileName;
}

async function copyUrl(url: string) {
  try {
    await writeText(url);
    toast.success('已复制', '', 1000);
  } catch {
    toast.error('复制失败');
  }
}

function backupOptions(link: MdImageLinkWithFile) {
  if (!link.backupLinks || link.backupLinks.length === 0) return [];
  return link.backupLinks.map((b) => ({
    label: `${b.checkResult?.is_valid ? '✓' : '✗'} ${b.serviceId} (${b.checkResult?.status_code ?? '?'} ${b.checkResult?.is_valid ? 'OK' : 'FAIL'}${b.checkResult?.response_time ? ' · ' + b.checkResult.response_time + 'ms' : ''})`,
    value: b.url,
  }));
}

function truncateUrlDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace('www.', '') + '/...';
  } catch {
    return smartTruncateUrl(url, 30);
  }
}
</script>

<template>
  <div class="md-rescue-panel">
    <!-- 顶部区域：面包屑 + 文件路径 -->
    <div class="top-bar">
      <a v-if="!dialogMode" class="breadcrumb-back" @click="emit('back')">
        <i class="pi pi-arrow-left"></i>
        <span>返回链接检测</span>
      </a>
      <div v-if="displayPath" class="file-info">
        <i :class="isFolderMode ? 'pi pi-folder' : 'pi pi-file'" class="file-icon"></i>
        <span class="file-path" :title="displayPath">{{ truncatePath(displayPath, 60) }}</span>
        <span v-if="displayLabel" class="file-label">{{ displayLabel }}</span>
        <button
          class="change-btn"
          @click="isFolderMode ? emit('change-folder') : emit('change-file')"
        >{{ isFolderMode ? '更换文件夹' : '更换文件' }}</button>
      </div>
    </div>

    <!-- 统计（精简三数字） -->
    <div v-if="stats.total > 0" class="rescue-stats">
      <div class="rescue-stat">
        <span class="rescue-stat-num" style="color: var(--error)">{{ stats.broken }}</span>
        <span class="rescue-stat-label">失效</span>
        <span class="rescue-stat-bar" style="background: var(--error)"></span>
      </div>
      <div class="rescue-stat">
        <span class="rescue-stat-num" style="color: var(--primary)">{{ stats.rescuable }}</span>
        <span class="rescue-stat-label">可修复</span>
        <span class="rescue-stat-bar" style="background: var(--primary)"></span>
      </div>
      <div class="rescue-stat">
        <span class="rescue-stat-num" style="color: var(--text-tertiary)">{{ stats.unresolvable }}</span>
        <span class="rescue-stat-label">无替代</span>
        <span class="rescue-stat-bar" style="background: var(--text-tertiary)"></span>
      </div>
      <span class="rescue-stat-total">共 {{ stats.total }} 链接 · {{ stats.valid }} 有效</span>
    </div>

    <!-- 分析进度 -->
    <div v-if="isLoading" class="analysis-progress">
      <div class="progress-track">
        <div class="progress-fill active" :style="{ width: progressPercent + '%' }"></div>
      </div>
      <div class="progress-detail">
        <span v-if="isChecking && progress" class="progress-url">
          {{ smartTruncateUrl(progress.current_url, 55) }}
        </span>
        <span v-else class="progress-url">正在分析...</span>
        <span class="progress-pct">{{ progressPercent }}%</span>
      </div>
    </div>

    <!-- 有结果时的主内容 -->
    <template v-if="hasResults">
      <!-- 自动修复横幅 -->
      <div v-if="stats.rescuable > 0" class="auto-fix-banner">
        <div class="banner-text">
          <span>{{ stats.rescuable }} 个链接可从上传历史中自动修复</span>
        </div>
        <Button
          label="一键修复"
          icon="pi pi-wrench"
          @click="handleAutoFix"
          size="small"
          severity="primary"
        />
      </div>
      <div v-else-if="stats.broken === 0" class="all-good-bar">
        <i class="pi pi-check-circle"></i>
        <span>所有图片链接均正常</span>
      </div>
      <div v-else class="no-backup-bar">
        <i class="pi pi-info-circle"></i>
        <span>{{ stats.broken }} 个失效链接均无备用方案</span>
      </div>

      <!-- 筛选标签 -->
      <div class="filter-tabs">
        <button
          class="filter-tab"
          :class="{ active: displayFilter === 'broken' }"
          @click="emit('update-filter', 'broken')"
        >失效 ({{ stats.broken }})</button>
        <button
          class="filter-tab"
          :class="{ active: displayFilter === 'healthy' }"
          @click="emit('update-filter', 'healthy')"
        >有效 ({{ stats.valid }})</button>
        <button
          class="filter-tab"
          :class="{ active: displayFilter === 'all' }"
          @click="emit('update-filter', 'all')"
        >全部 ({{ stats.total }})</button>
      </div>

      <!-- 链接列表 -->
      <div class="link-list-container">
        <div v-if="filteredLinks.length === 0" class="empty-list">
          <i class="pi pi-inbox"></i>
          <span>暂无数据</span>
        </div>
        <div v-else class="link-list">
          <div
            v-for="(link, idx) in filteredLinks"
            :key="link.url + '-' + idx"
            class="link-item"
          >
            <!-- 左侧：行号 + 文件名 + 原始语法 -->
            <div class="link-left">
              <span class="line-chip">L{{ link.lineNumber }}</span>
              <span v-if="isFolderMode" class="source-file" :title="link.sourceFile">
                {{ link.sourceFileName }}
              </span>
              <span class="original-syntax" :title="link.originalText">
                {{ smartTruncateUrl(link.url, 55) }}
              </span>
              <i class="pi pi-copy copy-icon" @click.stop="copyUrl(link.url)" title="复制链接"></i>
            </div>

            <!-- 右侧：状态 + 替换方案 -->
            <div class="link-right">
              <LinkStatusBadge :result="link.checkResult" />

              <!-- 失效且有备用链接 -->
              <template v-if="link.checkResult && !link.checkResult.is_valid && link.backupLinks && link.backupLinks.length > 0">
                <Select
                  v-model="link.selectedBackup"
                  :options="backupOptions(link)"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="选择替换"
                  class="backup-select"
                />
              </template>
              <!-- 失效且无备用链接 -->
              <span v-else-if="link.checkResult && !link.checkResult.is_valid" class="no-backup-text">
                无替代链接
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部操作栏 -->
      <div v-if="stats.broken > 0" class="action-bar">
        <span class="action-bar-left">
          已选 {{ selectedReplaceCount }} 条替换
        </span>
        <div class="action-bar-right">
          <span class="backup-hint">替换前自动创建 .bak 备份</span>
          <Button
            v-if="mode === 'file'"
            label="预览 Diff"
            icon="pi pi-eye"
            @click="handlePreviewDiff"
            size="small"
            outlined
            :disabled="selectedReplaceCount === 0"
          />
          <Button
            label="执行替换"
            icon="pi pi-check"
            @click="handleManualReplace"
            size="small"
            severity="success"
            :loading="isReplacing"
            :disabled="selectedReplaceCount === 0"
          />
        </div>
      </div>
    </template>

    <!-- ========== 替换确认弹窗 ========== -->
    <Dialog
      v-model:visible="showConfirmDialog"
      header="确认替换"
      modal
      :style="{ width: '640px', maxHeight: '80vh' }"
    >
      <div v-if="replaceSummary" class="confirm-content">
        <p class="confirm-summary">
          即将替换 {{ replaceSummary.totalFiles }} 个文件中的 {{ replaceSummary.totalReplacements }} 个链接：
        </p>
        <div v-for="file in replaceSummary.files" :key="file.path" class="confirm-file">
          <div class="confirm-file-name">
            <i class="pi pi-file"></i>
            <span>{{ file.fileName }}</span>
          </div>
          <div v-for="rep in file.replacements" :key="rep.lineNumber" class="confirm-replacement">
            <span class="rep-line">第 {{ rep.lineNumber }} 行:</span>
            <span class="rep-old">{{ truncateUrlDomain(rep.oldUrl) }}</span>
            <span class="rep-arrow">&rarr;</span>
            <span class="rep-new">{{ truncateUrlDomain(rep.newUrl) }}</span>
          </div>
        </div>
        <div class="confirm-safety">
          <i class="pi pi-lock"></i>
          <span>每个文件修改前会自动创建 .bak 备份</span>
        </div>
      </div>
      <template #footer>
        <Button label="取消" @click="showConfirmDialog = false" size="small" text />
        <Button label="确认替换" @click="handleConfirmReplace" size="small" severity="primary" :loading="isReplacing" />
      </template>
    </Dialog>

    <!-- ========== Diff 预览弹窗 ========== -->
    <Dialog
      v-model:visible="showDiffDialog"
      header="替换预览"
      modal
      :style="{ width: '700px', maxHeight: '80vh' }"
    >
      <div class="diff-view">
        <div v-for="(line, i) in diffContext" :key="i" class="diff-line" :class="line.type">
          <span class="diff-line-num">{{ line.line }}</span>
          <span class="diff-line-text">{{ line.text }}</span>
        </div>
        <div v-if="diffContext.length === 0" class="diff-empty">没有变更</div>
      </div>
    </Dialog>
  </div>
</template>

<style scoped>
.md-rescue-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ============================================
 * 顶部区域
 * ============================================ */

.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-subtle);
}

.breadcrumb-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--primary);
  cursor: pointer;
  user-select: none;
  transition: opacity 0.15s;
}

.breadcrumb-back:hover { opacity: 0.8; }
.breadcrumb-back .pi { font-size: 12px; }

.file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.file-icon {
  font-size: 14px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.file-path {
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 300px;
}

.file-label {
  font-size: 12px;
  color: var(--primary);
  font-weight: 500;
  white-space: nowrap;
}

.change-btn {
  padding: 3px 10px;
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}

.change-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

/* ============================================
 * 统计（精简三数字）
 * ============================================ */

.rescue-stats {
  display: flex;
  align-items: flex-end;
  gap: 28px;
  padding: 16px 16px 12px;
  flex-shrink: 0;
}

.rescue-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.rescue-stat-num {
  font-size: 24px;
  font-weight: 700;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  line-height: 1;
}

.rescue-stat-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
}

.rescue-stat-bar {
  width: 24px;
  height: 2px;
  border-radius: 1px;
  margin-top: 4px;
}

.rescue-stat-total {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-left: auto;
  align-self: center;
}

/* ============================================
 * 分析进度（原生进度条，与 Monitor 一致）
 * ============================================ */

.analysis-progress {
  padding: 8px 16px;
  flex-shrink: 0;
}

.progress-track {
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: var(--bg-input);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--primary);
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

.progress-fill.active::after {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
  animation: progress-shimmer 1.5s ease-in-out infinite;
}

@keyframes progress-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.progress-detail {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
}

.progress-url {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.progress-pct {
  font-size: 11px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

/* ============================================
 * 自动修复横幅
 * ============================================ */

.auto-fix-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 16px;
  padding: 10px 16px;
  border-radius: 8px;
  background: var(--primary-alpha-8);
  border: 1px solid var(--primary-alpha-15);
  flex-shrink: 0;
}

.banner-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-main);
}

.all-good-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 16px;
  padding: 10px 16px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--success) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--success) 20%, transparent);
  font-size: 14px;
  font-weight: 500;
  color: var(--success);
  flex-shrink: 0;
}

.no-backup-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 16px;
  padding: 10px 16px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--error) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--error) 15%, transparent);
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.no-backup-bar .pi { color: var(--error); }

/* ============================================
 * 筛选标签
 * ============================================ */

.filter-tabs {
  display: flex;
  gap: 0;
  padding: 2px;
  margin: 12px 16px 0;
  border-radius: 6px;
  background: var(--bg-input);
  flex-shrink: 0;
  width: fit-content;
}

.filter-tab {
  padding: 5px 14px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.filter-tab.active {
  background: var(--bg-card);
  color: var(--text-main);
  font-weight: 600;
}

/* ============================================
 * 链接列表
 * ============================================ */

.link-list-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin-top: 8px;
  padding: 0 16px;
}

.empty-list {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 0;
  color: var(--text-muted);
  font-size: 13px;
}

.empty-list .pi { font-size: 24px; opacity: 0.4; }

.link-list {
  display: flex;
  flex-direction: column;
}

.link-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.link-item:last-child { border-bottom: none; }

.link-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.line-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-input);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 500;
  font-family: 'JetBrains Mono', monospace;
  flex-shrink: 0;
}

.source-file {
  font-size: 12px;
  color: var(--text-muted);
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}

.original-syntax {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.copy-icon {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}

.link-item:hover .copy-icon { opacity: 1; }
.copy-icon:hover { color: var(--primary); }

.link-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.no-backup-text {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
  white-space: nowrap;
}

:deep(.backup-select.p-select) {
  width: 240px;
  font-size: 12px;
  height: 30px;
}

/* ============================================
 * 底部操作栏
 * ============================================ */

.action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-top: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.action-bar-left {
  font-size: 12px;
  color: var(--text-secondary);
}

.action-bar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.backup-hint {
  font-size: 11px;
  color: var(--text-muted);
}

/* ============================================
 * 确认弹窗
 * ============================================ */

.confirm-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.confirm-summary {
  font-size: 14px;
  color: var(--text-main);
  margin: 0;
}

.confirm-file {
  padding: 8px 0;
}

.confirm-file-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-main);
  margin-bottom: 4px;
}

.confirm-file-name .pi { font-size: 14px; color: var(--primary); }

.confirm-replacement {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0 2px 20px;
  font-size: 12px;
}

.rep-line { color: var(--text-muted); flex-shrink: 0; }
.rep-old { color: var(--error); text-decoration: line-through; }
.rep-arrow { color: var(--text-muted); }
.rep-new { color: var(--success); }

.confirm-safety {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 8px;
  background: var(--primary-alpha-8);
  border: 1px solid var(--primary-alpha-15);
}

.confirm-safety .pi { font-size: 14px; color: var(--primary); }
.confirm-safety span { font-size: 13px; color: var(--text-secondary); }

/* ============================================
 * Diff 预览
 * ============================================ */

.diff-view {
  max-height: 60vh;
  overflow-y: auto;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 12px;
  line-height: 1.6;
}

.diff-line {
  display: flex;
  gap: 12px;
  padding: 1px 8px;
  white-space: pre-wrap;
  word-break: break-all;
}

.diff-line.removed {
  background: color-mix(in srgb, var(--error) 10%, transparent);
  color: var(--error);
}

.diff-line.added {
  background: color-mix(in srgb, var(--success) 10%, transparent);
  color: var(--success);
}

.diff-line-num {
  flex-shrink: 0;
  width: 40px;
  text-align: right;
  color: var(--text-muted);
}

.diff-line-text { flex: 1; min-width: 0; }
.diff-empty { text-align: center; padding: 40px; color: var(--text-muted); }
</style>
