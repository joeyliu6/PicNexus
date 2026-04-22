<script setup lang="ts">
/**
 * 批量迁移 · 分页条
 *
 * 视觉对齐 CheckBottomBar 的分页块（26×26 chevron + 32×22 页码输入 + "/ totalPages"）。
 * 总数 > pageSize 时由父组件挂载，否则不渲染。
 */
import { ref, watch } from 'vue';

interface Props {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  /** 当前过滤后的显示条数，用于右侧 summary（不写死 "共 X 条" 的话可忽略） */
  visibleCount?: number;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  visibleCount: 0,
  disabled: false,
});

const emit = defineEmits<{
  'update:currentPage': [page: number];
}>();

const pageInput = ref(String(props.currentPage));

watch(() => props.currentPage, (v) => {
  pageInput.value = String(v);
});

function clamp(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > props.totalPages) return props.totalPages;
  return n;
}

function go(delta: number) {
  if (props.disabled) return;
  const next = clamp(props.currentPage + delta);
  if (next !== props.currentPage) emit('update:currentPage', next);
}

function onInput(ev: Event) {
  const raw = (ev.target as HTMLInputElement).value.trim();
  const n = parseInt(raw, 10);
  const next = clamp(Number.isFinite(n) ? n : props.currentPage);
  pageInput.value = String(next);
  if (next !== props.currentPage) emit('update:currentPage', next);
}

function selectAll(ev: FocusEvent) {
  (ev.target as HTMLInputElement).select();
}
</script>

<template>
  <div class="m-pager" :class="{ 'm-pager--disabled': disabled }">
    <button
      class="m-pager-btn"
      type="button"
      :disabled="disabled || currentPage <= 1"
      @click="go(-1)"
    >
      <i class="pi pi-chevron-left" />
    </button>

    <span class="m-pager-info">
      <input
        v-model="pageInput"
        class="m-pager-input"
        type="text"
        :disabled="disabled"
        @keydown.enter="onInput"
        @blur="onInput"
        @focus="selectAll"
      />
      / {{ totalPages }}
    </span>

    <button
      class="m-pager-btn"
      type="button"
      :disabled="disabled || currentPage >= totalPages"
      @click="go(1)"
    >
      <i class="pi pi-chevron-right" />
    </button>

    <span class="m-pager-summary">共 {{ totalItems.toLocaleString() }} 条</span>
  </div>
</template>

<style scoped>
.m-pager {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
}
.m-pager--disabled { opacity: 0.5; }

.m-pager-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 26px 方形对齐链接监控分页按钮 */
  width: 26px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 26px 方形对齐链接监控分页按钮 */
  height: 26px;
  border: none;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 5px 圆角沿用链接监控现有规范无对应 token */
  border-radius: 5px;
  background: var(--bg-input);
  color: var(--text-muted);
  cursor: pointer;
  transition: background var(--duration-micro), color var(--duration-micro);
  font-size: var(--text-xs);
}

.m-pager-btn:hover:not(:disabled) {
  background: var(--primary-alpha-8);
  color: var(--primary);
}

.m-pager-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.m-pager-info {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  margin: 0 var(--space-xs);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.m-pager-input {
  width: 32px;
  height: 22px;
  text-align: center;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-main);
  font-size: var(--text-xs);
  outline: none;
}
.m-pager-input:focus { border-color: var(--primary); }

.m-pager-summary {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
  margin-left: var(--space-sm);
  font-variant-numeric: tabular-nums;
}
</style>
