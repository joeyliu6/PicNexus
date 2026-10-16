<script setup lang="ts">
// 弹出层（Controls.dc.html，以「上传到」为例）：圆角 14、内距 8、浮层阴影 e3；点外面或 Esc 关闭
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';

const open = defineModel<boolean>('open', { default: false });

withDefaults(defineProps<{
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  width?: number;
  /** 无可见标题时给读屏用 */
  label?: string;
}>(), {
  align: 'start',
  side: 'bottom',
  sideOffset: 6,
  width: undefined,
  label: undefined,
});
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <slot name="trigger" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        class="pn-layer pn-popover"
        :align="align"
        :side="side"
        :side-offset="sideOffset"
        :aria-label="label"
        :style="width ? { width: `${width}px` } : undefined"
      >
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style>
.pn-popover {
  z-index: var(--pn-z-popover);
  display: flex;
  flex-direction: column;
  max-width: calc(100vw - var(--pn-space-32));
  box-sizing: border-box;
  padding: var(--pn-space-8);
  border-radius: var(--pn-radius-xl);
  background: var(--pn-elevated);
  box-shadow: var(--pn-e3);
}

.pn-popover[data-state='open'] { animation: pn-popover-in var(--pn-dur-standard) var(--pn-ease-in); }

@keyframes pn-popover-in {
  from { opacity: 0; transform: translateY(calc(-1 * var(--pn-space-4))); }
  to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .pn-popover[data-state='open'] { animation-name: pn-popover-fade; }
}

@keyframes pn-popover-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
