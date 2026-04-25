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
  getThumbnailUrls: (meta: ImageMeta) => string[];
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

const groupMetaMap = computed(() => {
  const m = new Map<string, PhotoGroup>();
  for (const g of props.groups) m.set(g.id, g);
  return m;
});

function getGroupItemCount(groupId: string): number {
  return groupCountMap.value.get(groupId) ?? 0;
}

// MM.DD 形式：月/日补零，纵向叠多组时和 tabular-nums 配合实现整齐对齐
function formatGroupDate(groupId: string): string {
  const g = groupMetaMap.value.get(groupId);
  if (!g) return '';
  const mm = String(g.month + 1).padStart(2, '0');
  const dd = String(g.day).padStart(2, '0');
  return `${mm}.${dd}`;
}

function getGroupYear(groupId: string): string {
  const y = groupMetaMap.value.get(groupId)?.year;
  return y == null ? '' : String(y);
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
      <div class="group-date">
        <span class="group-date-num">{{ formatGroupDate(header.groupId) }}</span>
        <span class="group-date-year">{{ getGroupYear(header.groupId) }}</span>
      </div>
      <div class="group-divider" aria-hidden="true"></div>
      <div class="group-count">
        <i class="pi pi-image group-count-icon" aria-hidden="true"></i>
        <span class="group-count-num">{{ getGroupItemCount(header.groupId) }}</span>
        <span class="group-count-unit">张</span>
      </div>
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
      :thumbnail-urls="getThumbnailUrls(visible.meta)"
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
  align-items: center;
  gap: var(--space-md-lg);
  padding: var(--space-sm-md) 0;
  background: var(--bg-app);
  z-index: 5;
}

.group-date {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  flex-shrink: 0;
}

/* dashed 虚线：1px 间隔的破折号，仿日记本/胶片孔的低调质感
 * - 用 background-image 而非 border-style: dashed，浏览器对 dash 长度/间隔的渲染更可控
 * - mask 让两端轻微淡出，避免硬切日期/计数文字 */
.group-divider {
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

.group-count {
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  flex-shrink: 0;
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

.group-date-num {
  font-size: var(--text-3xl);
  font-weight: var(--weight-semibold);
  line-height: 1;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.group-date-year {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.group-count-icon {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}

.group-count-num {
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.group-count-unit {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
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
  .group-date-num {
    font-size: var(--text-2xl);
  }
}

@media (width <= 768px) {
  .group-header {
    padding: var(--space-md) 0;
  }

  .group-date-num {
    font-size: var(--text-xl);
  }
}

@media (width <= 480px) {
  .group-date-num {
    font-size: var(--text-lg);
  }

  .group-date-year,
  .group-divider {
    display: none;
  }
}
</style>
