<script setup lang="ts">
// 压缩预览（设置 › 上传与链接 ›「压缩预览…」）：设计稿没画，按图库灯箱（G08）的样子做成整窗深色查看器，
// 左右两栏对比：左原图、右压缩后，各自铺满自己那栏（两张显示得一样大），滚轮缩放、拖动平移默认各管各的；
// 底栏「两侧同步」打开后两栏一起动（打开那一刻右栏先对齐左栏），方便对比同一处细节。
// 做法记在 docs/design/redesign/decisions/settings.md。
import { computed, ref, toRef, watch } from 'vue';
import { DialogContent, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnSwitch from '@/components/pn/PnSwitch.vue';
import type { CompressionPreset } from '@/config/types';
import { useImageZoom } from '@/composables/image/useImageZoom';
import { useCompressionTask } from '@/composables/image/useCompressionTask';
import { formatFileSize } from '@/utils/formatters';

const props = defineProps<{
  visible: boolean;
  preset: CompressionPreset;
}>();
const emit = defineEmits<{
  'update:visible': [value: boolean];
}>();

const originalEl = ref<HTMLElement | null>(null);
const compressedEl = ref<HTMLElement | null>(null);
const originalZoom = useImageZoom(originalEl, { zoomAtCursor: true });
const compressedZoom = useImageZoom(compressedEl, { zoomAtCursor: true });

type Zoom = typeof originalZoom;

/** 两侧同步：开着时一栏的缩放、平移照抄到另一栏（照抄后两边相等，另一侧的 watch 不会再抄回来） */
const linked = ref(false);

function copyView(from: Zoom, to: Zoom) {
  to.scale.value = from.scale.value;
  to.translateX.value = from.translateX.value;
  to.translateY.value = from.translateY.value;
}

function follow(from: Zoom, to: Zoom) {
  watch([from.scale, from.translateX, from.translateY], () => {
    if (linked.value) copyView(from, to);
  });
}
follow(originalZoom, compressedZoom);
follow(compressedZoom, originalZoom);

function setLinked(on: boolean) {
  linked.value = on;
  if (on) copyView(originalZoom, compressedZoom);
}

function resetViews() {
  originalZoom.resetView();
  compressedZoom.resetView();
}

const {
  status,
  fileName,
  originalSrc,
  compressedSrc,
  result,
  errorMsg,
  getSaved,
  getIsLarger,
  selectAndCompress,
} = useCompressionTask(toRef(props, 'preset'), { onDone: resetViews });

const saved = computed(() => getSaved());
const isLarger = computed(() => getIsLarger());
const done = computed(() => status.value === 'done' && result.value !== null);
const zoomed = computed(() => originalZoom.scale.value !== 1 || compressedZoom.scale.value !== 1);

const panes = computed(() => [
  { key: 'original', label: '原图', src: originalSrc.value, zoom: originalZoom, el: originalEl },
  { key: 'compressed', label: '压缩后', src: compressedSrc.value, zoom: compressedZoom, el: compressedEl },
]);

// 没有输入框和主按钮：打开时焦点落在查看器本身，不落在「关闭」上（否则一打开关闭键就先亮起焦点环）
function focusViewer(event: Event) {
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.focus();
}

function setOpen(open: boolean) {
  if (!open) emit('update:visible', false);
}

// 打开时直接弹出选文件窗口；没选就关掉
watch(() => props.visible, async (visible) => {
  if (!visible) return;
  resetViews();
  const selected = await selectAndCompress();
  if (!selected) emit('update:visible', false);
});

function pickAnother() {
  resetViews();
  void selectAndCompress();
}
</script>

<template>
  <DialogRoot :open="visible" @update:open="setOpen">
    <DialogPortal>
      <DialogContent class="pn-layer compress-view" data-theme="dark" tabindex="-1" :aria-describedby="undefined" @open-auto-focus="focusViewer">
        <div class="compress-view__top">
          <DialogTitle class="compress-view__title">压缩预览</DialogTitle>
          <span v-if="done" class="compress-view__file">{{ fileName }}</span>
          <div class="compress-view__spacer" />
          <button type="button" class="compress-view__button compress-view__button--icon" aria-label="关闭" title="关闭  Esc" @click="setOpen(false)">
            <PnIcon name="close" :size="13" :stroke="2" />
          </button>
        </div>

        <div class="compress-view__stage">
          <div v-if="status === 'compressing'" class="compress-view__state" role="status">
            <svg class="compress-view__spinner" width="24" height="24" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="2" />
              <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="10 37.7" stroke-linecap="round" />
            </svg>
            <span>{{ fileName ? '正在压缩…' : '正在选择图片…' }}</span>
            <span v-if="fileName" class="compress-view__muted">{{ fileName }}</span>
          </div>

          <div v-else-if="status === 'error'" class="compress-view__state" role="alert">
            <PnIcon name="failRound" :size="24" class="compress-view__danger" />
            <span class="compress-view__danger">压缩失败</span>
            <span class="compress-view__muted">{{ errorMsg }}</span>
            <button type="button" class="compress-view__button" @click="pickAnother">重新选择…</button>
          </div>

          <div v-else-if="done && originalSrc && compressedSrc" class="compress-view__panes">
            <div
              v-for="pane in panes"
              :key="pane.key"
              :ref="(el) => (pane.el.value = el as HTMLElement | null)"
              class="compress-view__pane"
              :class="{ 'compress-view__pane--dragging': pane.zoom.isDraggingImage.value }"
              :data-pane="pane.key"
              @wheel.prevent="pane.zoom.onWheel"
              @mousedown="pane.zoom.onImageDown"
              @dblclick="pane.zoom.onDoubleClick"
            >
              <img :src="pane.src" :style="pane.zoom.imageTransformStyle.value" class="compress-view__img" :alt="pane.label" />
              <span class="compress-view__chip">
                {{ pane.label }}<template v-if="pane.zoom.scale.value !== 1"> · {{ pane.zoom.zoomPercent.value }}%</template>
              </span>
            </div>
          </div>
        </div>

        <div class="compress-view__bottom">
          <div v-if="done && result" class="compress-view__info">
            <span>
              {{ formatFileSize(result.originalSize) }} → {{ formatFileSize(result.compressedSize) }}
              <span v-if="isLarger" class="compress-view__warn">· 体积增大</span>
              <span v-else>· 节省 {{ saved }}%</span>
            </span>
            <span class="compress-view__muted">{{ result.width }} × {{ result.height }} · {{ result.format.toUpperCase() }}</span>
          </div>
          <div class="compress-view__spacer" />
          <template v-if="done">
            <label class="compress-view__link" for="compress-view-link">两侧同步</label>
            <PnSwitch id="compress-view-link" :model-value="linked" label="两侧同步" @update:model-value="setLinked" />
          </template>
          <button v-if="done && zoomed" type="button" class="compress-view__button" @click="resetViews">重置</button>
          <button v-if="status !== 'compressing'" type="button" class="compress-view__button" @click="pickAnother">
            <PnIcon name="gallery" :size="14" />
            换一张…
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<!-- 内容传送到 body，scoped 样式够不到，用不带 scoped 的唯一类名；颜色取深色令牌（data-theme="dark"），与灯箱一致 -->
<style>
.compress-view {
  position: fixed;
  inset: 0;
  z-index: var(--pn-z-lightbox);
  display: flex;
  flex-direction: column;
  background: var(--pn-lightbox-bg);
  color: var(--pn-text1);
  outline: none;
}

.compress-view[data-state='open'] { animation: pn-dialog-fade var(--pn-dur-expressive) var(--pn-ease-in); }

/* 关闭时淡出：退场 ease-out、比进场快 30%（同对话框遮罩）；Reka 等这段动画播完才移除 */
.compress-view[data-state='closed'] { animation: pn-fade-out calc(var(--pn-dur-expressive) * 0.7) var(--pn-ease-out) forwards; }

.compress-view__top,
.compress-view__bottom {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--pn-space-button-sm-x);
  min-width: 0;
}

