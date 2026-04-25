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
    <!-- 分组头部占位：与 .group-header 同构（date + dashed divider + count） -->
    <div
      v-for="group in layout.groups"
      :key="`skeleton-header-${group.id}`"
      class="skeleton-header"
      :style="{ transform: `translate3d(0, ${group.headerY}px, 0)` }"
    >
      <div class="skeleton-date">
        <Skeleton width="86px" height="30px" borderRadius="4px" />
        <Skeleton width="36px" height="14px" borderRadius="4px" />
      </div>
      <div class="skeleton-divider" aria-hidden="true"></div>
      <div class="skeleton-count">
        <!-- 单胶囊代表「图标 13 张」整体，宽度模拟 icon+num+unit 自然簇 -->
        <Skeleton width="68px" height="20px" borderRadius="var(--radius-full)" />
      </div>
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
  align-items: center;
  gap: var(--space-md-lg);
  padding: var(--space-sm-md) 0;
  height: 48px;
}

.skeleton-date {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  flex-shrink: 0;
}

/* 与 .group-divider 完全同构（dashed 1px + 8px 周期 + 两端淡出 mask） */
.skeleton-divider {
  flex: 1 1 auto;
  height: 1px;
  min-width: var(--space-lg);
  background-image: linear-gradient(
    to right,
    var(--border-subtle) 0,
    var(--border-subtle) 4px,
    transparent 4px,
    transparent 8px
  );
  background-size: 8px 1px;
  background-repeat: repeat-x;
  mask-image: linear-gradient(
    to right,
    transparent 0,
    #000 16px,
    #000 calc(100% - 16px),
    transparent 100%
  );
}

.skeleton-count {
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  flex-shrink: 0;
}

.skeleton-photo {
  position: absolute;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  overflow: hidden;
}

/* 与真实 header 的响应式断点保持一致 */
@media (width <= 480px) {
  .skeleton-date :nth-child(2),
  .skeleton-divider {
    display: none;
  }
}
</style>
