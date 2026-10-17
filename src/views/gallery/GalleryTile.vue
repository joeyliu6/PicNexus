<script setup lang="ts">
// 图库的一格（GalleryScreen.dc.html）：图按原比例铺满格子；常驻角标只在需要注意时出现（⚠ 失效 / ⚠ 可能受限 / 仅 1 份）。
// 悬停：左上选择框、右上收藏、左下花瓣（几份备份）、右下「复制」。
// 多选：选中的图在自己的格子里缩小到 86%，露出浅蓝底 + 左上蓝色对勾，不向外扩边；未选中的常驻空心圆圈。
import { computed, ref } from 'vue';
import PetalGlyph from '@/components/biz/PetalGlyph.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import { useThumbnailFallbackChain } from '@/composables/image/useThumbnailFallbackChain';
import type { ImageMeta } from '@/types/image-meta';
import { badgeOf, petalLabelOf, petalsOf } from './galleryMeta';

const props = defineProps<{
  meta: ImageMeta;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
  favorited: boolean;
  /** 已进入多选（至少选中了一张）：单击改为选择 */
  selecting: boolean;
  /** 详情正打开的那张 / 键盘焦点所在 */
  focused: boolean;
  /** 刚复制过：「复制」原地变「已复制」1.5 秒 */
  copied: boolean;
  loaded: boolean;
  failed: boolean;
  displayMode: 'fast' | 'smooth' | 'normal';
  thumbnailUrls: string[];
  confirmedHttpHosts?: ReadonlySet<string>;
}>();

const emit = defineEmits<{
  open: [];
  openLightbox: [];
  toggleSelect: [event: MouseEvent];
  toggleFavorite: [];
  copy: [];
  imageLoad: [];
  imageError: [event?: Event];
}>();

const hover = ref(false);

// 候选链：主图失败自动换其他备份的地址，都失败才报错（交接说明 8.2「冷启动」）
const { currentSrc, handleError, handleLoad } = useThumbnailFallbackChain({
  urls: () => props.thumbnailUrls,
  isWaiting: () => !props.failed && !props.loaded && props.displayMode !== 'fast',
  onExhausted: (e) => emit('imageError', e),
  confirmedHttpHosts: () => props.confirmedHttpHosts,
});

function onLoad(): void {
  handleLoad();
  emit('imageLoad');
}

/** 选中时隐藏健康角标（G04） */
const badge = computed(() => (props.selected ? null : badgeOf(props.meta)));
const petals = computed(() => petalsOf(props.meta));
const petalLabel = computed(() => petalLabelOf(props.meta));

function onClick(event: MouseEvent): void {
  // 双击的第二下：交给 dblclick 开灯箱，不再切换详情 / 选择
  if (event.detail > 1) return;
  if (props.selecting || event.ctrlKey || event.metaKey || event.shiftKey) emit('toggleSelect', event);
  else emit('open');
}
</script>

<template>
  <div
    class="tile"
    :class="{ 'tile--selected': selected }"
    role="gridcell"
    :tabindex="focused ? 0 : -1"
    :aria-selected="selected"
    :aria-label="meta.localFileName"
    :title="meta.localFileName"
    :data-lightbox-id="meta.id"
    :style="{ transform: `translate3d(${x}px, ${y}px, 0)`, width: `${width}px`, height: `${height}px` }"
    @click="onClick"
    @dblclick="emit('openLightbox')"
    @mouseenter="hover = true"
    @mouseleave="hover = false"
  >
    <div class="tile__inner">
      <img
        v-if="currentSrc && displayMode !== 'fast'"
        :src="currentSrc"
        alt=""
        draggable="false"
        class="tile__img"
        :class="{ 'tile__img--loaded': loaded }"
        @load="onLoad"
        @error="handleError"
      >
      <span v-if="failed" class="tile__broken">
        <PnIcon name="gallery" :size="20" :stroke="1.4" />
        图片加载失败
      </span>

      <PnIcon v-if="favorited && !(hover && !selecting)" name="star" filled :size="14" class="tile__fav" />
      <span v-if="badge && !(hover && !selecting)" class="tile__badge">
        <PnIcon v-if="badge.warn" name="warning" :size="11" :stroke="2" class="tile__badge-warn" />
        {{ badge.text }}
      </span>

      <div v-if="(hover || copied) && !selecting" class="tile__hover">
        <button type="button" class="tile__select" aria-label="选择" @click.stop="emit('toggleSelect', $event)" />
        <button type="button" class="tile__star" :aria-label="favorited ? '取消收藏' : '收藏'" @click.stop="emit('toggleFavorite')">
          <PnIcon name="star" :size="16" :stroke="1.8" :filled="favorited" />
        </button>
        <PetalGlyph :states="petals" :size="16" on-image :label="petalLabel" class="tile__petals" />
        <button type="button" class="tile__copy" @click.stop="emit('copy')">{{ copied ? '已复制' : '复制' }}</button>
      </div>
    </div>

    <span v-if="selecting && !selected" class="tile__circle" aria-hidden="true" />
    <span v-if="selected" class="tile__check" aria-hidden="true">
      <PnIcon name="check" :size="12" :stroke="2.4" />
    </span>
    <span v-if="focused && !selected" class="tile__focus" aria-hidden="true" />
  </div>
