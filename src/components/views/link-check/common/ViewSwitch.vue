<script setup lang="ts" generic="T extends string">
/**
 * 维护页列表上方的二选一（「有问题 / 全部」「失败 / 全部」）：每个选项带数量
 */
defineProps<{
  options: Array<{ value: T; label: string; count: number }>;
  /** 读屏用的整组名称（如「列表范围」） */
  groupLabel: string;
}>();

const model = defineModel<T>({ required: true });
</script>

<template>
  <div class="view-switch" role="tablist" :aria-label="groupLabel">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="tab"
      class="view-option"
      :class="{ active: model === option.value }"
      :aria-selected="model === option.value"
      @click="model = option.value"
    >
      {{ option.label }}
      <span class="view-count">{{ option.count.toLocaleString() }}</span>
    </button>
  </div>
</template>

<style scoped>
.view-switch {
  display: inline-flex;
  flex-shrink: 0;
  padding: var(--space-2xs);
  border-radius: var(--radius-md);
  background: var(--bg-input);
}

.view-option {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs-sm);
  height: 26px;
  padding: 0 var(--space-md);
  border: none;
  border-radius: var(--radius-sm-md);
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast);
}

.view-option:hover {
  color: var(--text-main);
}

.view-option.active {
  background: var(--bg-card);
  color: var(--text-main);
  box-shadow: var(--shadow-sm);
}

.view-count {
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.view-option.active .view-count {
  color: var(--text-muted);
}
</style>
