<script setup lang="ts">
/**
 * 批量迁移 · 「正在处理」视图的状态 chip 过滤条
 *
 * 视觉对齐 docs/flows/md-rescue-flow.md 的 `.mr-chip` 胶囊（26px，13px 圆角）。
 * 数量为 0 的 chip 自动变 disabled（不可点击，降不透明度）。
 */
export type MigrateStatusFilter = 'all' | 'processing' | 'success' | 'failed' | 'skipped';

export interface MigrateStatusCounts {
  all: number;
  processing: number;
  success: number;
  failed: number;
  skipped: number;
  /**
   * 预加载期间的全局总数；大于 all 时「全部」chip 显示「已加载 / 总数」。
   * 等于或未提供时只显示 all，done 态自动回到单数字。
   */
  total?: number;
}

interface Props {
  modelValue: MigrateStatusFilter;
  counts: MigrateStatusCounts;
  /** 是否显示「处理中」chip（migrating 态为 true，done 态为 false） */
  showProcessing?: boolean;
}

const props = withDefaults(defineProps<Props>(), { showProcessing: true });
const emit = defineEmits<{ 'update:modelValue': [value: MigrateStatusFilter] }>();

function select(filter: MigrateStatusFilter) {
  if (filter !== 'all' && props.counts[filter] === 0) return;
  emit('update:modelValue', filter);
}

function fmt(n: number): string {
  return n.toLocaleString();
}
</script>

<template>
  <div class="mf-chips" role="tablist" aria-label="处理状态筛选">
    <button
      type="button"
      class="mf-chip"
      :class="{ active: modelValue === 'all' }"
      role="tab"
      :aria-selected="modelValue === 'all'"
      @click="select('all')"
    >
      <span>全部</span>
      <span class="mf-chip-count">
        {{ fmt(counts.all) }}<template v-if="counts.total != null && counts.total > counts.all"> / {{ fmt(counts.total) }}</template>
      </span>
    </button>
    <button
      v-if="showProcessing"
      type="button"
      class="mf-chip mf-chip--processing"
      :class="{ active: modelValue === 'processing', disabled: counts.processing === 0 }"
      :disabled="counts.processing === 0"
      role="tab"
      :aria-selected="modelValue === 'processing'"
      @click="select('processing')"
    >
      <span class="mf-dot mf-dot--processing" />
      <span>处理中</span>
      <span class="mf-chip-count">{{ fmt(counts.processing) }}</span>
    </button>
    <button
      type="button"
      class="mf-chip mf-chip--success"
      :class="{ active: modelValue === 'success', disabled: counts.success === 0 }"
      :disabled="counts.success === 0"
      role="tab"
      :aria-selected="modelValue === 'success'"
      @click="select('success')"
    >
      <span class="mf-dot mf-dot--success" />
      <span>已完成</span>
      <span class="mf-chip-count">{{ fmt(counts.success) }}</span>
    </button>
    <button
      type="button"
      class="mf-chip mf-chip--failed"
      :class="{ active: modelValue === 'failed', disabled: counts.failed === 0 }"
      :disabled="counts.failed === 0"
      role="tab"
      :aria-selected="modelValue === 'failed'"
      @click="select('failed')"
    >
      <span class="mf-dot mf-dot--failed" />
      <span>失败</span>
      <span class="mf-chip-count">{{ fmt(counts.failed) }}</span>
    </button>
    <button
      type="button"
      class="mf-chip mf-chip--skipped"
      :class="{ active: modelValue === 'skipped', disabled: counts.skipped === 0 }"
      :disabled="counts.skipped === 0"
      role="tab"
      :aria-selected="modelValue === 'skipped'"
      @click="select('skipped')"
    >
      <span class="mf-dot mf-dot--skipped" />
      <span>已跳过</span>
      <span class="mf-chip-count">{{ fmt(counts.skipped) }}</span>
    </button>
  </div>
</template>

<style scoped>
.mf-chips {
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  flex-wrap: wrap;
}

.mf-chip {
  display: inline-flex;
  align-items: center;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 5px chip icon spacing has no exact token */
  gap: 5px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 26px chip height matches .mr-chip silhouette */
  height: 26px;
  padding: 0 var(--space-sm-md);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 13px pill radius matches .mr-chip silhouette */
  border-radius: 13px;
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
  background: var(--bg-input);
  color: var(--text-muted);
  border: 1px solid transparent;
  font-family: inherit;
  white-space: nowrap;
  transition: background var(--duration-fast), color var(--duration-fast), border-color var(--duration-fast);
}

.mf-chip:hover:not(:disabled) {
  background: var(--hover-overlay);
  border-color: var(--border-subtle);
}

.mf-chip.active {
  background: var(--primary-alpha-10);
  color: var(--primary);
  border-color: var(--primary-alpha-10);
}
.mf-chip.active .mf-chip-count { color: var(--primary); opacity: 0.85; }

.mf-chip.disabled,
.mf-chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
  background: var(--bg-input);
  color: var(--text-tertiary);
  border-color: transparent;
}

.mf-chip-count {
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
}

.mf-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-tertiary);
}

.mf-dot--processing { background: var(--primary); }
.mf-dot--success { background: var(--success); }
.mf-dot--failed { background: var(--error); }
.mf-dot--skipped { background: var(--warning); }
</style>