.compress-view__top {
  height: var(--pn-size-lightbox-top);
  padding: 0 var(--pn-space-12) 0 var(--pn-space-20);
}

.compress-view__bottom {
  height: var(--pn-size-lightbox-bottom);
  padding: 0 var(--pn-space-16) 0 var(--pn-space-20);
  box-shadow: inset 0 1px 0 var(--pn-lightbox-rule);
}

.compress-view__title {
  flex: none;
  margin: 0;
  font-size: var(--pn-text-headline);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-headline);
}

.compress-view__file {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--pn-text3);
  font-family: var(--pn-font-mono);
  font-size: var(--pn-text-mono);
}

.compress-view__stage {
  position: relative;
  flex: 1;
  min-height: 0;
  background-color: var(--pn-checker-a);
  background-image: var(--pn-checker);
  background-position: var(--pn-checker-position);
  background-size: var(--pn-size-checker) var(--pn-size-checker);
}

.compress-view__state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--pn-space-8);
  padding: 0 var(--pn-space-32);
  background: var(--pn-lightbox-bg);
  text-align: center;
}

.compress-view__spinner {
  color: var(--pn-brand);
  animation: pn-spin var(--pn-dur-spin) linear infinite;
}

.compress-view__muted {
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
  word-break: break-all;
}

