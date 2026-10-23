<script setup lang="ts">
// 弹出层（Controls.dc.html，以「上传到」为例）：圆角 14、内距 8、浮层阴影 e3；点外面或 Esc 关闭
// 贴近窗口边缘时让出 8px，不贴边（与菜单一致）
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
        :collision-padding="8"
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

/* 出现 / 消失的动画与菜单、气泡共用，在 pn-base.css */
</style>
