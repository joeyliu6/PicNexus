<script setup lang="ts">
/**
 * TimelinePhotoGrid - 图片网格组件
 * 渲染分组头部 + 虚拟滚动图片列表
 */
import TimelinePhotoItem from './TimelinePhotoItem.vue';
import type { ImageMeta } from '../../../types/image-meta';
import type { HistoryItem } from '../../../config/types';
import type { PhotoGroup } from '../../../composables/useVirtualTimeline';

export interface VisibleItem {
  meta: ImageMeta;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisibleHeader {
  groupId: string;
  label: string;
  y: number;
  height: number;
}

const props = defineProps<{
  groups: PhotoGroup[];
  visibleItems: VisibleItem[];
  visibleHeaders: VisibleHeader[];
  totalHeight: number;
  displayMode: 'fast' | 'smooth' | 'normal';
  selectedIds: Set<string>;
  favoriteIds: Set<string>;
  loadedImages: Set<string>;
  failedImages: Set<string>;
  hoverDetailsMap: Map<string, HistoryItem>;
  getThumbnailUrl: (meta: ImageMeta) => string;
}>();

const emit = defineEmits<{
  (e: 'item-click', meta: ImageMeta): void;
  (e: 'item-toggle-select', id: string): void;
  (e: 'item-toggle-favorite', id: string): void;
  (e: 'item-hover', meta: ImageMeta): void;
  (e: 'image-load', id: string): void;
  (e: 'image-error', event: Event, id: string): void;
}>();

function getGroupItemCount(groupId: string): number {
  const group = props.groups.find(g => g.id === groupId);
  return group?.items.length || 0;
}
</script>

<template>
  <div class="virtual-container" :style="{ height: `${totalHeight}px` }">
    <!-- Visible Group Headers -->
    <div
      v-for="header in visibleHeaders"
      :key="`header-${header.groupId}`"
      class="group-header"
      :style="{
        transform: `translate3d(0, ${header.y}px, 0)`,
        height: `${header.height}px`,
      }"
    >
      <span class="group-title">{{ header.label }}</span>
      <span class="group-subtitle">
        {{ getGroupItemCount(header.groupId) }} 张图片
      </span>
    </div>

    <!-- Photo Items -->
    <TimelinePhotoItem
      v-for="visible in visibleItems"
      :key="visible.meta.id"
      :meta="visible.meta"
      :x="visible.x"
      :y="visible.y"
      :width="visible.width"
      :height="visible.height"
      :is-selected="selectedIds.has(visible.meta.id)"
      :is-favorited="favoriteIds.has(visible.meta.id)"
      :is-loaded="loadedImages.has(visible.meta.id)"
      :is-failed="failedImages.has(visible.meta.id)"
      :display-mode="displayMode"
      :thumbnail-url="getThumbnailUrl(visible.meta)"
      :hover-detail="hoverDetailsMap.get(visible.meta.id)"
      @click="emit('item-click', visible.meta)"
      @toggle-select="emit('item-toggle-select', visible.meta.id)"
      @toggle-favorite="emit('item-toggle-favorite', visible.meta.id)"
      @hover="emit('item-hover', visible.meta)"
      @image-load="emit('image-load', visible.meta.id)"
      @image-error="emit('image-error', $event, visible.meta.id)"
    />

  </div>

  <!-- Footer slot - 位于虚拟容器外，避免绝对定位叠图 -->
  <div v-if="groups.length > 0" class="all-loaded">
    <slot name="footer"></slot>
  </div>
</template>

<style scoped>
.virtual-container {
  position: relative;
  width: 100%;
}

.group-header {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 10px 0;
  background: var(--bg-app);
  z-index: 5;
}

.group-title {
  font-size: var(--text-lg-xl);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
}

.group-subtitle {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.all-loaded {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  color: var(--text-secondary);
  font-size: var(--text-base);
}

/* 响应式适配 */
@media (width <= 1024px) {
  .group-title {
    font-size: var(--text-lg);
  }

  .group-subtitle {
    font-size: var(--text-xs);
  }
}

@media (width <= 768px) {
  .group-header {
    padding: 12px 0;
  }

  .group-title {
    font-size: var(--text-lg);
  }

  .group-subtitle {
    font-size: var(--text-2xs);
  }
}

@media (width <= 480px) {
  .group-title {
    font-size: var(--text-base);
  }

  .group-subtitle {
    display: none;
  }
}
</style>