.compress-view__danger { color: var(--pn-danger); }
.compress-view__warn { color: var(--pn-warning); }

.compress-view__panes {
  position: absolute;
  inset: 0;
  display: flex;
}

/* 两栏之间一条细线（与底栏分隔线同色） */
.compress-view__pane {
  position: relative;
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-width: 0;
  overflow: hidden;
  cursor: grab;
}

.compress-view__pane + .compress-view__pane { box-shadow: inset 1px 0 0 var(--pn-lightbox-rule); }
.compress-view__pane--dragging { cursor: grabbing; }

/* 铺满自己那栏（小图也放大），原图和压缩后显示得一样大，换栏看时不会一大一小 */
.compress-view__img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  will-change: transform;
}

.compress-view__chip {
  position: absolute;
  top: var(--pn-space-12);
  left: var(--pn-space-12);
  display: flex;
  align-items: center;
  height: var(--pn-size-lightbox-chip);
  padding: 0 var(--pn-space-8);
  border-radius: var(--pn-radius-button-sm);
  background: var(--pn-lightbox-bg);
  color: var(--pn-text1);
  font-size: var(--pn-text-footnote);
  pointer-events: none;
}

.compress-view__info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.compress-view__spacer { flex: 1; }

.compress-view__link {
  margin-right: var(--pn-space-8);
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
  cursor: pointer;
}

.compress-view__button {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--pn-space-6);
  height: var(--pn-size-button-lg);
  padding: 0 var(--pn-space-12);
  border: 0;
  border-radius: var(--pn-radius-md);
  background: var(--pn-lightbox-button);
  color: var(--pn-text1);
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

/* 按钮样式同灯箱（G08）：半透明白底，悬停、按下各亮一级（用灯箱按钮的同一组令牌） */
.compress-view__button:hover { background: var(--pn-lightbox-button-hover); }
.compress-view__button:active { background: var(--pn-lightbox-button-press); }
.compress-view__button--icon { width: var(--pn-size-button-lg); padding: 0; }

@media (prefers-reduced-motion: reduce) {
  .compress-view[data-state='open'] { animation-duration: var(--pn-dur-fade-expressive); }
  .compress-view[data-state='closed'] { animation: pn-fade-out calc(var(--pn-dur-fade-expressive) * 0.7) var(--pn-ease-out) forwards; }
}
</style>
