<script setup lang="ts">
// 图库的一格（GalleryScreen.dc.html）：图按原比例铺满格子；常驻角标只在需要注意时出现（⚠ 失效 / ⚠ 可能受限 / 仅 1 份）。
// 悬停：左上选择框、右上收藏、左下花瓣（几份备份）、右下「复制」。
// 多选：选中的图在自己的格子里缩小到 86%，露出浅蓝底 + 左上蓝色对勾，不向外扩边；未选中的常驻空心圆圈。
// 不同比例怎么画见 ImageRatios.dc.html（G13）：长图从顶部显示、底部渐隐；小图按原尺寸居中；透明格式衬棋盘格；GIF 停在第一帧。
import { computed, ref } from 'vue';
import PetalGlyph from '@/components/biz/PetalGlyph.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import { useThumbnailFallbackChain } from '@/composables/image/useThumbnailFallbackChain';
import type { ImageMeta } from '@/types/image-meta';
import { displayKind, displayTag, imageFormat, isAnimatedFormat, mayBeTransparent } from '@/utils/imageDisplay';
import { badgeOf, petalLabelOf, petalsOf } from './galleryMeta';
import { badgeFit, tagFits } from './tileMarkFit';

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
  /** 网格里唯一的 Tab 停留点（其余格子用方向键走到） */
  tabbable?: boolean;
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
  /** 键盘把焦点移到了这一格（Tab 或方向键；鼠标点击不算） */
  keyboardFocus: [];
}>();

const hover = ref(false);
/** 悬停按钮那一层（刚复制过时也留着「已复制」）：四个角被它占着，常驻的角标都让开 */
const overlay = computed(() => (hover.value || props.copied) && !props.selecting);

// 候选链：主图失败自动换其他备份的地址，都失败才报错（交接说明 8.2「冷启动」）
const { currentSrc, handleError, handleLoad } = useThumbnailFallbackChain({
  urls: () => props.thumbnailUrls,
  isWaiting: () => !props.failed && !props.loaded && props.displayMode !== 'fast',
  onExhausted: (e) => emit('imageError', e),
  confirmedHttpHosts: () => props.confirmedHttpHosts,
});

/** 选中时隐藏健康角标（G04）；格子太窄时 ⚠ 角标只留 ⚠，「仅 1 份」不画 */
const badge = computed(() => {
  const health = props.selected ? null : badgeOf(props.meta);
  const fit = health ? badgeFit(health, props.width) : 'none';
  return health && fit !== 'none' ? { ...health, iconOnly: fit === 'icon' } : null;
});
const petals = computed(() => petalsOf(props.meta));
const petalLabel = computed(() => petalLabelOf(props.meta));

const kind = computed(() => displayKind(props.meta));
const format = computed(() => imageFormat(props.meta));
const checker = computed(() => mayBeTransparent(format.value));
const animated = computed(() => isAnimatedFormat(format.value));
/** 说明角标只在图显示出来、没被悬停按钮或选中状态盖住时出现 */
const showMarks = computed(() => props.loaded && !props.failed && !props.selected && !overlay.value);
/**
 * 「长图」与健康角标同在左下角；小图的原尺寸在右下角，格子窄时会撞上左下的健康角标。
 * 两种都让位给健康角标（出了问题更要紧）；全景格子够宽，两个都留。
 */
const tag = computed(() => {
  const text = displayTag(props.meta);
  return text && (!badge.value || kind.value === 'wide') && tagFits(text, props.width) ? text : null;
});

/** 读屏在文件名之后读的状态：问题角标、收藏、比例说明（格子上那几个角标只给眼睛看，被悬停层盖住时这里也照读） */
const description = computed(() => {
  const health = badgeOf(props.meta);
  const parts = [props.failed && '图片加载失败', health && (health.warn ? `⚠ ${health.text}` : health.text), props.favorited && '已收藏', displayTag(props.meta), animated.value && 'GIF'];
  return parts.filter(Boolean).join('，') || undefined;
});

function onFocus(event: FocusEvent): void {
  if ((event.target as HTMLElement).matches(':focus-visible')) emit('keyboardFocus');
}

/** 小图按原尺寸放在方格中间；格子比原图小时等比缩小，不放大 */
const smallBox = computed(() => {
  const { width, height } = props.meta;
  if (kind.value !== 'small' || !width || !height) return undefined;
  const scale = Math.min(1, props.width / width, props.height / height);
  return { width: `${width * scale}px`, height: `${height * scale}px` };
});

// 动图停在第一帧：载入后画到 canvas 上、图片本身藏起来（也就不播放），鼠标停留时才露出来
const frame = ref<HTMLCanvasElement | null>(null);
const frameReady = ref(false);
const still = computed(() => animated.value && frameReady.value && !hover.value);

