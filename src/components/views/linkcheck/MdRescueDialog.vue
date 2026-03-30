<script setup lang="ts">
/**
 * 文档修复弹窗
 * 包含文件选择引导页 + 链接确认列表 + MdRescuePanel 三阶段
 */
import { watch, computed } from 'vue';
import Checkbox from 'primevue/checkbox';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import MdRescuePanel from './MdRescuePanel.vue';
import { useMdRescueManager } from '../../../composables/useMdRescue';
import { smartTruncateUrl } from '../../../utils/mdParser';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
}>();

const {
  mode: rescueMode,
  imageLinks,
  isAnalyzing,
  isReplacing,
  isChecking: rescueChecking,
  progress: rescueProgress,
  stats: rescueStats,
  displayPath,
  displayLabel,
  displayFilter,
  brokenLinks,
  healthyLinks,
  filteredLinks,
  excludedUrls,
  selectMdFile,
  selectFolder,
  analyzeFile,
  toggleExclude,
  excludeAll,
  includeAll,
  executeReplace,
  generateDiff,
  autoSelectAndGetSummary,
  reset: resetRescue,
} = useMdRescueManager();

/** 是否处于"确认链接"步骤：已选择文件、有链接、但尚未开始检测 */
const needsReview = computed(() =>
  !!displayPath.value
  && imageLinks.value.length > 0
  && rescueStats.value.checked === 0
  && !isAnalyzing.value,
);

/** 已进入检测/结果阶段 */
const hasStartedAnalysis = computed(() =>
  !!displayPath.value
  && (rescueStats.value.checked > 0 || isAnalyzing.value),
);

/** 确认列表中选中的链接数 */
const includedCount = computed(() =>
  imageLinks.value.filter((l) => !excludedUrls.value.has(l.url)).length,
);

const isAllIncluded = computed(() => excludedUrls.value.size === 0);

const contextLabels: Record<string, string> = {
  blockquote: '引用块',
  table: '表格',
};

// 关闭弹窗时重置状态
function handleClose() {
  resetRescue();
  emit('update:visible', false);
}

// 监听 visible 变化，false 时也清空
watch(() => props.visible, (val) => {
  if (!val) resetRescue();
});

async function handleSelectFile() {
  await selectMdFile();
}

async function handleSelectFolder() {
  await selectFolder();
}

async function changeFile() {
  await selectMdFile();
}

async function changeFolder() {
  await selectFolder();
}

/** 确认后开始检测 */
async function handleConfirmAndAnalyze() {
  await analyzeFile();
}

/** 跳过确认，直接全部检测 */
async function handleSkipReview() {
  includeAll();
  await analyzeFile();
}

function isLinkIncluded(url: string): boolean {
  return !excludedUrls.value.has(url);
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :closable="true"
    :draggable="false"
    header="文档修复"
    :style="{ width: '800px', height: '80vh' }"
    @update:visible="(val: boolean) => val ? null : handleClose()"
    :pt="{
      content: { style: 'padding: 0; display: flex; flex-direction: column; flex: 1; overflow: hidden;' },
    }"
  >
    <!-- 阶段一：未选文件，显示引导页 -->
    <div v-if="!displayPath" class="repair-landing">
      <div class="repair-landing-content">
        <div class="repair-hero-icon">
          <i class="pi pi-file-edit"></i>
        </div>
        <h3 class="repair-landing-title">修复你的 Markdown 文档</h3>
        <p class="repair-landing-desc">
          扫描文档中的图片链接，自动匹配上传历史中的可用备份
        </p>
        <div class="repair-dropzone" @click="handleSelectFile">
          <p class="dropzone-hint">选择文件开始分析</p>
          <div class="dropzone-actions">
            <button class="repair-action-btn primary" @click.stop="handleSelectFile">
              <i class="pi pi-file"></i> 选择文件
            </button>
            <button class="repair-action-btn ghost" @click.stop="handleSelectFolder">
              <i class="pi pi-folder"></i> 选择文件夹
            </button>
          </div>
        </div>
        <span class="repair-formats">支持 .md .markdown 文件</span>
      </div>
    </div>

    <!-- 阶段二：确认链接列表 -->
    <div v-else-if="needsReview" class="review-step">
      <div class="review-header">
        <div class="review-title-row">
          <i class="pi pi-list-check"></i>
          <span class="review-title">已提取 {{ imageLinks.length }} 个图片链接</span>
        </div>
        <p class="review-desc">取消勾选不需要检测的链接，代码块中的链接已自动过滤</p>
      </div>

      <div class="review-toolbar">
        <button class="review-toggle-btn" @click="isAllIncluded ? excludeAll() : includeAll()">
          {{ isAllIncluded ? '取消全选' : '全选' }}
        </button>
        <span class="review-count">{{ includedCount }} / {{ imageLinks.length }} 已选</span>
      </div>

      <div class="review-list">
        <div
          v-for="(link, idx) in imageLinks"
          :key="link.url + '-' + idx"
          class="review-item"
          :class="{ excluded: !isLinkIncluded(link.url) }"
        >
          <Checkbox
            :modelValue="isLinkIncluded(link.url)"
            :binary="true"
            @update:modelValue="toggleExclude(link.url)"
          />
          <span class="review-line-chip">L{{ link.lineNumber }}</span>
          <span class="review-url" :title="link.url">{{ smartTruncateUrl(link.url, 60) }}</span>
          <span
            v-if="link.context && link.context !== 'normal'"
            class="review-context-tag"
          >{{ contextLabels[link.context] }}</span>
        </div>
        <div v-if="imageLinks.length === 0" class="review-empty">
          <i class="pi pi-inbox"></i>
          <span>未找到图片链接</span>
        </div>
      </div>

      <div class="review-actions">
        <button class="review-skip-btn" @click="handleSkipReview">跳过确认，直接检测</button>
        <Button
          label="开始检测"
          icon="pi pi-search"
          @click="handleConfirmAndAnalyze"
          size="small"
          severity="primary"
          :disabled="includedCount === 0"
        />
      </div>
    </div>

    <!-- 阶段三：已选文件，显示修复面板 -->
    <MdRescuePanel
      v-else-if="hasStartedAnalysis"
      :image-links="imageLinks"
      :stats="rescueStats"
      :display-path="displayPath"
      :display-label="displayLabel"
      :mode="rescueMode"
      :is-analyzing="isAnalyzing"
      :is-replacing="isReplacing"
      :is-checking="rescueChecking"
      :progress="rescueProgress"
      :display-filter="displayFilter"
      :broken-links="brokenLinks"
      :healthy-links="healthyLinks"
      :filtered-links="filteredLinks"
      dialog-mode
      @back="handleClose"
      @change-file="changeFile"
      @change-folder="changeFolder"
      @analyze="analyzeFile"
      @update-filter="(f: 'broken' | 'healthy' | 'all') => (displayFilter = f)"
      @auto-fix="autoSelectAndGetSummary"
      @execute-replace="executeReplace"
      @generate-diff="generateDiff"
    />
  </Dialog>
