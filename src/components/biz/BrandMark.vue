<script setup lang="ts">
// 品牌花瓣标（四瓣渐变）：侧栏 Logo、首页插画等处共用
// open：⑦ 拖入感应（M07），松开就会上传时四片花瓣向外张开「接住」图片，拖出、松手即合拢
import { useId } from 'vue';
import { CLASSIC_PETAL_PATHS } from '@/utils/petals';

withDefaults(defineProps<{ size?: number; open?: boolean }>(), { size: 18, open: false });

const gradientId = `pn-brand-${useId()}`;
/** 与 CLASSIC_PETAL_PATHS 同序：上、右、下、左 */
const DIRECTIONS = ['up', 'right', 'down', 'left'] as const;
</script>

<template>
  <svg :width="size" :height="size" viewBox="-4 -4 136 136" class="brand-mark" :class="{ 'brand-mark--open': open }" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient :id="gradientId" x1="8" y1="8" x2="120" y2="120" gradientUnits="userSpaceOnUse">
        <stop offset="0" class="brand-mark__stop-a" />
        <stop offset="1" class="brand-mark__stop-b" />
      </linearGradient>
    </defs>
    <g :fill="`url(#${gradientId})`">
      <path v-for="(d, i) in CLASSIC_PETAL_PATHS" :key="i" :d="d" class="brand-mark__petal" :class="`brand-mark__petal--${DIRECTIONS[i]}`" />
    </g>
  </svg>
</template>

<style scoped>
.brand-mark { overflow: visible; }
.brand-mark__stop-a { stop-color: var(--pn-grad-a); }
.brand-mark__stop-b { stop-color: var(--pn-grad-b); }

/* 合拢比张开快 30%（交接说明 5.3：退场快 30%） */
.brand-mark__petal { transition: transform calc(var(--pn-dur-receive) * 0.7) var(--pn-ease-out); }
.brand-mark--open .brand-mark__petal { transition: transform var(--pn-dur-receive) var(--pn-ease-in); }
.brand-mark--open .brand-mark__petal--up { transform: translateY(calc(-1 * var(--pn-receive-petal-shift))); }
.brand-mark--open .brand-mark__petal--right { transform: translateX(var(--pn-receive-petal-shift)); }
.brand-mark--open .brand-mark__petal--down { transform: translateY(var(--pn-receive-petal-shift)); }
.brand-mark--open .brand-mark__petal--left { transform: translateX(calc(-1 * var(--pn-receive-petal-shift))); }

/* 「减少动态效果」：花瓣不动，遮罩上的文字照样说明松开后会怎样 */
@media (prefers-reduced-motion: reduce) {
  .brand-mark--open .brand-mark__petal { transform: none; }
}
</style>
