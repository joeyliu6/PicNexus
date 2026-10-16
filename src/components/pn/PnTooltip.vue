<script setup lang="ts">
// 气泡：深色底白字 12px（交接说明 6.1 / 15）。键盘聚焦也会出现。
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui';

withDefaults(defineProps<{
  text: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  disabled?: boolean;
}>(), {
  side: 'top',
  sideOffset: 6,
  disabled: false,
});
</script>

<template>
  <TooltipRoot :disabled="disabled">
    <TooltipTrigger as-child>
      <slot />
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent class="pn-tooltip" :side="side" :side-offset="sideOffset">
        {{ text }}
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>

<!-- 内容被传送到 body，scoped 样式够不到，这里用不带 scoped 的唯一类名 -->
<style>
.pn-tooltip {
  z-index: var(--pn-z-tooltip);
  padding: var(--pn-space-4) var(--pn-space-8);
  border-radius: var(--pn-radius-sm);
  background: var(--pn-tooltip-bg);
  color: var(--pn-tooltip-fg);
  font-family: var(--pn-font-ui);
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-footnote);
  white-space: nowrap;
  user-select: none;
}
</style>