</template>

<style scoped>
/* 引导页（从 LinkCheckView 迁移） */
.repair-landing {
  flex: 1; display: flex; align-items: center; justify-content: center;
}
.repair-landing-content {
  display: flex; flex-direction: column; align-items: center; gap: 14px;
  max-width: 420px; text-align: center;
}
.repair-hero-icon {
  width: 56px; height: 56px; display: flex; align-items: center; justify-content: center;
  border-radius: 16px; background: var(--primary-alpha-10);
}
.repair-hero-icon .pi { font-size: 24px; color: var(--primary); }
.repair-landing-title {
  font-size: 18px; font-weight: 700; color: var(--text-main); margin-top: 2px;
}
.repair-landing-desc {
  font-size: 13px; color: var(--text-muted); line-height: 1.6;
}
.repair-dropzone {
  display: flex; flex-direction: column; align-items: center; gap: 16px;
  padding: 28px 40px; width: 100%;
  border: 2px dashed var(--border-subtle); border-radius: 12px;
  cursor: pointer; transition: border-color 0.2s, background 0.2s;
}
.repair-dropzone:hover {
  border-color: var(--primary-alpha-40); background: var(--primary-alpha-5);
}
.dropzone-hint { font-size: 13px; color: var(--text-tertiary); margin: 0; }
.dropzone-actions { display: flex; gap: 10px; }
.repair-action-btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 8px 20px;
  border-radius: 8px; border: 1px solid var(--border-subtle); background: transparent;
  color: var(--text-muted); font-size: 13px; font-weight: 500;
  cursor: pointer; transition: background 0.15s, border-color 0.15s, opacity 0.15s;
}
.repair-action-btn.ghost:hover { background: var(--hover-overlay); border-color: var(--text-muted); }
.repair-action-btn.primary {
  background: var(--primary); border-color: var(--primary); color: #fff;
}
.repair-action-btn.primary:hover { opacity: 0.9; }
.repair-formats { font-size: 11px; color: var(--text-tertiary); }

/* 确认链接列表 */
.review-step {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.review-header {
  padding: 20px 20px 12px;
  flex-shrink: 0;
}

.review-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.review-title-row .pi {
  font-size: 16px;
  color: var(--primary);
}

.review-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-main);
}

.review-desc {
  font-size: 13px;
  color: var(--text-muted);
  margin: 6px 0 0;
  line-height: 1.5;
}

.review-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px 8px;
  flex-shrink: 0;
}

.review-toggle-btn {
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.review-toggle-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.review-count {
  font-size: 12px;
  color: var(--text-muted);
}

.review-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 20px;
}

.review-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-subtle);
  transition: opacity 0.15s;
}

.review-item:last-child { border-bottom: none; }

.review-item.excluded {
  opacity: 0.45;
}

.review-line-chip {
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

.review-url {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

.review-context-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  color: var(--warning);
  font-size: 11px;
  font-weight: 500;
  flex-shrink: 0;
}

.review-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 0;
  color: var(--text-muted);
  font-size: 13px;
}

.review-empty .pi { font-size: 24px; opacity: 0.4; }

.review-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 12px 20px;
  border-top: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.review-skip-btn {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
  transition: color 0.15s;
}

.review-skip-btn:hover {
  color: var(--text-secondary);
}
</style>
