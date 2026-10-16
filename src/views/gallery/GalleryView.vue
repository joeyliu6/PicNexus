<script setup lang="ts">
// 图库（GalleryScreen.dc.html，交接说明 8.2）：按天分组的等高行网格 / 列表、筛选、多选、详情、灯箱、刻度条。
// 数据与虚拟滚动在 useGalleryGrid（复用时间轴那组 composables）；这里只做页面编排与键盘。
import { computed, nextTick, onActivated, onDeactivated, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { refDebounced, until, useElementSize, useEventListener } from '@vueuse/core';
import { getServiceDisplayName } from '@/constants/serviceNames';
import { useCopyLink } from '@/composables/useCopyLink';
import { useCopyBadgeFeedback } from '@/composables/useCopyBadgeFeedback';
import { useDebouncedTrue } from '@/composables/useDebouncedTrue';
import TitleRow from '@/shell/TitleRow.vue';
import { locateRequest, type LocateRequest } from '@/shell/galleryLocate';
import { useSidebarCollapse } from '@/shell/useSidebarCollapse';
import type { ImageMeta } from '@/types/image-meta';
import type { LinkFormat } from '@/utils/linkFormatter';
import GalleryChips from './GalleryChips.vue';
import GalleryDetail from './GalleryDetail.vue';
import GalleryEmpty, { type GalleryEmptyKind } from './GalleryEmpty.vue';
import GalleryGrid from './GalleryGrid.vue';
import GalleryLightbox from './GalleryLightbox.vue';
import GalleryList from './GalleryList.vue';
import GalleryScrubber from './GalleryScrubber.vue';
import GallerySelectionBar from './GallerySelectionBar.vue';
import GallerySkeleton from './GallerySkeleton.vue';
import GalleryToolbar, { type GalleryViewMode } from './GalleryToolbar.vue';
import { EMPTY_FILTERS, countText, filterChips, hasActiveFilters, toQueryFilter, type GalleryFilters } from './galleryFilters';
import { neighborTile, type GridDirection } from './gridNavigation';
import { scrubberTicks } from './scrubberTicks';
import { GALLERY_GRID, useGalleryGrid } from './useGalleryGrid';

const router = useRouter();
const { copyLinks } = useCopyLink();
const { narrow } = useSidebarCollapse();

/** KeepAlive 留着这一页：只在它显示时接键盘、加载数据 */
const active = ref(true);
onActivated(() => {
  active.value = true;
  // 收藏、各图床的张数（★ 角标、「图床」菜单、收藏为空都靠它）；内部有缓存，重复调用不重查
  void historyManager.loadStats();
});
onDeactivated(() => { active.value = false; });

const view = ref<GalleryViewMode>('grid');
const filters = ref<GalleryFilters>(EMPTY_FILTERS);
const search = refDebounced(computed(() => filters.value.search), 200);
const queryFilter = computed(() => toQueryFilter({ ...filters.value, search: search.value }));

const scroller = ref<HTMLElement | null>(null);
const mainEl = ref<HTMLElement | null>(null);
const toolbar = ref<InstanceType<typeof GalleryToolbar> | null>(null);
const grid = useGalleryGrid(scroller, queryFilter, computed(() => active.value && view.value === 'grid'));
const { viewState, historyManager } = grid;
const config = computed(() => grid.config.value);
const format = computed<LinkFormat>(() => config.value.linkOutput?.defaultFormat ?? 'url');

/** 「今天 / 昨天」按打开页面时算；跨午夜不刷新（下次打开就对了） */
const now = Date.now();

const hostName = (hostId: string) => getServiceDisplayName(hostId, config.value);
const hostOptions = computed(() => {
  const ids = new Set([...historyManager.serviceCounts.value.map((s) => s.id), ...(config.value.availableServices ?? [])]);
  return [...ids].map((id) => ({ id, name: hostName(id) }));
});

const chips = computed(() => filterChips(filters.value, hostName));
const count = computed(() => countText(filters.value, grid.totalCount.value, !grid.hasLoadedStats.value));

function setFilters(next: GalleryFilters): void {
  filters.value = next;
}

// 换了筛选，之前的选择不再对应眼前这些图
watch(queryFilter, () => viewState.clearSelection());

const emptyKind = computed<GalleryEmptyKind | null>(() => {
  if (!grid.hasLoadedStats.value || grid.totalCount.value > 0) return null;
  if (!hasActiveFilters(filters.value)) return 'empty';
  if (filters.value.favoritesOnly && historyManager.favoriteSet.value.size === 0) return 'favEmpty';
  return 'noResults';
});
/** 读得快就不闪骨架：超过 300ms 才出现（交接说明 8.2「冷启动」） */
const showSkeleton = useDebouncedTrue(computed(() => !grid.hasLoadedStats.value), 300);

// ---- 详情、焦点、复制 ----

const detailId = ref<string | null>(null);
const focusedId = ref<string | null>(null);
const { copiedKey, markCopied } = useCopyBadgeFeedback(1500);

function openDetail(meta: ImageMeta): void {
  detailId.value = meta.id;
  focusedId.value = meta.id;
}

function openLightbox(meta: ImageMeta): void {
  focusedId.value = meta.id;
  void grid.lightbox.openLightbox(meta);
}

/** 格子右下角「复制」= 复制这张图「复制时使用」的链接（当前格式），按钮原地变「已复制」 */
async function copyMeta(meta: ImageMeta): Promise<void> {
  if (!meta.primaryUrl) return;
  const result = await copyLinks([{ url: meta.primaryUrl, fileName: meta.localFileName, serviceId: meta.primaryService }], { format: format.value, showSuccessToast: false });
  if (result.ok) markCopied(meta.id);
}

function onRemoved(ids: readonly string[]): void {
  if (detailId.value && ids.includes(detailId.value)) detailId.value = null;
  if (focusedId.value && ids.includes(focusedId.value)) focusedId.value = null;
}

// ---- 刻度条 ----

const { height: mainHeight } = useElementSize(mainEl);
/** 刻度条上下各留 8，内边距 8 + 6 */
const ticks = computed(() => {
  const top = grid.virtual.visibleHeaders.value[0]?.groupId;
  const group = grid.groups.value.find((g) => g.id === top);
  return scrubberTicks(grid.months.value, Math.max(0, mainHeight.value - 30), group ? { year: group.year, month: group.month } : null);
});

function jump(year: number, month: number | undefined): void {
  void (month === undefined ? grid.jump.handleJumpToYear(year) : grid.jump.handleJumpToPeriod(year, month));
}

/** 鼠标靠近图片右缘时浮出刻度条（不另放一块挡住图片的感应区） */
const EDGE_ZONE = 64;
let nearEdge = false;
function onMainPointer(event: PointerEvent): void {
  const rect = mainEl.value?.getBoundingClientRect();
  const near = !!rect && event.type === 'pointermove' && rect.right - event.clientX < EDGE_ZONE;
  if (near === nearEdge) return;
  nearEdge = near;
  if (near) grid.scrubber.onSidebarEnter();
  else grid.scrubber.onSidebarLeave();
}

// ---- 键盘（交接说明 3.4 / 8.2）----

const ARROWS: Record<string, GridDirection> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const focusedMeta = computed(() => grid.allLoadedMetas.value.find((m) => m.id === focusedId.value) ?? null);

function isTextTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/** 方向键走到视口外的那张才滚动，只滚到刚好露出（吸顶的日期标题会盖住顶上 40） */
function reveal(id: string): void {
  const position = grid.virtual.layoutResult.value?.itemPositionMap.get(id);
  const el = scroller.value;
  if (!position || !el) return;
  const top = position.y - GALLERY_GRID.headerHeight;
  const bottom = position.y + position.height + GALLERY_GRID.gap;
  if (top < el.scrollTop) el.scrollTo({ top, behavior: 'smooth' });
  else if (bottom > el.scrollTop + el.clientHeight) el.scrollTo({ top: bottom - el.clientHeight, behavior: 'smooth' });
}

/**
 * 「在图库中定位」：回到网格、去掉会把它筛掉的条件，等统计按新条件读完，
 * 跳到那一天，选中它并打开详情
 */
async function locate({ id, timestamp }: LocateRequest): Promise<void> {
  view.value = 'grid';
  viewState.clearSelection();
  focusedId.value = id;
  detailId.value = id;
  if (hasActiveFilters(filters.value)) {
    filters.value = EMPTY_FILTERS;
    // 搜索词有 200ms 防抖：等它也清空，免得按旧搜索词读完一轮又重读
    await until(search).toBe('');
    await nextTick();
  }
  await until(() => grid.hasLoadedStats.value && !grid.isLoadingStats.value).toBe(true);
  const day = new Date(timestamp);
  await grid.jump.handleJumpToPeriod(day.getFullYear(), day.getMonth(), day.getDate());
  reveal(id);
}

watch([locateRequest, active], ([request, isActive]) => {
  if (!request || !isActive) return;
  locateRequest.value = null;
  void locate(request);
}, { immediate: true });

function moveFocus(direction: GridDirection): void {
  const next = neighborTile(grid.virtual.layoutResult.value?.allRows ?? [], focusedId.value, direction);
  if (!next || next === focusedId.value) return;
  focusedId.value = next;
  if (detailId.value) detailId.value = next;
  reveal(next);
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (!active.value || event.defaultPrevented) return;
  // 对话框、命令面板、灯箱开着时各管各的键
  if (document.querySelector('.pn-dialog[data-state="open"], .command-palette[data-state="open"], .pswp--open')) return;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (mod && key === 'f') {
    event.preventDefault();
    toolbar.value?.focusSearch();
    return;
  }
  if (isTextTarget(event.target)) return;
  if (event.key === 'Escape') {
    if (viewState.hasSelection.value) viewState.clearSelection();
    else if (detailId.value) detailId.value = null;
    return;
  }
  if (mod && key === 'a') {
    event.preventDefault();
    grid.selectAllLoaded();
    return;
  }
  if (view.value !== 'grid') return;
  const direction = ARROWS[event.key];
  if (direction) {
    event.preventDefault();
    moveFocus(direction);
  } else if (event.key === ' ' && focusedMeta.value) {
    event.preventDefault();
    openLightbox(focusedMeta.value);
  } else if (event.key === 'Enter' && focusedMeta.value) {
    openDetail(focusedMeta.value);
  }
});
</script>

