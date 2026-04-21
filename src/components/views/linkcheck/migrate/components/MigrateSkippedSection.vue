<script setup lang="ts">
/**
 * 终态 · 跳过/失败项区
 * 失败项重设计：
 * - 去掉左侧彩色大标签（下载失败/上传失败），改用行首小 pill
 * - 错误信息显示为大类中文（网络中断 / 图床服务异常 等），悬停 ⓘ 看原始技术错误
 * - 去掉「复制错误信息」和「跳过」按钮，每条只保留「重试」
 * - 章节标题字号和 padding 加大，视觉分量更足
 */
import { computed, ref } from 'vue';
import { getServiceDisplayName } from '../../../../../constants/serviceNames';
import { categorizeMigrateError } from '../../../../../utils/uploadFailureMessage';
import type { MigrateFailureDetail } from '../../../../../types/batchMigrate';

interface SkippedItem {
  historyId?: string;
  fileName: string;
  error: string;
  errorType?: 'download' | 'upload';
  details?: MigrateFailureDetail[];
}

interface Props {
  items: SkippedItem[];
  defaultExpanded?: boolean;
  title?: string;
  hint?: string;
  retryingIds?: Set<string>;
  /** 是否是失败项视图——决定是否渲染重试按钮 */
  isFailureView?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  defaultExpanded: true,
  title: '已跳过',
  hint: '· 已保留原链接，可重新发起迁移',
  retryingIds: () => new Set<string>(),
  isFailureView: false,
});

const emit = defineEmits<{
  retryAll: [];
  retryOne: [historyId: string];
}>();

const expanded = ref(props.defaultExpanded);
const count = computed(() => props.items.length);

function toggle() {
  expanded.value = !expanded.value;
}

const errorTypeLabel = (errorType?: 'download' | 'upload') =>
  errorType === 'download' ? '下载' : '上传';

/** 行主文案：合并所有 detail 的友好大类（多目标同样问题只显示一次） */
function primaryReason(item: SkippedItem): string {
  const details = item.details && item.details.length > 0
    ? item.details
    : [{ message: item.error } as MigrateFailureDetail];
  const categories = new Set<string>();
  for (const d of details) {
    const { category } = categorizeMigrateError(item.errorType, d.message);
    categories.add(category);
  }
  return Array.from(categories).join(' / ');
}

/** tooltip：每个目标图床一行原始错误，方便截图反馈 */
function tooltipText(item: SkippedItem): string {
  const details = item.details && item.details.length > 0
    ? item.details
    : [{ message: item.error } as MigrateFailureDetail];
  return details
    .map(d => d.serviceId ? `${getServiceDisplayName(d.serviceId)} · ${d.message}` : d.message)
    .join('\n');
}
</script>

<template>
  <section v-if="count > 0" class="skipped-section" :class="{ 'skipped-section--failure': isFailureView }">
    <div class="sk-head" :class="{ 'sk-head--failure': isFailureView }">
      <button class="sk-head-toggle" type="button" @click="toggle">
        <i class="pi pi-chevron-down sk-chev" :class="{ 'sk-chev--open': expanded }" />
        <span class="sk-title">{{ title }}</span>
        <span class="sk-badge" :class="{ 'sk-badge--failure': isFailureView }">{{ count }}</span>
        <span class="sk-hint">{{ hint }}</span>
      </button>
      <span class="sk-spacer" />
      <button
        v-if="isFailureView"
        class="sk-retry-all"
        type="button"
        :disabled="retryingIds.size > 0"
        @click="emit('retryAll')"
      >
        <i class="pi pi-refresh" /> 全部重试
      </button>
      <template v-else>
        <span class="sk-dot" />
        <span class="sk-count">共 {{ count }} 项</span>
      </template>
    </div>

    <div v-show="expanded" class="sk-list">
      <div
        v-for="(item, idx) in items"
        :key="item.historyId ?? idx"
        class="sk-row"
        :class="{ 'sk-row--retrying': item.historyId && retryingIds.has(item.historyId) }"
      >
        <div class="sk-row-body">
          <div class="sk-row-name">{{ item.fileName }}</div>
          <div class="sk-row-reason">
            <span
              class="sk-row-tag"
              :class="item.errorType === 'download' ? 'sk-row-tag--dl' : 'sk-row-tag--ul'"
            >{{ errorTypeLabel(item.errorType) }}</span>
            <span class="sk-row-category">{{ primaryReason(item) }}</span>
            <i
              class="pi pi-info-circle sk-row-info"
              v-tooltip.top="{ value: tooltipText(item), autoHide: false }"
              aria-label="查看原始错误信息"
            />
          </div>
        </div>
        <div class="sk-row-actions">
          <template v-if="isFailureView && item.historyId">
            <span v-if="retryingIds.has(item.historyId)" class="sk-retrying">
              <i class="pi pi-spin pi-spinner" /> 重试中
            </span>
            <button
              v-else
              class="sk-action-btn"
              type="button"
              @click="emit('retryOne', item.historyId)"
            >
              <i class="pi pi-refresh" /> 重试
            </button>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.skipped-section {
  display: flex; flex-direction: column; flex-shrink: 0;
  border: 1px solid color-mix(in srgb, var(--state-warn-text) 25%, transparent);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  overflow: hidden;
  box-shadow: 0 2px 12px color-mix(in srgb, var(--state-warn-text) 8%, transparent);
}

