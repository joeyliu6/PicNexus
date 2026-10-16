<script setup lang="ts">
// 骨架块（Patterns.dc.html / LoadingRules.dc.html）：形状和真实内容一致；超过 300ms 才出现由调用方控制
withDefaults(defineProps<{
  width?: string;
  height?: string;
  /** 'text' = 圆角 4（文字行）；'block' = 圆角 8（缩略图、卡片）；'round' = 圆 */
  shape?: 'text' | 'block' | 'round';
}>(), { width: '100%', height: undefined, shape: 'text' });
</script>

<template>
  <span class="pn-skeleton" :class="`pn-skeleton--${shape}`" :style="{ width, height }" aria-hidden="true" />
</template>

<style scoped>
.pn-skeleton {
  display: block;
  flex: none;
  height: var(--pn-size-skeleton-text);
  background: var(--pn-skeleton);
}

.pn-skeleton--text { border-radius: var(--pn-radius-xs); }
.pn-skeleton--block { border-radius: var(--pn-radius-md); }
.pn-skeleton--round { border-radius: 50%; }
</style>
