<script setup lang="ts">
// 下拉菜单（Controls.dc.html / 各页面「⋯」菜单）：外圆角 10 = 菜单项 6 + 内距 4；项高 32；
// 危险项放最后、红字，前面隔一条线。菜单项见 PnMenuItem / PnMenuCheckItem / PnMenuRadioItem / PnMenuSub。
// 贴近窗口边缘时让出 8px，不贴边（与弹出层一致）。
import { DropdownMenuContent, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui';

const open = defineModel<boolean>('open', { default: false });

withDefaults(defineProps<{
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  /** 菜单宽度（px）；不给则随内容 */
  width?: number;
}>(), {
  align: 'end',
  side: 'bottom',
  sideOffset: 4,
  width: undefined,
});
</script>

<template>
  <DropdownMenuRoot v-model:open="open" :modal="false">
    <DropdownMenuTrigger as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        class="pn-layer pn-menu"
        :align="align"
        :side="side"
        :side-offset="sideOffset"
        :collision-padding="8"
        :style="width ? { width: `${width}px` } : undefined"
      >
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