function captureFirstFrame(img: HTMLImageElement): void {
  const canvas = frame.value;
  const context = canvas?.getContext('2d');
  if (!canvas || !context || !img.naturalWidth || !img.naturalHeight) return;
  // 画到格子在屏幕上需要的清晰度为止，不超过原图
  const scale = Math.min(1, Math.max(
    (props.width * window.devicePixelRatio) / img.naturalWidth,
    (props.height * window.devicePixelRatio) / img.naturalHeight,
  ));
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  try {
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    frameReady.value = true;
  } catch {
    // 画不出来就照常播放
    frameReady.value = false;
  }
}

function onLoad(event: Event): void {
  handleLoad();
  if (animated.value) captureFirstFrame(event.target as HTMLImageElement);
  emit('imageLoad');
}

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
    :class="{ 'tile--selected': selected, 'tile--long': kind === 'long', 'tile--small': kind === 'small' && loaded }"
    :id="`tile-${meta.id}`"
    role="gridcell"
    :tabindex="tabbable ? 0 : -1"
    :aria-selected="selected"
    :aria-label="meta.localFileName"
    :aria-description="description"
    :title="meta.localFileName"
    :data-lightbox-id="meta.id"
    :style="{ transform: `translate3d(${x}px, ${y}px, 0)`, width: `${width}px`, height: `${height}px` }"
    @click="onClick"
    @dblclick="emit('openLightbox')"
    @focus="onFocus"
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
        :class="{ 'tile__img--loaded': loaded, 'tile__img--checker': checker, 'tile__img--still': still }"
        :style="smallBox"
        @load="onLoad"
        @error="handleError"
      >
      <canvas
        v-if="animated"
        v-show="still"
        ref="frame"
        class="tile__img tile__img--loaded"
        :class="{ 'tile__img--checker': checker }"
        :style="smallBox"
        aria-hidden="true"
      />
      <span v-if="kind === 'long' && loaded && !failed" class="tile__fade" aria-hidden="true" />
      <span v-if="failed" class="tile__broken" aria-hidden="true">
        <PnIcon name="gallery" :size="20" :stroke="1.4" />
        图片加载失败
      </span>

      <PnIcon v-if="favorited && !overlay" name="star" filled :size="14" class="tile__fav" />
      <span v-if="badge && !overlay" class="tile__badge" aria-hidden="true">
        <PnIcon v-if="badge.warn" name="warning" :size="11" :stroke="2" class="tile__badge-warn" />
        <template v-if="!badge.iconOnly">{{ badge.text }}</template>
      </span>
      <span v-if="animated && showMarks && !selecting" class="tile__tag tile__tag--gif" aria-hidden="true">GIF</span>
      <span v-if="tag && showMarks" class="tile__tag" :class="`tile__tag--${kind}`" aria-hidden="true">{{ tag }}</span>

      <div v-if="overlay" class="tile__hover">
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

/* 小图放在方格里，空出来的地方是画布色（选中时让位给下面的浅蓝底） */
.tile--small { background: var(--pn-canvas); }

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

.tile--long .tile__img { object-position: top; }

.tile--small .tile__inner {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 透明格式：棋盘格铺在图片自己的底上，只在透明的地方露出来 */
.tile__img--checker {
  background-color: var(--pn-checker-a);
  background-image: var(--pn-checker);
  background-position: var(--pn-checker-position);
  background-size: var(--pn-size-checker) var(--pn-size-checker);
}

/* 动图停在第一帧时图片本身不画，也就不播放；不占位置，第一帧的 canvas 才在格子里 */
.tile__img--still { display: none; }

.tile__fade {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: var(--pn-size-tile-fade);
  background: var(--pn-media-fade-long);
  pointer-events: none;
}

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

.tile__tag {
  position: absolute;
  display: flex;
  align-items: center;
  height: var(--pn-size-tile-tag);
  padding: 0 var(--pn-space-6);
  border-radius: var(--pn-radius-tile-tag);
  background: var(--pn-media-badge-bg);
  color: var(--pn-media-fg);
  font-size: var(--pn-text-caption);
  font-weight: var(--pn-weight-medium);
  white-space: nowrap;
  pointer-events: none;
}

.tile__tag--long { bottom: var(--pn-space-6); left: var(--pn-space-6); }
.tile__tag--wide { right: var(--pn-space-6); bottom: var(--pn-space-6); }
.tile__tag--gif { top: var(--pn-space-6); left: var(--pn-space-6); font-weight: var(--pn-weight-semibold); }

/* 小图的原尺寸是画布上的一行小字，不是深色底板 */
.tile__tag--small {
  right: var(--pn-space-6);
  bottom: var(--pn-space-6);
  height: auto;
  padding: 0;
  background: none;
  color: var(--pn-text3);
  font-family: var(--pn-font-mono);
  font-weight: var(--pn-weight-regular);
}

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