</template>

<style scoped>
.tile {
  position: absolute;
  top: 0;
  left: 0;
  overflow: hidden;
  border-radius: var(--pn-radius-md);
  background: var(--pn-skeleton);
  box-shadow: 0 0 0 1px var(--pn-hairline);
  cursor: default;
  outline: none;
}

.tile--selected {
  background: var(--pn-brand-soft);
  box-shadow: none;
}

.tile__inner {
  position: absolute;
  inset: 0;
  overflow: hidden;
  transition: transform var(--pn-dur-fast) var(--pn-ease-in);
}

.tile--selected .tile__inner {
  border-radius: var(--pn-radius-sm);
  transform: scale(var(--pn-scale-tile-selected));
}

.tile__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity var(--pn-dur-fast) var(--pn-ease-in);
}

.tile__img--loaded { opacity: 1; }

.tile__broken {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--pn-space-4);
  color: var(--pn-text3);
  font-size: var(--pn-text-caption);
}

.tile__fav {
  position: absolute;
  top: var(--pn-space-8);
  right: var(--pn-space-8);
  color: var(--pn-media-fg);
  filter: var(--pn-media-icon-shadow);
}

.tile__badge {
  position: absolute;
  bottom: var(--pn-space-8);
  left: var(--pn-space-8);
  display: flex;
  align-items: center;
  gap: var(--pn-space-4);
  height: var(--pn-size-tile-badge);
  padding: 0 var(--pn-space-tile-badge-x);
  border-radius: var(--pn-radius-sm);
  background: var(--pn-media-badge-bg);
  color: var(--pn-media-fg);
  font-size: var(--pn-text-caption);
  font-weight: var(--pn-weight-medium);
  white-space: nowrap;
}

.tile__badge-warn { color: var(--pn-media-badge-warn); }

.tile__hover {
  position: absolute;
  inset: 0;
  background: var(--pn-media-hover);
}

.tile__select {
  position: absolute;
  top: var(--pn-space-8);
  left: var(--pn-space-8);
  width: var(--pn-size-tile-select);
  height: var(--pn-size-tile-select);
  box-sizing: border-box;
  padding: 0;
  border: var(--pn-border-tile-select) solid var(--pn-media-fg);
  border-radius: var(--pn-radius-tile-select);
  background: var(--pn-media-select-bg);
}

.tile__star {
  position: absolute;
  top: var(--pn-space-8);
  right: var(--pn-space-8);
  display: flex;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--pn-media-fg);
}

.tile__petals {
  position: absolute;
  bottom: var(--pn-space-tile-petals-bottom);
  left: var(--pn-space-8);
}

.tile__copy {
  position: absolute;
  right: var(--pn-space-8);
  bottom: var(--pn-space-8);
  display: flex;
  align-items: center;
  height: var(--pn-size-tile-chip);
  padding: 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: var(--pn-media-chip-bg);
  color: var(--pn-media-chip-fg);
  font: inherit;
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
}

.tile__circle {
  position: absolute;
  top: var(--pn-space-8);
  left: var(--pn-space-8);
  width: var(--pn-size-tile-select-idle);
  height: var(--pn-size-tile-select-idle);
  box-sizing: border-box;
  border: var(--pn-border-tile-select) solid var(--pn-media-fg);
  border-radius: 50%;
  background: var(--pn-media-select-idle-bg);
  box-shadow: var(--pn-media-select-shadow);
}

.tile__check {
  position: absolute;
  top: var(--pn-space-4);
  left: var(--pn-space-4);
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-tile-check);
  height: var(--pn-size-tile-check);
  border-radius: 50%;
  background: var(--pn-brand);
  box-shadow: 0 0 0 var(--pn-space-2) var(--pn-brand-soft);
  color: var(--pn-on-fill);
}

.tile__focus {
  position: absolute;
  inset: 0;
  border-radius: var(--pn-radius-md);
  box-shadow: inset 0 0 0 var(--pn-space-2) var(--pn-brand), inset 0 0 0 var(--pn-space-4) var(--pn-canvas);
  pointer-events: none;
}
</style>
