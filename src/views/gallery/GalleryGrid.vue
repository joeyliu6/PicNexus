<script setup lang="ts">
// 图库网格（GalleryScreen.dc.html）：按天分组、等高行、宽度按原比例；日期标题滚动时吸顶。
// 只负责画：布局、加载、选择状态都来自 useGalleryGrid（由页面创建，滚动容器也在页面上）。
// 读屏：格子按位置绝对定位、都是网格的直接子元素（重排时不重建）；每行用一个空的 row 以 aria-owns 认领它的格子，
// 日期标题也是一行，按位置先后与图片行交错排。Tab 只停在一格上（详情 / 焦点那张，没有就是视口里第一张），其余用方向键走。
import { computed, nextTick, ref, watch } from 'vue';
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
  /** 「上传到」勾了 2 个及以上图床：格子才标「仅 1 份」 */
  backupsExpected: boolean;
}>();

const emit = defineEmits<{
  open: [meta: ImageMeta];
  openLightbox: [meta: ImageMeta];
  copy: [meta: ImageMeta];
  /** 键盘把焦点移到了这一格 */
  focus: [meta: ImageMeta];
}>();

const { virtual, viewState, historyManager } = props.grid;
const visibleItems = virtual.visibleItems;
const visibleHeaders = virtual.visibleHeaders;
const visibleSkeletonSlots = virtual.visibleSkeletonSlots;
const fastModeItems = virtual.fastModeItems;
const displayMode = virtual.displayMode;
const totalHeight = virtual.totalHeight;

/** 日期标题按算出眼前这份布局的分组写（与格子同一份，新布局换上之前不会出现没有字的标题） */
const groupById = computed(() => new Map(virtual.layoutGroups.value.map((g) => [g.id, g])));

function heading(groupId: string): { title: string; sub: string } {
  const group = groupById.value.get(groupId);
  if (!group) return { title: '', sub: '' };
  return group.heading ?? formatDayHeading(group.year, group.month, group.day, props.now);
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

/** 读屏的行：日期标题与图片行按位置交错（图片行只认领格子，不改它们在页面里的位置） */
type Line = { kind: 'day'; key: string; groupId: string; y: number } | { kind: 'row'; key: string; y: number; owns: string };
const lines = computed<Line[]>(() => {
  const rows = new Map<string, { y: number; ids: string[] }>();
  for (const item of visibleItems.value) {
    const key = `${item.groupId}:${item.y}`;
    const row = rows.get(key);
    if (row) row.ids.push(`tile-${item.meta.id}`);
    else rows.set(key, { y: item.y, ids: [`tile-${item.meta.id}`] });
  }
  return [
    ...visibleHeaders.value.map((header): Line => ({ kind: 'day', key: `day-${header.groupId}`, groupId: header.groupId, y: header.y })),
    ...[...rows].map(([key, row]): Line => ({ kind: 'row', key: `row-${key}`, y: row.y, owns: row.ids.join(' ') })),
  ].sort((a, b) => a.y - b.y);
});

/** Tab 停在哪一格：焦点那张在屏上就是它，否则视口里第一张 */
const tabStopId = computed(() => {
  const items = visibleItems.value;
  if (props.focusedId && items.some((item) => item.meta.id === props.focusedId)) return props.focusedId;
  const top = virtual.scrollTop.value;
  return (items.find((item) => item.y + item.height > top) ?? items[0])?.meta.id ?? null;
});

// 方向键走到的那格可能还没画出来（刚滚过去）：记下来，等它出现再把焦点给它
const root = ref<HTMLElement | null>(null);
let pendingFocus: string | null = null;
function applyPendingFocus(): void {
  if (!pendingFocus) return;
  const el = root.value?.querySelector<HTMLElement>(`[id="tile-${CSS.escape(pendingFocus)}"]`);
  if (!el) return;
  pendingFocus = null;
  el.focus({ preventScroll: true });
}
watch(visibleItems, () => void nextTick(applyPendingFocus));

/** 把键盘焦点移到这一格（滚动由页面负责） */
function focusTile(id: string): void {
  pendingFocus = id;
  void nextTick(applyPendingFocus);
}

/** 焦点在网格里（或没有落在任何控件上）：方向键移动时焦点跟着走 */
function ownsFocus(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !!root.value?.contains(active);
}

defineExpose({ focusTile, ownsFocus });
</script>

<template>
  <div ref="root" class="grid" role="grid" aria-label="图片" aria-multiselectable="true" :style="{ height: `${totalHeight}px` }">
    <div v-if="sticky" class="grid__sticky" aria-hidden="true">
      <div class="grid__day grid__day--sticky" :style="{ transform: `translateY(${sticky.offset}px)` }">
        <span class="grid__day-title">{{ heading(sticky.groupId).title }}</span>
        <span class="grid__day-sub">{{ heading(sticky.groupId).sub }}</span>
      </div>
    </div>

    <template v-for="line in lines" :key="line.key">
      <div
        v-if="line.kind === 'day'"
        class="grid__day"
        :class="{ 'grid__day--covered': sticky?.groupId === line.groupId }"
        role="row"
        :style="{ transform: `translate3d(0, ${line.y}px, 0)` }"
      >
        <span class="grid__day-title" role="rowheader">{{ heading(line.groupId).title }}</span>
        <span class="grid__day-sub">{{ heading(line.groupId).sub }}</span>
      </div>
      <div v-else role="row" :aria-owns="line.owns" />
    </template>

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
      :tabbable="tabStopId === item.meta.id"
      :copied="copiedId === item.meta.id"
      :loaded="grid.loadedImages.value.has(item.meta.id)"
      :failed="grid.failedImages.value.has(item.meta.id)"
      :display-mode="displayMode"
      :thumbnail-urls="grid.getThumbnailUrls(item.meta)"
      :confirmed-http-hosts="grid.confirmedHttpHosts.value"
      :backups-expected="backupsExpected"
      @open="emit('open', item.meta)"
      @open-lightbox="emit('openLightbox', item.meta)"
      @toggle-select="(event: MouseEvent) => grid.toggleSelect(item.meta.id, event)"
      @toggle-favorite="grid.toggleFavorite(item.meta.id)"
      @copy="emit('copy', item.meta)"
      @keyboard-focus="emit('focus', item.meta)"
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

/* 被吸顶条盖住的那天：藏起来但留给读屏（吸顶条本身对读屏隐藏） */
.grid__day--covered { opacity: 0; }

.grid__day--sticky {
  right: 0;
  height: var(--pn-size-day-heading-sticky);
  background: var(--pn-canvas);
}

/* 滚动区上边留了 4 的内边距，吸顶条贴在它下面：把底色往上补 4，滚过去的图不从缝里露出来 */
.grid__day--sticky::before {
  position: absolute;
  right: 0;
  bottom: 100%;
  left: 0;
  height: var(--pn-space-4);
  background: var(--pn-canvas);
  content: '';
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