.sk-head {
  display: flex; align-items: center; gap: var(--space-sm);
  width: 100%;
  padding: var(--space-lg);
  background: transparent;
  font-family: inherit;
  font-size: var(--text-lg);
  transition: background var(--duration-fast);
}
.sk-head--failure { background: var(--state-error-bg-soft); }

.sk-head-toggle {
  display: inline-flex; align-items: center; gap: var(--space-sm);
  background: transparent; border: none; cursor: pointer;
  font-family: inherit;
  font-size: var(--text-lg);
  color: inherit; padding: 0;
}
.sk-head-toggle:hover { opacity: 0.8; }

.sk-chev {
  font-size: var(--text-sm); color: var(--text-tertiary);
  transform: rotate(-90deg);
  transition: transform var(--duration-fast) var(--ease-standard);
}
.sk-chev--open { transform: rotate(0deg); }

.sk-title {
  font-weight: var(--weight-bold);
  color: var(--text-main);
}

.sk-badge {
  padding: var(--space-2xs) var(--space-xs-sm);
  border-radius: var(--radius-sm);
  background: var(--state-warn-bg-soft);
  color: var(--state-warn-text);
  font-size: var(--text-xs); font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
}
.sk-badge--failure { background: var(--state-error-bg); color: var(--state-error-text); }

.sk-retry-all {
  display: inline-flex; align-items: center; gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm-md);
  border: none; border-radius: var(--radius-sm-md);
  background: var(--error); color: var(--text-on-error, #fff);
  font-family: inherit;
  font-size: var(--text-xs); font-weight: var(--weight-semibold);
  cursor: pointer;
  transition: background var(--duration-fast);
}
.sk-retry-all:disabled { opacity: 0.55; cursor: not-allowed; }
.sk-retry-all:hover:not(:disabled) { background: color-mix(in srgb, var(--error) 85%, black); }
.sk-hint { color: var(--text-muted); font-size: var(--text-sm); }
.sk-spacer { flex: 1; }

.sk-dot {
  width: 8px; height: 8px; border-radius: var(--radius-full);
  background: var(--state-warn-text);
}
.sk-count { font-size: var(--text-sm); color: var(--text-muted); font-variant-numeric: tabular-nums; }

.sk-list {
  border-top: 1px solid var(--border-subtle);
  display: flex; flex-direction: column;
}

.sk-row {
  display: flex; align-items: center; gap: var(--space-md);
  padding: var(--space-sm-md) var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
  transition: opacity var(--duration-fast);
}
.sk-row:last-child { border-bottom: none; }
.sk-row--retrying { opacity: 0.6; }

.sk-row-body {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column;
  gap: var(--space-2xs);
}

.sk-row-name {
  font-family: var(--font-mono, monospace);
  font-size: var(--text-sm);
  color: var(--text-main);
  font-weight: var(--weight-medium);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.sk-row-reason {
  display: flex; align-items: center; gap: var(--space-xs);
  font-size: var(--text-xs);
  color: var(--text-muted);
  min-width: 0;
}

.sk-row-tag {
  padding: var(--space-2xs) var(--space-xs-sm);
  border-radius: var(--radius-xs);
  font-size: var(--text-2xs);
  font-weight: var(--weight-semibold);
  flex-shrink: 0;
}

.sk-row-tag--dl {
  background: var(--state-warn-bg);
  color: var(--state-warn-text);
}

.sk-row-tag--ul {
  background: var(--state-error-bg);
  color: var(--state-error-text);
}

.sk-row-category {
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.sk-row-info {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  cursor: help;
  flex-shrink: 0;
  transition: color var(--duration-fast);
}
.sk-row-info:hover { color: var(--text-muted); }

.sk-row-actions {
  display: flex; align-items: center; gap: var(--space-xs);
  flex-shrink: 0;
}

.sk-action-btn {
  display: inline-flex; align-items: center; gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--bg-input); border: 1px solid transparent;
  color: var(--text-main); font-family: inherit;
  font-size: var(--text-xs); font-weight: var(--weight-medium);
  cursor: pointer;
  transition: background var(--duration-fast);
}
.sk-action-btn:hover { background: var(--hover-overlay); }
.sk-action-btn i { font-size: var(--text-2xs); }

.sk-retrying {
  display: inline-flex; align-items: center; gap: var(--space-xs);
  color: var(--primary);
  font-size: var(--text-xs); font-weight: var(--weight-medium);
}
</style>
