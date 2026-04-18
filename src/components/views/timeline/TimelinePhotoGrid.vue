<script setup lang="ts">
/**
 * TimelinePhotoGrid - 图片网格组件
 * 渲染分组头部 + 虚拟滚动图片列表
 */
import { computed } from 'vue';
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

export interface FastModeItem {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SkeletonSlot {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const props = defineProps<{
  groups: PhotoGroup[];
  visibleItems: VisibleItem[];
  visibleSkeletonSlots: SkeletonSlot[];
  visibleHeaders: VisibleHeader[];
  fastModeItems: FastModeItem[];
  totalHeight: number;
  displayMode: 'fast' | 'smooth' | 'normal';
  selectedIds: Set<string>;
  favoriteIds: Set<string>;
  hasSelection: boolean;
  loadedImages: Set<string>;
  failedImages: Set<string>;
  hoverDetailsMap: Map<string, HistoryItem>;
  getThumbnailUrl: (meta: ImageMeta) => string;
}>();

const emit = defineEmits<{
  (e: 'item-click', meta: ImageMeta): void;
  (e: 'item-toggle-select', id: string, event: MouseEvent): void;
  (e: 'item-toggle-favorite', id: string): void;
  (e: 'item-hover', meta: ImageMeta): void;
  (e: 'image-load', id: string): void;
  (e: 'image-error', event: Event, id: string): void;
}>();

// skeleton 天显示 expectedCount，避免"先 0 再真数"的跳变；避免每次 render 线性查找
const groupCountMap = computed(() => {
  const m = new Map<string, number>();
  for (const g of props.groups) {
    m.set(g.id, g.isSkeleton ? (g.expectedCount ?? g.items.length) : g.items.length);
  }
  return m;
});

function getGroupItemCount(groupId: string): number {
  return groupCountMap.value.get(groupId) ?? 0;
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

    <!-- Fast Mode Placeholders -->
    <div
      v-for="(item, index) in displayMode === 'fast' ? fastModeItems : []"
      :key="`fast-mode-${index}`"
      class="fast-mode-item"
      :style="{
        transform: `translate3d(${item.x}px, ${item.y}px, 0)`,
        width: `${item.width}px`,
        height: `${item.height}px`,
      }"
    />

    <!-- Skeleton Slots: 未加载天的灰色占位（count × 估算宽高），避免 items=[] 时整片空白 -->
    <div
      v-for="slot in visibleSkeletonSlots"
      :key="`slot-${slot.key}`"
      class="photo-slot-skeleton"
      :style="{
        transform: `translate3d(${slot.x}px, ${slot.y}px, 0)`,
        width: `${slot.width}px`,
        height: `${slot.height}px`,
      }"
    />

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
      :has-selection="hasSelection"
      :is-loaded="loadedImages.has(visible.meta.id)"
      :is-failed="failedImages.has(visible.meta.id)"
      :display-mode="displayMode"
      :thumbnail-url="getThumbnailUrl(visible.meta)"
      @click="emit('item-click', visible.meta)"
      @toggle-select="(event: MouseEvent) => emit('item-toggle-select', visible.meta.id, event)"
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
  gap: var(--space-md);
  padding: var(--space-sm-md) 0;
  background: var(--bg-app);
  z-index: 5;
}

.fast-mode-item {
  position: absolute;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  overflow: hidden;
}

/* 未加载天的占位：与 photo-item 的 photo-skeleton 同底色，视觉语义一致 */
.photo-slot-skeleton {
  position: absolute;
  background: var(--bg-titlebar);
  border-radius: var(--radius-md);
  will-change: transform;
}

.group-title {
  font-size: var(--text-lg-xl);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
}

.group-subtitle {
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
}

.all-loaded {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  padding: var(--space-lg-xl);
  color: var(--text-secondary);
  font-size: var(--text-base);
}

/* 响应式适配 */
@media (width <= 1024px) {
  .group-title {
    font-size: var(--text-lg);
  }

  .group-subtitle {
    font-size: var(--text-2xs);
  }
}

@media (width <= 768px) {
  .group-header {
    padding: var(--space-md) 0;
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
