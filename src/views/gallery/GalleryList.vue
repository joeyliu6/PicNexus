<script setup lang="ts">
// 列表视图（GalleryScreen.dc.html G02）：缩略图 · 文件名 · 图床（花瓣 + 名称）· 尺寸与大小 · 上传时间 · 状态 · 操作。
// 行高 54、虚拟滚动；点表头按文件名 / 大小 / 上传时间排序；「状态」列平时为空，出问题才写「⚠ 失效」。
// 单击打开详情，双击看大图，Ctrl/⌘ / Shift 单击多选（与网格一致）。
import { computed, ref, watch } from 'vue';
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
import { petalLabelOf, petalsOf, statusOf } from './galleryMeta';
import { useGalleryActions } from './useGalleryActions';
import type { GalleryGridApi } from './useGalleryGrid';
import type { GalleryListApi } from './useGalleryList';

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
/** 窄窗口放不下七列：去掉「尺寸 · 大小」 */
const narrow = computed(() => width.value > 0 && width.value < 900);

const virtualizer = useVirtualizer(computed(() => ({
  count: props.grid.totalCount.value,
  getScrollElement: () => scroller.value,
  estimateSize: () => ROW_HEIGHT,
  overscan: 8,
})));
const visible = computed(() => virtualizer.value.getVirtualItems().map((item) => ({ item, row: list.rowAt(item.index) })));
// 屏幕上的行变了，或排序 / 筛选 / 记录变化让已取的页作废了（行没变也得重取），都把可见行补齐
watch(() => [virtualizer.value.getVirtualItems().map((item) => item.index), list.generation.value] as const, ([indexes]) => {
  for (const index of indexes) void list.ensure(index);
}, { immediate: true });

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
</script>

<template>
  <div ref="root" class="list" :class="{ 'list--narrow': narrow }" role="table" aria-label="图片列表" :aria-rowcount="grid.totalCount.value">
    <div class="list__head" role="row">
      <span role="columnheader" />
      <button type="button" role="columnheader" class="list__sort" :class="{ 'list__sort--on': sort.key === 'name' }" :aria-sort="ariaSort('name')" @click="sortBy('name')">文件名{{ arrow('name') }}</button>
      <span role="columnheader">图床</span>
      <button v-if="!narrow" type="button" role="columnheader" class="list__sort" :class="{ 'list__sort--on': sort.key === 'size' }" :aria-sort="ariaSort('size')" @click="sortBy('size')">尺寸 · 大小{{ arrow('size') }}</button>
      <button type="button" role="columnheader" class="list__sort" :class="{ 'list__sort--on': sort.key === 'time' }" :aria-sort="ariaSort('time')" @click="sortBy('time')">上传时间{{ arrow('time') }}</button>
      <span role="columnheader">状态</span>
      <span role="columnheader" />
    </div>

    <div ref="scroller" class="list__scroll">
      <div class="list__body" :style="{ height: `${virtualizer.getTotalSize()}px` }">
        <div
          v-for="{ item, row } in visible"
          :key="item.index"
          role="row"
          class="list__row"
          :class="{ 'list__row--selected': row && selectedIds.has(row.id), 'list__row--focused': row && focusedId === row.id }"
          :aria-rowindex="item.index + 1"
          :aria-selected="row ? selectedIds.has(row.id) : undefined"
          :style="{ transform: `translateY(${item.start}px)` }"
          @click="row && onRowClick(row, $event)"
          @dblclick="row && emit('openLightbox', row, item.index)"
        >
          <template v-if="row">
            <span class="list__thumb" role="cell">
              <ThumbnailImage :srcs="grid.getThumbnailUrls(row)" alt="" :confirmed-http-hosts="grid.confirmedHttpHosts.value" />
            </span>
            <span class="list__name-cell" role="cell">
              <span class="list__name">{{ row.localFileName }}</span>
              <PnIcon v-if="historyManager.favoriteSet.value.has(row.id)" name="star" filled :size="12" class="list__fav" />
            </span>
            <span class="list__hosts" role="cell">
              <PetalGlyph :states="petalsOf(row)" :size="15" :label="petalLabelOf(row)" />
              <span class="list__muted list__ellipsis">{{ hostNames(row) }}</span>
            </span>
            <span v-if="!narrow" class="list__muted" role="cell">{{ sizeText(row) }}</span>
            <span class="list__muted" role="cell">{{ formatListTime(row.timestamp, props.now) }}</span>
            <span class="list__status" :class="{ 'list__status--warn': statusOf(row).warn }" role="cell">
              <PnIcon v-if="statusOf(row).warn" name="warning" :size="12" :stroke="2.2" />
              {{ statusOf(row).text }}
            </span>
            <span class="list__actions" role="cell">
              <button type="button" class="list__icon" :class="{ 'list__icon--done': copiedId === row.id }" :aria-label="copiedId === row.id ? '已复制' : '复制链接'" @click.stop="emit('copy', row)">
                <PnIcon :name="copiedId === row.id ? 'check' : 'copy'" :size="14" :stroke="copiedId === row.id ? 2.4 : 1.8" />
              </button>
              <PnMenu align="end" :width="180">
                <template #trigger>
                  <button type="button" class="list__icon" aria-label="更多操作" @click.stop>
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

.list__head {
  flex: none;
  height: var(--pn-size-list-head);
  box-shadow: inset 0 -1px 0 var(--pn-border);
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
}

.list__sort {
  justify-self: start;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.list__sort--on { color: var(--pn-text1); font-weight: var(--pn-weight-medium); }

.list__scroll {
  flex: 1;
  min-height: 0;
  overflow: hidden auto;
}

.list__body { position: relative; }

.list__row {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: var(--pn-size-list-row);
  border-radius: var(--pn-radius-md);
}

.list__row:hover { background: var(--pn-row-hover); }
.list__row--focused { background: var(--pn-selected); }
.list__row--selected { background: var(--pn-brand-soft); }

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

.list__name-cell { display: flex; align-items: center; gap: var(--pn-space-6); min-width: 0; }

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
}

.list__icon:hover,
.list__icon[data-state='open'] { background: var(--pn-selected); }
.list__icon--done { color: var(--pn-success); }
</style>
