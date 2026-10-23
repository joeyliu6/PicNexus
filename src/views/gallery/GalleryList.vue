<script setup lang="ts">
// 列表视图（GalleryScreen.dc.html G02）：缩略图 · 文件名 · 图床（花瓣 + 名称）· 尺寸与大小 · 上传时间 · 状态 · 操作。
// 行高 54、虚拟滚动；点表头按文件名 / 大小 / 上传时间排序；「状态」列平时为空，出问题才写「⚠ 失效」。
// 单击打开详情，双击看大图，Ctrl/⌘ / Shift 单击多选（与网格一致）。
// 键盘：整张表只有一个 Tab 停留点（焦点那行），↑ ↓ / Home / End / PageUp / PageDown 换行，Enter 详情、空格大图；
// 这一行的「复制」「⋯」接在它后面，其余行的按钮不进 Tab 顺序。
// 列数按列表自己的宽度定（打开详情、收起侧栏都会变）：放不下七列先去掉「尺寸 · 大小」；再窄把图床写到文件名下面一行、
// 「状态」收成文件名旁的 ⚠，文件名始终有地方显示。
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { useElementSize } from '@vueuse/core';
import { useVirtualizer } from '@tanstack/vue-virtual';
import PetalGlyph from '@/components/biz/PetalGlyph.vue';
import ThumbnailImage from '@/components/common/ThumbnailImage.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnMenu from '@/components/pn/PnMenu.vue';
import PnMenuItem from '@/components/pn/PnMenuItem.vue';
import PnMenuSeparator from '@/components/pn/PnMenuSeparator.vue';
import { getServiceDisplayName } from '@/constants/serviceNames';
import { openUserExternalUrl } from '@/security/shellOpen';
import type { GalleryListRow, GalleryListSort, GalleryListSortKey } from '@/services/database/TimelineQueryService';
import type { ImageMeta } from '@/types/image-meta';
import { formatFileSize, formatListTime } from '@/utils/formatters';
import { listLayout, petalLabelOf, petalsOf, statusOf } from './galleryMeta';
import { useGalleryActions } from './useGalleryActions';
import type { GalleryGridApi } from './useGalleryGrid';
import type { GalleryListApi } from './useGalleryList';
import { vOverflowTitle } from '@/utils/overflowTitle';

const props = defineProps<{
  grid: GalleryGridApi;
  /** 列表的数据与排序放在页面上：切回网格再回来排序还在，灯箱也按它翻页 */
  list: GalleryListApi;
  sort: GalleryListSort;
  /** 详情正打开的那一行 */
  focusedId: string | null;
  copiedId: string | null;
  /** 「今天 / 昨天」按这个时刻算（页面统一刷新） */
  now: number;
}>();

const emit = defineEmits<{
  open: [meta: ImageMeta];
  /** index：这一行在列表里是第几行，灯箱按列表顺序翻页 */
  openLightbox: [meta: ImageMeta, index: number];
  'update:sort': [sort: GalleryListSort];
  copy: [meta: ImageMeta];
  removed: [ids: string[]];
  /** 键盘把焦点移到了这一行 */
  navigate: [meta: ImageMeta];
}>();

/** 与 --pn-size-list-row 一致（虚拟滚动按它算每行位置） */
const ROW_HEIGHT = 54;
/** 不点表头时按上传时间、新的在前；每列第一次点的方向 */
const FIRST_DIRECTION: Record<GalleryListSortKey, boolean> = { time: true, name: false, size: true };

function sortBy(key: GalleryListSortKey): void {
  emit('update:sort', props.sort.key === key ? { key, descending: !props.sort.descending } : { key, descending: FIRST_DIRECTION[key] });
}
const arrow = (key: GalleryListSortKey) => (props.sort.key === key ? (props.sort.descending ? ' ↓' : ' ↑') : '');
const ariaSort = (key: GalleryListSortKey) => (props.sort.key === key ? (props.sort.descending ? 'descending' : 'ascending') : 'none');

const list = props.list;
const actions = useGalleryActions();
const { viewState, historyManager } = props.grid;

const root = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const { width } = useElementSize(root);
const layout = computed(() => listLayout(width.value));
const narrow = computed(() => layout.value !== 'wide');
const compact = computed(() => layout.value === 'compact');

const virtualizer = useVirtualizer(computed(() => ({
  count: list.total.value,
  getScrollElement: () => scroller.value,
  estimateSize: () => ROW_HEIGHT,
  overscan: 8,
})));
const visible = computed(() => virtualizer.value.getVirtualItems().map((item) => ({ item, row: list.rowAt(item.index) })));
// 屏幕上的行变了，或换上了新的一份（行没变也得补齐）：告诉列表数据屏幕上是哪几行，没取的去取
watch(() => [virtualizer.value.getVirtualItems().map((item) => item.index), list.generation.value] as const, ([indexes]) => {
  list.ensureVisible(indexes);
}, { immediate: true });
onUnmounted(() => list.ensureVisible([]));

