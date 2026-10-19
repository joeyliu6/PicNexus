<script setup lang="ts">
// 图库（GalleryScreen.dc.html，交接说明 8.2）：按天分组（只筛「失效」时按有没有可用备份分两组）的等高行网格 / 列表、筛选、多选、详情、灯箱、刻度条。
// 数据与虚拟滚动在 useGalleryGrid（复用时间轴那组 composables）；这里只做页面编排与键盘。
import { computed, nextTick, onActivated, onDeactivated, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { refDebounced, until, useElementSize, useEventListener } from '@vueuse/core';
import { getServiceDisplayName } from '@/constants/serviceNames';
import { useCopyLink } from '@/composables/useCopyLink';
import { useCopyBadgeFeedback } from '@/composables/useCopyBadgeFeedback';
import { useToast } from '@/composables/useToast';
import { useDebouncedTrue } from '@/composables/useDebouncedTrue';
import TitleRow from '@/shell/TitleRow.vue';
import { locateRequest, type LocateRequest } from '@/shell/galleryLocate';
import { useSidebarCollapse } from '@/shell/useSidebarCollapse';
import type { GalleryListSort } from '@/services/database/TimelineQueryService';
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
import { useGalleryLightbox } from './useGalleryLightbox';
import { useGalleryList } from './useGalleryList';
import { useListLightbox } from './useListLightbox';

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
/** 真正交给查询的那份筛选（搜索词按防抖后的算）：空状态与计数照它判断，才和统计对得上 */
const appliedFilters = computed<GalleryFilters>(() => ({ ...filters.value, search: search.value }));
const queryFilter = computed(() => toQueryFilter(appliedFilters.value));

const scroller = ref<HTMLElement | null>(null);
const mainEl = ref<HTMLElement | null>(null);
const toolbar = ref<InstanceType<typeof GalleryToolbar> | null>(null);
const gridView = ref<InstanceType<typeof GalleryGrid> | null>(null);
const grid = useGalleryGrid(scroller, queryFilter, computed(() => active.value && view.value === 'grid'));
const { viewState, historyManager } = grid;

/** 列表视图的数据与排序：放在页面上，切回网格再回来排序还在，列表里打开的灯箱也按它翻页 */
const listSort = ref<GalleryListSort>({ key: 'time', descending: true });
const list = useGalleryList(queryFilter, listSort);
const lightbox = useGalleryLightbox(grid, useListLightbox({
  list,
  total: grid.totalCount,
  detailCache: historyManager.detailCache,
  config: grid.config,
  confirmedHttpHosts: () => grid.confirmedHttpHosts.value,
  toast: useToast(),
}));
const config = computed(() => grid.config.value);
const format = computed<LinkFormat>(() => config.value.linkOutput?.defaultFormat ?? 'url');

/**
 * 「今天 / 昨天」按这个时刻算。外壳的 KeepAlive 让这一页一直不重建：
 * 页面重新显示时、以及每过一个午夜都刷新一次
 */
const now = ref(Date.now());
let midnightTimer: ReturnType<typeof setTimeout> | undefined;
function refreshNow(): void {
  now.value = Date.now();
  clearTimeout(midnightTimer);
  const nextDay = new Date(now.value);
  nextDay.setHours(24, 0, 1, 0);
  midnightTimer = setTimeout(refreshNow, nextDay.getTime() - now.value);
}
refreshNow();
onActivated(refreshNow);
onDeactivated(() => clearTimeout(midnightTimer));
onUnmounted(() => clearTimeout(midnightTimer));

const hostName = (hostId: string) => getServiceDisplayName(hostId, config.value);
const hostOptions = computed(() => {
  const ids = new Set([...historyManager.serviceCounts.value.map((s) => s.id), ...(config.value.availableServices ?? [])]);
  return [...ids].map((id) => ({ id, name: hostName(id) }));
});

const chips = computed(() => filterChips(filters.value, hostName));
/** 新条件的统计还没回来：计数与空状态沿用上一次的判断，不闪中间态（如「共 0 张」「暂无图片」） */
const reloading = computed(() => grid.hasLoadedStats.value && grid.isLoadingStats.value);
const count = computed<string>((previous) => (reloading.value && previous !== undefined
  ? previous
  : countText(appliedFilters.value, grid.totalCount.value, !grid.hasLoadedStats.value)));

function setFilters(next: GalleryFilters): void {
  filters.value = next;
}

// 换了筛选，之前的选择不再对应眼前这些图
watch(queryFilter, () => viewState.clearSelection());

const emptyKind = computed<GalleryEmptyKind | null>((previous) => {
  if (reloading.value) return previous ?? null;
  if (!grid.hasLoadedStats.value || grid.totalCount.value > 0) return null;
  if (!hasActiveFilters(appliedFilters.value)) return 'empty';
  if (appliedFilters.value.favoritesOnly && historyManager.favoriteSet.value.size === 0) return 'favEmpty';
  return 'noResults';
});
/** 读得快就不闪骨架：超过 300ms 才出现（交接说明 8.2「冷启动」） */
const showSkeleton = useDebouncedTrue(computed(() => !grid.hasLoadedStats.value), 300);

// ---- 详情、焦点、复制 ----

const detailId = ref<string | null>(null);
const focusedId = ref<string | null>(null);
const { copiedKey, markCopied } = useCopyBadgeFeedback(1500);

/** 系统默认的双击间隔：这么短的时间里第二次点击算双击 */
const DOUBLE_CLICK_MS = 500;
/** 刚打开详情的那张：双击的第一下已经打开了详情、网格随之变窄重排，第二下可能落到另一张上 */
let lastOpened: { meta: ImageMeta; at: number } | null = null;

/** 单击 / Enter 打开详情；再点正开着的那张就收起（设计稿的详情没有关闭按钮，鼠标也要关得掉） */
function openDetail(meta: ImageMeta): void {
  focusedId.value = meta.id;
  detailId.value = detailId.value === meta.id ? null : meta.id;
  lastOpened = { meta, at: Date.now() };
}

/**
 * 打开灯箱：网格里按天翻页；列表视图里按列表眼前的顺序翻页（index = 这一行在列表里是第几行，
 * 从详情打开时按已取到的行去找）
 */
function openLightbox(meta: ImageMeta, index?: number): void {
  const target = lastOpened && Date.now() - lastOpened.at < DOUBLE_CLICK_MS ? lastOpened.meta : meta;
  lastOpened = null;
  focusedId.value = target.id;
  if (view.value === 'list') {
    const at = index !== undefined && target.id === meta.id ? index : list.indexOf(target.id);
    if (at >= 0) {
      void lightbox.openFromList(at);
      return;
    }
  }
  void lightbox.openFromGrid(target);
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

/** 焦点在按钮、链接、菜单项这类控件上：Enter、空格、方向键归它们自己 */
const CONTROL_SELECTOR = 'button, a[href], select, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="tab"], [role="switch"], [role="checkbox"], [role="slider"]';
function isControlTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(CONTROL_SELECTOR);
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
  const keyboardInGrid = gridView.value?.ownsFocus() ?? false;
  focusedId.value = next;
  if (detailId.value) detailId.value = next;
  reveal(next);
  if (keyboardInGrid) gridView.value?.focusTile(next);
}

/** 列表里用方向键走到另一行：详情开着就跟过去（同网格） */
function onListNavigate(meta: ImageMeta): void {
  focusedId.value = meta.id;
  if (detailId.value) detailId.value = meta.id;
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (!active.value || event.defaultPrevented) return;
  // 对话框、菜单、浮层、命令面板、灯箱开着时各管各的键（它们的 Esc 晚于这里注册，不能抢在前面收一层）
  if (document.querySelector('.pn-layer[data-state="open"], .command-palette[data-state="open"], .pswp--open')) return;
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
    void grid.selectAll();
    return;
  }
  if (view.value !== 'grid' || isControlTarget(event.target)) return;
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
            ref="gridView"
            :grid="grid"
            :focused-id="focusedId"
            :copied-id="copiedKey"
            :now="now"
            @open="openDetail"
            @open-lightbox="openLightbox"
            @copy="copyMeta"
            @focus="(meta: ImageMeta) => (focusedId = meta.id)"
          />
        </div>
        <GalleryList
          v-if="view === 'list' && !emptyKind"
          v-model:sort="listSort"
          :grid="grid"
          :list="list"
          :now="now"
          :focused-id="focusedId"
          :copied-id="copiedKey"
          @open="openDetail"
          @open-lightbox="openLightbox"
          @copy="copyMeta"
          @navigate="onListNavigate"
          @removed="onRemoved"
        />
        <GalleryEmpty v-if="emptyKind" :kind="emptyKind" @go-home="router.push('/home')" @clear-filters="setFilters(EMPTY_FILTERS)" />
        <GallerySkeleton v-if="showSkeleton && !grid.hasLoadedStats.value" class="gallery__overlay" />
        <GalleryScrubber
          v-if="view === 'grid' && !emptyKind && grid.hasLoadedStats.value && !grid.sectioned.value"
          :ticks="ticks"
          :visible="grid.scrubber.isSidebarVisible.value"
          @jump="jump"
        />
        <GallerySelectionBar v-if="viewState.hasSelection.value" :grid="grid" :format="format" @removed="onRemoved" />
      </div>
      <GalleryDetail v-if="detailId" :key="detailId" :item-id="detailId" :grid="grid" :format="format" @close="detailId = null" @open-lightbox="openLightbox" @removed="onRemoved" />
    </div>

    <GalleryLightbox :grid="grid" :nav="lightbox" :format="format" @removed="onRemoved" @show-info="(id: string) => { detailId = id; focusedId = id; }" />
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
