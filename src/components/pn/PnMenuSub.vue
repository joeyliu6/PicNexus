<script setup lang="ts">
// 子菜单：父项右侧写当前取值 + ›
import { DropdownMenuPortal, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from 'reka-ui';
import PnIcon from './PnIcon.vue';

withDefaults(defineProps<{
  label: string;
  value?: string;
  width?: number;
}>(), { value: undefined, width: undefined });
</script>

<template>
  <DropdownMenuSub>
    <DropdownMenuSubTrigger class="pn-menu__item">
      <span class="pn-menu__label">{{ label }}</span>
      <span v-if="value" class="pn-menu__value">{{ value }}</span>
      <PnIcon name="chevronRight" :size="12" :stroke="1.8" class="pn-menu__chevron" />
    </DropdownMenuSubTrigger>
    <DropdownMenuPortal>
      <DropdownMenuSubContent class="pn-layer pn-menu" :side-offset="4" :collision-padding="8" :style="width ? { width: `${width}px` } : undefined">
        <slot />
      </DropdownMenuSubContent>
    </DropdownMenuPortal>
  </DropdownMenuSub>
</template>
