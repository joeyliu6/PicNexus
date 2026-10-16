<script setup lang="ts">
// 快捷键标签（Patterns.dc.html）：等宽 11px、细描边；macOS 写 ⌘ / ⇧，其他平台写 Ctrl / Shift
defineProps<{ keys: string }>();
</script>

<template>
  <kbd class="pn-kbd">{{ keys }}</kbd>
</template>

<style scoped>
.pn-kbd {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--pn-space-kbd-x);
  border-radius: var(--pn-radius-xs);
  box-shadow: inset 0 0 0 1px var(--pn-border);
  color: var(--pn-text3);
  font-family: var(--pn-font-mono);
  font-size: var(--pn-text-caption);
  line-height: var(--pn-leading-footnote);
}
</style>
