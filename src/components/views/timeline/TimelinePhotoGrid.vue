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
  loadedImages: Set<string>;
  hoverDetailsMap: Map<string, HistoryItem>;
  getThumbnailUrl: (meta: ImageMeta) => string;
}>();

const emit = defineEmits<{
  (e: 'item-click', meta: ImageMeta): void;
  (e: 'item-toggle-select', id: string): void;
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
        {{ getGroupItemCount(header.groupId) }} 张照片
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
      :is-loaded="loadedImages.has(visible.meta.id)"
      :display-mode="displayMode"
      :thumbnail-url="getThumbnailUrl(visible.meta)"
      :hover-detail="hoverDetailsMap.get(visible.meta.id)"
      @click="emit('item-click', visible.meta)"
      @toggle-select="emit('item-toggle-select', visible.meta.id)"
      @hover="emit('item-hover', visible.meta)"
      @image-load="emit('image-load', visible.meta.id)"
      @image-error="emit('image-error', $event, visible.meta.id)"
    />

    <!-- All Loaded Indicator -->
    <div
      v-if="groups.length > 0"
      class="all-loaded"
      :style="{ transform: `translate3d(0, ${totalHeight - 40}px, 0)` }"
    >
      <slot name="footer"></slot>
    </div>
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
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.group-subtitle {
  font-size: 12px;
  color: var(--text-secondary);
}

.all-loaded {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  color: var(--text-secondary);
  font-size: 14px;
}

/* 响应式适配 */
@media (max-width: 1024px) {
  .group-title {
    font-size: 16px;
  }

  .group-subtitle {
    font-size: 11px;
  }
}

@media (max-width: 768px) {
  .group-header {
    padding: 12px 0;
  }

  .group-title {
    font-size: 15px;
  }

  .group-subtitle {
    font-size: 10px;
  }
}

@media (max-width: 480px) {
  .group-title {
    font-size: 14px;
  }

  .group-subtitle {
    display: none;
  }
}
</style>
