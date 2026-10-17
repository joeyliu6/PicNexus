<script setup lang="ts">
// 右键菜单项（同 PnMenuItem 的普通项 / 危险项）
import { ContextMenuItem } from 'reka-ui';

withDefaults(defineProps<{ danger?: boolean }>(), { danger: false });
defineEmits<{ select: [event: Event] }>();
</script>

<template>
  <ContextMenuItem class="pn-menu__item" :class="{ 'pn-menu__item--danger': danger }" @select="$emit('select', $event)">
    <span class="pn-menu__label"><slot /></span>
  </ContextMenuItem>
</template>
