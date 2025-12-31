<script setup lang="ts">
/**
 * 墓碑占位符组件
 * 在图片加载完成前显示，提供视觉反馈
 * 支持 shimmer 动画效果
 */

defineProps<{
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
  /** x 坐标 */
  x: number;
  /** y 坐标 */
  y: number;
  /** 是否显示 shimmer 动画 */
  shimmer?: boolean;
}>();
</script>

<template>
  <div
    class="tombstone"
    :style="{
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate3d(${x}px, ${y}px, 0)`,
    }"
  >
    <div v-if="shimmer" class="tombstone-shimmer"></div>
  </div>
</template>

<style scoped>
.tombstone {
  position: absolute;
  background: var(--surface-ground, #1e1e1e);
  border-radius: 8px;
  overflow: hidden;
  will-change: transform;
}

.tombstone-shimmer {
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.08) 50%,
    transparent 100%
  );
  animation: shimmer 1.5s ease-in-out infinite;
}

@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

/* 深色模式适配 */
:root[data-theme='dark'] .tombstone,
.dark .tombstone {
  background: var(--surface-ground, #1a1a2e);
}
</style>
