<script setup lang="ts">
/**
 * 内联空状态组件
 * 用于侧边栏、小型列表、日志面板等紧凑区域
 *
 * 用法：
 *   <InlineEmptyState icon="pi pi-inbox" title="暂无记录" />
 *   <InlineEmptyState icon="pi pi-inbox" title="暂无可迁移的图片" hint="历史记录中没有符合条件的图片" />
 */
defineProps<{
  /** PrimeVue 图标 class，如 'pi pi-inbox' */
  icon?: string
  /** 主标题 */
  title?: string
  /** 提示文字（可选） */
  hint?: string
}>()
</script>

<template>
  <div class="inline-empty">
    <i v-if="icon" :class="icon" class="inline-empty__icon" />
    <span v-if="title" class="inline-empty__title">{{ title }}</span>
    <span v-if="hint" class="inline-empty__hint">{{ hint }}</span>
  </div>
</template>

<style scoped>
.inline-empty {
  display: flex;
  flex-direction: column;
  place-items: center;
  flex: 1;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 5px 介于 --space-xs(4px) 和 --space-xs-sm(6px) 之间，无精确 token */
  gap: 5px;
  padding: var(--space-lg);
  color: var(--text-tertiary);
}

.inline-empty__icon {
  font-size: var(--text-4xl);
  color: var(--text-disabled);
  opacity: 0.5;
}

.inline-empty__title {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-secondary);
}

.inline-empty__hint {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
</style>