<template>
  <div class="gallery">
    <TitleRow title="图库" />
    <GalleryToolbar
      ref="toolbar"
      v-model:view="view"
      :filters="filters"
      :hosts="hostOptions"
      :count="count"
      :narrow="narrow"
      @update:filters="setFilters"
    />
    <GalleryChips v-if="chips.length" :chips="chips" :filters="filters" @update:filters="setFilters" />

    <div class="gallery__body">
      <div ref="mainEl" class="gallery__main" @pointermove="onMainPointer" @pointerleave="onMainPointer">
        <div v-show="view === 'grid' && !emptyKind" ref="scroller" class="gallery__scroll" @scroll="grid.onScroll">
          <GalleryGrid
            :grid="grid"
            :focused-id="focusedId"
            :copied-id="copiedKey"
            :now="now"
            @open="openDetail"
            @open-lightbox="openLightbox"
            @copy="copyMeta"
          />
        </div>
        <GalleryList
          v-if="view === 'list' && !emptyKind"
          :filter="queryFilter"
          :grid="grid"
          :focused-id="focusedId"
          :copied-id="copiedKey"
          @open="openDetail"
          @open-lightbox="openLightbox"
          @copy="copyMeta"
          @removed="onRemoved"
        />
        <GalleryEmpty v-if="emptyKind" :kind="emptyKind" @go-home="router.push('/home')" @clear-filters="setFilters(EMPTY_FILTERS)" />
        <GallerySkeleton v-if="showSkeleton && !grid.hasLoadedStats.value" class="gallery__overlay" />
        <GalleryScrubber
          v-if="view === 'grid' && !emptyKind && grid.hasLoadedStats.value"
          :ticks="ticks"
          :visible="grid.scrubber.isSidebarVisible.value"
          @jump="jump"
        />
        <GallerySelectionBar v-if="viewState.hasSelection.value" :grid="grid" :format="format" @removed="onRemoved" />
      </div>
      <GalleryDetail v-if="detailId" :key="detailId" :item-id="detailId" :grid="grid" :format="format" @close="detailId = null" @open-lightbox="openLightbox" @removed="onRemoved" />
    </div>

    <GalleryLightbox :grid="grid" :format="format" @removed="onRemoved" @show-info="(id: string) => { detailId = id; focusedId = id; }" />
  </div>
</template>

<style scoped>
.gallery {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
}

.gallery__body {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}

.gallery__main {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.gallery__scroll {
  flex: 1;
  min-width: 0;
  padding: var(--pn-space-4) var(--pn-space-24) 0;
  overflow: hidden auto;
  scrollbar-width: none;
}

.gallery__scroll::-webkit-scrollbar { display: none; }

.gallery__overlay {
  position: absolute;
  inset: 0;
  background: var(--pn-canvas);
}
</style>
