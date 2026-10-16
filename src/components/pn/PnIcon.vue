<script setup lang="ts">
// 线条图标：形状见 icons.ts（照抄设计源文件），颜色跟随 currentColor
import { computed } from 'vue';
import { ICONS, type IconName } from './icons';

const props = withDefaults(defineProps<{
  name: IconName;
  /** 边长（px），设计稿常用 12 / 14 / 16 */
  size?: number;
  /** 描边粗细，设计稿按尺寸取 1.4–2.6 */
  stroke?: number;
  /** 实心（如已收藏的星）：填 currentColor */
  filled?: boolean;
}>(), {
  size: 16,
  stroke: 1.6,
  filled: false,
});

const shapes = computed(() => ICONS[props.name]);
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    :fill="filled ? 'currentColor' : 'none'"
    stroke="currentColor"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <component :is="tag" v-for="([tag, attrs], i) in shapes" :key="i" v-bind="attrs" />
  </svg>
</template>