// 换了筛选 / 排序：新结果从最上面看起。滚动区与虚拟列表记的位置一起当场归零，
// 换上新行的这一帧就画最上面那几行（只改滚动区的话，虚拟列表要等滚动事件才知道，中间一帧会按旧位置画、屏幕上是空的）
watch(() => list.shownKey.value, () => {
  if (scroller.value) scroller.value.scrollTop = 0;
  virtualizer.value.scrollOffset = 0;
});

const selectedIds = computed(() => new Set(viewState.selectedIdList.value));
const hostNames = (row: GalleryListRow) => (row.mirrorServices?.length ? row.mirrorServices.map((m) => m.serviceId) : [row.primaryService])
  .map((id) => getServiceDisplayName(id, props.grid.config.value))
  .join('、');
const sizeText = (row: GalleryListRow) => [row.width && row.height ? `${row.width} × ${row.height}` : '', row.fileSize ? formatFileSize(row.fileSize) : '']
  .filter(Boolean)
  .join(' · ');

function onRowClick(row: GalleryListRow, event: MouseEvent): void {
  // 双击的第二下：交给 dblclick 开灯箱，不再切换详情 / 选择
  if (event.detail > 1) return;
  if (viewState.hasSelection.value || event.ctrlKey || event.metaKey || event.shiftKey) {
    viewState.handleSelectClick(row.id, event, list.loadedRows.value.map((r) => r.id));
  } else emit('open', row);
}

async function remove(row: GalleryListRow): Promise<void> {
  if (await actions.removeRecords([row.id], row.localFileName)) emit('removed', [row.id]);
}

// ---- 键盘 ----

/** 键盘最后停在哪一行（序号） */
const activeIndex = ref<number | null>(null);
/** Tab 停在哪一行：详情那行在屏上就是它，其次是键盘最后停的那行，否则视口里第一行 */
const tabStopIndex = computed(() => {
  const byDetail = visible.value.find(({ row }) => row && row.id === props.focusedId);
  if (byDetail) return byDetail.item.index;
  if (visible.value.some(({ item }) => item.index === activeIndex.value)) return activeIndex.value;
  const top = virtualizer.value.scrollOffset ?? 0;
  return visible.value.find(({ item }) => item.end > top)?.item.index ?? null;
});

// 走到的那行可能还没画出来：先滚过去，等它出现再把焦点给它
let pendingFocus: number | null = null;
function applyPendingFocus(): void {
  if (pendingFocus === null) return;
  const el = scroller.value?.querySelector<HTMLElement>(`[data-index="${pendingFocus}"]`);
  if (!el) return;
  pendingFocus = null;
  el.focus({ preventScroll: true });
}
watch(visible, () => void nextTick(applyPendingFocus));

function moveTo(index: number): void {
  const target = Math.max(0, Math.min(index, list.total.value - 1));
  activeIndex.value = target;
  pendingFocus = target;
  virtualizer.value.scrollToIndex(target, { align: 'auto' });
  void nextTick(applyPendingFocus);
}

function onRowFocus(index: number, row: GalleryListRow | null, event: FocusEvent): void {
  activeIndex.value = index;
  if (row && (event.target as HTMLElement).matches(':focus-visible')) emit('navigate', row);
}

function onRowKeydown(index: number, row: GalleryListRow | null, event: KeyboardEvent): void {
  if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
  const page = Math.max(1, Math.floor((scroller.value?.clientHeight ?? ROW_HEIGHT) / ROW_HEIGHT) - 1);
  const moves: Record<string, number> = { ArrowDown: index + 1, ArrowUp: index - 1, PageDown: index + page, PageUp: index - page, Home: 0, End: list.total.value - 1 };
  if (event.key in moves) {
    event.preventDefault();
    moveTo(moves[event.key]);
  } else if (event.key === 'Enter' && row) {
    event.preventDefault();
    emit('open', row);
  } else if (event.key === ' ' && row) {
    event.preventDefault();
    emit('openLightbox', row, index);
  }
}
</script>

