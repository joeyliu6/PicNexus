<script setup lang="ts">
// 复制按钮（Patterns.dc.html）：原地变成「✓ 已复制」，1.5 秒后复原，不弹通知。
// 只管样子；复制什么、何时复原由调用方决定（配合 useCopyBadgeFeedback(1500)）。
// ghost = 文字按钮样式（HomeScreen.dc.html「最近上传」里一组多张的「复制全部」）：透明底、高 26、字重 500，平时不带图标。
import PnIcon from '@/components/pn/PnIcon.vue';

withDefaults(defineProps<{
  copied?: boolean;
  label?: string;
  ghost?: boolean;
}>(), { copied: false, label: '复制', ghost: false });

defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <button type="button" class="copy-button" :class="{ 'copy-button--done': copied, 'copy-button--ghost': ghost }" @click="$emit('click', $event)">
    <PnIcon v-if="copied || !ghost" :name="copied ? 'check' : 'copy'" :size="13" :stroke="copied ? 2.4 : 1.9" />
    <span aria-live="polite">{{ copied ? '已复制' : label }}</span>
  </button>
</template>

<style scoped>
.copy-button {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--pn-space-copy-gap);
  height: var(--pn-size-button-sm);
  padding: 0 var(--pn-space-button-sm-x);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: var(--pn-secondary-bg);
  box-shadow: var(--pn-secondary-ring);
  color: var(--pn-text1);
  font: inherit;
  font-size: var(--pn-text-footnote);
  transition: background-color var(--pn-dur-fast) var(--pn-ease-in), color var(--pn-dur-fast) var(--pn-ease-in), box-shadow var(--pn-dur-fast) var(--pn-ease-in);
}

.copy-button:hover { background: var(--pn-secondary-hover); }
.copy-button:active { background: var(--pn-secondary-press); }

.copy-button--ghost {
  height: var(--pn-size-seg-item);
  padding: 0 var(--pn-space-8);
  border-radius: var(--pn-radius-sm);
  background: transparent;
  box-shadow: none;
  font-weight: var(--pn-weight-medium);
}

.copy-button--ghost:hover { background: var(--pn-selected); }
.copy-button--ghost:active { background: var(--pn-ghost-press); }

.copy-button--done,
.copy-button--done:hover,
.copy-button--done:active {
  background: var(--pn-success-soft);
  box-shadow: none;
  color: var(--pn-success);
  font-weight: var(--pn-weight-medium);
}
</style>
