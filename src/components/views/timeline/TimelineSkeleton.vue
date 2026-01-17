<script setup lang="ts">
/**
 * TimelineSkeleton - 时间轴骨架屏组件
 * 使用 Justified Layout 算法确保与实际内容布局一致
 */
import Skeleton from 'primevue/skeleton';
import type { SkeletonLayoutResult } from '../../../utils/justifiedLayout';

defineProps<{
  layout: SkeletonLayoutResult;
}>();
</script>

<template>
  <div class="skeleton-container" :style="{ height: `${layout.totalHeight}px` }">
    <!-- 分组头部占位 -->
    <div
      v-for="group in layout.groups"
      :key="`skeleton-header-${group.id}`"
      class="skeleton-header"
      :style="{ transform: `translate3d(0, ${group.headerY}px, 0)` }"
    >
      <Skeleton width="140px" height="24px" />
      <Skeleton width="70px" height="16px" />
    </div>

    <!-- 图片占位 -->
    <div
      v-for="(item, index) in layout.items"
      :key="`skeleton-item-${index}`"
      class="skeleton-photo"
      :style="{
        transform: `translate3d(${item.x}px, ${item.y}px, 0)`,
        width: `${item.width}px`,
        height: `${item.height}px`,
      }"
    >
      <Skeleton width="100%" height="100%" borderRadius="8px" />
    </div>
  </div>
</template>

<style scoped>
.skeleton-container {
  position: relative;
  width: 100%;
}

.skeleton-header {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 10px 0;
  height: 48px;
}

.skeleton-photo {
  position: absolute;
  background: var(--bg-secondary);
  border-radius: 8px;
  overflow: hidden;
}
</style>