<template>
  <div ref="root" class="list" :class="{ 'list--narrow': narrow, 'list--compact': compact }" role="grid" aria-label="图片列表" aria-multiselectable="true" :aria-rowcount="list.total.value + 1">
    <div class="list__head" role="row" aria-rowindex="1">
      <span role="columnheader" aria-label="缩略图" />
      <span role="columnheader" :aria-sort="ariaSort('name')">
        <button type="button" class="list__sort" :class="{ 'list__sort--on': sort.key === 'name' }" @click="sortBy('name')">文件名{{ arrow('name') }}</button>
      </span>
      <span v-if="!compact" role="columnheader">图床</span>
      <span v-if="!narrow" role="columnheader" :aria-sort="ariaSort('size')">
        <button type="button" class="list__sort" :class="{ 'list__sort--on': sort.key === 'size' }" @click="sortBy('size')">尺寸 · 大小{{ arrow('size') }}</button>
      </span>
      <span role="columnheader" :aria-sort="ariaSort('time')">
        <button type="button" class="list__sort" :class="{ 'list__sort--on': sort.key === 'time' }" @click="sortBy('time')">上传时间{{ arrow('time') }}</button>
      </span>
      <span v-if="!compact" role="columnheader">状态</span>
      <span role="columnheader" aria-label="操作" />
    </div>

    <div ref="scroller" class="list__scroll">
      <div class="list__body" :style="{ height: `${virtualizer.getTotalSize()}px` }">
        <div
          v-for="{ item, row } in visible"
          :key="item.index"
          role="row"
          class="list__row"
          :class="{ 'list__row--selected': row && selectedIds.has(row.id), 'list__row--focused': row && focusedId === row.id }"
          :data-index="item.index"
          :tabindex="item.index === tabStopIndex ? 0 : -1"
          :aria-rowindex="item.index + 2"
          :aria-label="row?.localFileName"
          :aria-busy="row ? undefined : true"
          :aria-selected="row ? selectedIds.has(row.id) : undefined"
          :style="{ transform: `translateY(${item.start}px)` }"
          @click="row && onRowClick(row, $event)"
          @dblclick="row && emit('openLightbox', row, item.index)"
          @focus="onRowFocus(item.index, row, $event)"
          @keydown="onRowKeydown(item.index, row, $event)"
        >
          <template v-if="row">
            <span class="list__thumb" role="gridcell">
              <ThumbnailImage :srcs="grid.getThumbnailUrls(row)" alt="" :confirmed-http-hosts="grid.confirmedHttpHosts.value" />
            </span>
            <span class="list__name-cell" role="gridcell">
              <span class="list__name-line">
                <span v-overflow-title class="list__name">{{ row.localFileName }}</span>
                <PnIcon v-if="historyManager.favoriteSet.value.has(row.id)" name="star" filled :size="12" class="list__fav" />
                <span v-if="compact && statusOf(row).warn" class="list__status list__status--warn" :title="statusOf(row).text">
                  <PnIcon name="warning" :size="12" :stroke="2.2" />
                </span>
              </span>
              <span v-if="compact" class="list__hosts">
                <PetalGlyph :states="petalsOf(row)" :size="13" :label="petalLabelOf(row)" />
                <span class="list__muted list__ellipsis">{{ hostNames(row) }}</span>
              </span>
            </span>
            <span v-if="!compact" class="list__hosts" role="gridcell">
              <PetalGlyph :states="petalsOf(row)" :size="15" :label="petalLabelOf(row)" />
              <span class="list__muted list__ellipsis">{{ hostNames(row) }}</span>
            </span>
            <span v-if="!narrow" class="list__muted" role="gridcell">{{ sizeText(row) }}</span>
            <span class="list__muted" role="gridcell">{{ formatListTime(row.timestamp, props.now) }}</span>
            <span v-if="!compact" class="list__status" :class="{ 'list__status--warn': statusOf(row).warn }" role="gridcell">
              <PnIcon v-if="statusOf(row).warn" name="warning" :size="12" :stroke="2.2" />
              {{ statusOf(row).text }}
            </span>
            <span class="list__actions" role="gridcell">
              <button type="button" class="list__icon" :class="{ 'list__icon--done': copiedId === row.id }" :tabindex="item.index === tabStopIndex ? undefined : -1" :aria-label="copiedId === row.id ? '已复制' : '复制链接'" @click.stop="emit('copy', row)">
                <PnIcon :name="copiedId === row.id ? 'check' : 'copy'" :size="14" :stroke="copiedId === row.id ? 2.4 : 1.8" />
              </button>
              <PnMenu align="end" :width="180">
                <template #trigger>
                  <button type="button" class="list__icon" aria-label="更多操作" :tabindex="item.index === tabStopIndex ? undefined : -1" @click.stop>
                    <PnIcon name="more" :size="15" :stroke="2" />
                  </button>
                </template>
                <PnMenuItem @select="emit('open', row)">查看详情</PnMenuItem>
                <PnMenuItem @select="emit('openLightbox', row, item.index)">查看大图</PnMenuItem>
                <PnMenuItem :disabled="!row.primaryUrl" @select="openUserExternalUrl(row.primaryUrl)">在浏览器打开</PnMenuItem>
                <PnMenuSeparator />
                <PnMenuItem danger @select="remove(row)">移除记录</PnMenuItem>
              </PnMenu>
            </span>
          </template>
          <template v-else>
            <span class="list__thumb list__thumb--skeleton" />
            <span class="list__bone" />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.list {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  padding: 0 var(--pn-space-24);
}

