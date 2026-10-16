<script setup lang="ts">
// 品牌花瓣标（四瓣渐变）：侧栏 Logo、首页插画等处共用
import { useId } from 'vue';

withDefaults(defineProps<{ size?: number }>(), { size: 18 });

const gradientId = `pn-brand-${useId()}`;
</script>

<template>
  <svg :width="size" :height="size" viewBox="-4 -4 136 136" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient :id="gradientId" x1="8" y1="8" x2="120" y2="120" gradientUnits="userSpaceOnUse">
        <stop offset="0" class="brand-mark__stop-a" />
        <stop offset="1" class="brand-mark__stop-b" />
      </linearGradient>
    </defs>
    <g :fill="`url(#${gradientId})`">
      <path d="M64 58L44 29Q40 22 45 16L57 4Q64 -2 71 4L83 16Q88 22 84 29Z" />
      <path d="M70 64L99 44Q106 40 112 45L124 57Q130 64 124 71L112 83Q106 88 99 84Z" />
      <path d="M64 70L84 99Q88 106 83 112L71 124Q64 130 57 124L45 112Q40 106 44 99Z" />
      <path d="M58 64L29 84Q22 88 16 83L4 71Q-2 64 4 57L16 45Q22 40 29 44Z" />
    </g>
  </svg>
</template>

<style scoped>
.brand-mark__stop-a { stop-color: var(--pn-grad-a); }
.brand-mark__stop-b { stop-color: var(--pn-grad-b); }
</style>
