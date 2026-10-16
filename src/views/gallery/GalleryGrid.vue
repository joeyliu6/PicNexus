<script setup lang="ts">
// 图库网格（GalleryScreen.dc.html）：按天分组、等高行、宽度按原比例；日期标题滚动时吸顶。
// 只负责画：布局、加载、选择状态都来自 useGalleryGrid（由页面创建，滚动容器也在页面上）。
import { computed } from 'vue';
import type { ImageMeta } from '@/types/image-meta';
import { formatDayHeading } from '@/utils/formatters';
import GalleryTile from './GalleryTile.vue';
import { GALLERY_GRID, type GalleryGridApi } from './useGalleryGrid';

const props = defineProps<{
  grid: GalleryGridApi;
  /** 详情打开的那张 / 键盘焦点所在 */
  focusedId: string | null;
  /** 刚点了「复制」的那张：按钮原地显示「已复制」 */
  copiedId: string | null;
  now: number;
}>();

const emit = defineEmits<{
  open: [meta: ImageMeta];
  openLightbox: [meta: ImageMeta];
  copy: [meta: ImageMeta];
}>();

const { virtual, viewState, historyManager } = props.grid;
const visibleItems = virtual.visibleItems;
const visibleHeaders = virtual.visibleHeaders;
const visibleSkeletonSlots = virtual.visibleSkeletonSlots;
const fastModeItems = virtual.fastModeItems;
const displayMode = virtual.displayMode;
const totalHeight = virtual.totalHeight;

const groupById = computed(() => new Map(props.grid.groups.value.map((g) => [g.id, g])));

function heading(groupId: string): { title: string; sub: string } {
  const group = groupById.value.get(groupId);
  return group ? formatDayHeading(group.year, group.month, group.day, props.now) : { title: '', sub: '' };
}

/** 吸顶的日期标题：当前所在那天的标题已经滚出顶部时出现；下一天的标题顶上来时被推走 */
const sticky = computed(() => {
  const layouts = virtual.layoutResult.value?.groupLayouts;
  if (!layouts?.length) return null;
  const top = virtual.scrollTop.value;
  let lo = 0;
  let hi = layouts.length - 1;
  let index = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (layouts[mid].headerY <= top) { index = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (index < 0 || top <= layouts[index].headerY) return null;
  const next = layouts[index + 1];
  const offset = next ? Math.min(0, next.headerY - top - GALLERY_GRID.headerHeight) : 0;
  return { groupId: layouts[index].groupId, offset };
});

const selectedIds = computed(() => new Set(viewState.selectedIdList.value));
const selecting = computed(() => viewState.hasSelection.value);
</script>

<template>
  <div class="grid" role="grid" aria-label="图片" :style="{ height: `${totalHeight}px` }">
    <div v-if="sticky" class="grid__sticky" aria-hidden="true">
      <div class="grid__day grid__day--sticky" :style="{ transform: `translateY(${sticky.offset}px)` }">
        <span class="grid__day-title">{{ heading(sticky.groupId).title }}</span>
        <span class="grid__day-sub">{{ heading(sticky.groupId).sub }}</span>
      </div>
    </div>

    <div
      v-for="header in visibleHeaders"
      v-show="sticky?.groupId !== header.groupId"
      :key="`day-${header.groupId}`"
      class="grid__day"
      role="row"
      :style="{ transform: `translate3d(0, ${header.y}px, 0)` }"
    >
      <span class="grid__day-title" role="rowheader">{{ heading(header.groupId).title }}</span>
      <span class="grid__day-sub">{{ heading(header.groupId).sub }}</span>
    </div>

    <div
      v-for="(slot, index) in displayMode === 'fast' ? fastModeItems : []"
      :key="`fast-${index}`"
      class="grid__slot"
      :style="{ transform: `translate3d(${slot.x}px, ${slot.y}px, 0)`, width: `${slot.width}px`, height: `${slot.height}px` }"
    />
    <div
      v-for="slot in visibleSkeletonSlots"
      :key="`slot-${slot.key}`"
      class="grid__slot"
      :style="{ transform: `translate3d(${slot.x}px, ${slot.y}px, 0)`, width: `${slot.width}px`, height: `${slot.height}px` }"
    />

    <GalleryTile
      v-for="item in visibleItems"
      :key="item.meta.id"
      :meta="item.meta"
      :x="item.x"
      :y="item.y"
      :width="item.width"
      :height="item.height"
      :selected="selectedIds.has(item.meta.id)"
      :favorited="historyManager.favoriteSet.value.has(item.meta.id)"
      :selecting="selecting"
      :focused="focusedId === item.meta.id"
      :copied="copiedId === item.meta.id"
      :loaded="grid.loadedImages.value.has(item.meta.id)"
      :failed="grid.failedImages.value.has(item.meta.id)"
      :display-mode="displayMode"
      :thumbnail-urls="grid.getThumbnailUrls(item.meta)"
      :confirmed-http-hosts="grid.confirmedHttpHosts.value"
      @open="emit('open', item.meta)"
      @open-lightbox="emit('openLightbox', item.meta)"
      @toggle-select="(event: MouseEvent) => grid.toggleSelect(item.meta.id, event)"
      @toggle-favorite="grid.toggleFavorite(item.meta.id)"
      @copy="emit('copy', item.meta)"
      @image-load="grid.onImageLoad(item.meta.id)"
      @image-error="(event?: Event) => grid.onImageError(event, item.meta.id)"
    />
  </div>
</template>

<style scoped>
.grid {
  position: relative;
  width: 100%;
}

.grid__sticky {
  position: sticky;
  top: 0;
  z-index: 3;
  height: 0;
  overflow: visible;
}

.grid__day {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: baseline;
  gap: var(--pn-space-8);
  height: var(--pn-size-day-heading);
  padding-top: var(--pn-space-6);
  box-sizing: border-box;
}

.grid__day--sticky {
  right: 0;
  height: var(--pn-size-day-heading-sticky);
  background: var(--pn-canvas);
}

.grid__day-title {
  font-size: var(--pn-text-headline);
  font-weight: var(--pn-weight-semibold);
  letter-spacing: var(--pn-tracking-headline);
}

.grid__day-sub {
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
}

.grid__slot {
  position: absolute;
  top: 0;
  left: 0;
  border-radius: var(--pn-radius-md);
  background: var(--pn-skeleton);
}
</style>
