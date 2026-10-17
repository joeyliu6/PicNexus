<script setup lang="ts">
// 右键菜单：样式与下拉菜单相同（src/styles/pn-menu.css）。菜单项用 PnContextMenuItem。
import { ContextMenuContent, ContextMenuPortal, ContextMenuRoot, ContextMenuTrigger } from 'reka-ui';
</script>

<template>
  <ContextMenuRoot :modal="false">
    <ContextMenuTrigger as-child>
      <slot name="trigger" />
    </ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuContent class="pn-layer pn-menu" :collision-padding="8">
        <slot />
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