.list__head,
.list__row {
  display: grid;
  grid-template-columns: var(--pn-grid-gallery-list);
  gap: var(--pn-space-16);
  align-items: center;
  padding: 0 var(--pn-space-button-sm-x);
}

.list--narrow .list__head,
.list--narrow .list__row { grid-template-columns: var(--pn-grid-gallery-list-narrow); }

.list--compact .list__head,
.list--compact .list__row { grid-template-columns: var(--pn-grid-gallery-list-compact); }

.list__head {
  flex: none;
  height: var(--pn-size-list-head);
  box-shadow: inset 0 -1px 0 var(--pn-border);
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
  white-space: nowrap;
}

/* 表头的排序按钮：悬停 / 按下的底色向两侧各伸 6，文字位置不变 */
.list__sort {
  height: var(--pn-size-filter-chip);
  margin: 0 calc(-1 * var(--pn-space-6));
  padding: 0 var(--pn-space-6);
  border: 0;
  border-radius: var(--pn-radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in), color var(--pn-dur-instant) var(--pn-ease-in);
}

.list__sort:hover { background: var(--pn-ghost-hover); color: var(--pn-text1); }
.list__sort:active { background: var(--pn-ghost-press); color: var(--pn-text1); }
.list__sort--on { color: var(--pn-text1); font-weight: var(--pn-weight-medium); }

.list__scroll {
  flex: 1;
  min-height: 0;
  overflow: hidden auto;
}

/* 滚动条平时透明、鼠标在列表上才露出：不和右边详情栏的分隔线并排成两道竖线 */
.list__scroll:not(:hover)::-webkit-scrollbar-thumb { background-color: transparent; }

.list__body { position: relative; }

.list__row {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: var(--pn-size-list-row);
  border-radius: var(--pn-radius-md);
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.list__row:hover { background: var(--pn-row-hover); }
.list__row--focused { background: var(--pn-selected); }
.list__row--selected { background: var(--pn-brand-soft); }

/* 焦点环画在行内：滚动区会裁掉画在外面的那圈 */
.list__row:focus-visible { outline-offset: calc(-1 * var(--pn-ring-width)); }

.list__thumb {
  display: flex;
  width: var(--pn-size-list-thumb-w);
  height: var(--pn-size-list-thumb-h);
  overflow: hidden;
  border-radius: var(--pn-radius-sm);
  background: var(--pn-subtle);
  box-shadow: 0 0 0 1px var(--pn-hairline);
}

.list__thumb--skeleton { background: var(--pn-skeleton); box-shadow: none; }

.list__bone {
  width: 40%;
  height: var(--pn-size-skeleton-heading);
  border-radius: var(--pn-radius-xs);
  background: var(--pn-skeleton);
}

.list__name-cell { display: flex; flex-direction: column; justify-content: center; gap: var(--pn-space-2); min-width: 0; }
.list__name-line { display: flex; align-items: center; gap: var(--pn-space-6); min-width: 0; }

.list__name,
.list__ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list__name { font-weight: var(--pn-weight-medium); }
.list__fav { flex: none; color: var(--pn-warning-fill); }

.list__hosts { display: flex; align-items: center; gap: var(--pn-space-8); min-width: 0; }

.list__muted { color: var(--pn-text2); font-size: var(--pn-text-footnote); }

.list__status {
  display: flex;
  align-items: center;
  gap: var(--pn-space-copy-gap);
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
}

.list__status--warn { color: var(--pn-warning); }

.list__actions { display: flex; justify-content: flex-end; gap: var(--pn-space-2); }

.list__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-button-sm);
  height: var(--pn-size-button-sm);
  padding: 0;
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: transparent;
  color: var(--pn-text2);
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in), color var(--pn-dur-fast) var(--pn-ease-in);
}

/* 按钮落在悬停行的浅灰底上：按浅灰底的级差，悬停再深一级、按下再深一级 */
.list__icon:hover,
.list__icon[data-state='open'] { background: var(--pn-ghost-press); }
.list__icon:active { background: var(--pn-subtle-press); }
.list__icon--done { color: var(--pn-success); }
</style>
