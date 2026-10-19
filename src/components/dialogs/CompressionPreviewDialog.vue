<script setup lang="ts">
// 压缩预览（设置 › 上传与链接 ›「压缩预览…」）：设计稿没画，按图库灯箱（G08）的样子做成整窗深色查看器，
// 左右拖动分割线对比原图与压缩后。做法记在 docs/design/redesign/decisions/settings.md。
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue';
import { DialogContent, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnIconButton from '@/components/pn/PnIconButton.vue';
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

const containerRef = ref<HTMLElement | null>(null);

const {
  scale,
  sliderX,
  isDraggingImage,
  imageTransformStyle,
  clipStyle,
  zoomPercent,
  resetView,
  onSliderDown,
  onImageDown,
  onWheel,
  onDoubleClick,
  cleanup: cleanupZoom,
} = useImageZoom(containerRef, { zoomAtCursor: true, enableSlider: true });

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
} = useCompressionTask(toRef(props, 'preset'), { onDone: () => resetView() });

const saved = computed(() => getSaved());
const isLarger = computed(() => getIsLarger());
const done = computed(() => status.value === 'done' && result.value !== null);

function setOpen(open: boolean) {
  if (!open) emit('update:visible', false);
}

// 打开时直接弹出选文件窗口；没选就关掉
watch(() => props.visible, async (visible) => {
  if (!visible) return;
  resetView();
  const selected = await selectAndCompress();
  if (!selected) emit('update:visible', false);
});

function pickAnother() {
  resetView();
  void selectAndCompress();
}

onBeforeUnmount(cleanupZoom);
</script>

<template>
  <DialogRoot :open="visible" @update:open="setOpen">
    <DialogPortal>
      <DialogContent class="pn-layer compress-view" data-theme="dark" :aria-describedby="undefined">
        <div class="compress-view__top">
          <PnIconButton icon="close" label="关闭" :icon-size="13" :stroke="2" class="compress-view__close" @click="setOpen(false)" />
          <DialogTitle class="compress-view__title">压缩预览</DialogTitle>
          <span v-if="done" class="compress-view__file">{{ fileName }}</span>
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

          <div
            v-else-if="done && originalSrc && compressedSrc"
            ref="containerRef"
            class="compress-view__compare"
            :class="{ 'compress-view__compare--dragging': isDraggingImage }"
            @wheel.prevent="onWheel"
            @mousedown="onImageDown"
            @dblclick="onDoubleClick"
          >
            <div class="compress-view__layer">
              <img :src="compressedSrc" :style="imageTransformStyle" class="compress-view__img" alt="压缩后" draggable="false" />
            </div>
            <!-- 原图盖在上面，按分割线位置裁掉右半边（裁切加在外层，百分比按容器算） -->
            <div class="compress-view__layer" :style="clipStyle">
              <img :src="originalSrc" :style="imageTransformStyle" class="compress-view__img" alt="原图" draggable="false" />
            </div>

            <div class="compress-view__divider" :style="{ left: `${sliderX}%` }">
              <div class="compress-view__line" />
              <div class="compress-view__handle" aria-hidden="true" @mousedown.stop="onSliderDown">
                <PnIcon name="arrowsH" :size="14" :stroke="2" />
              </div>
            </div>

            <span class="compress-view__chip compress-view__chip--left" :class="{ 'compress-view__chip--hidden': sliderX <= 8 }">原图</span>
            <span class="compress-view__chip compress-view__chip--right" :class="{ 'compress-view__chip--hidden': sliderX >= 92 }">压缩后</span>
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
            <span class="compress-view__zoom">{{ zoomPercent }}%</span>
            <button v-if="scale !== 1" type="button" class="compress-view__button" @click="resetView">重置</button>
          </template>
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
  padding: 0 var(--pn-space-16) 0 var(--pn-space-12);
}

.compress-view__bottom {
  height: var(--pn-size-lightbox-bottom);
  padding: 0 var(--pn-space-16) 0 var(--pn-space-20);
  box-shadow: inset 0 1px 0 var(--pn-lightbox-rule);
}

.compress-view__close {
  background: var(--pn-lightbox-button);
  color: var(--pn-text1);
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

.compress-view__compare {
  position: absolute;
  inset: 0;
  overflow: hidden;
  cursor: grab;
  user-select: none;
}

.compress-view__compare--dragging { cursor: grabbing; }

.compress-view__layer {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.compress-view__img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  pointer-events: none;
  will-change: transform;
}

.compress-view__divider {
  position: absolute;
  top: 0;
  bottom: 0;
  transform: translateX(-50%);
  pointer-events: none;
}

.compress-view__line {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: var(--pn-size-compare-line);
  background: var(--pn-text1);
  box-shadow: var(--pn-compare-line-shadow);
  transform: translateX(-50%);
}

.compress-view__handle {
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-button-lg);
  height: var(--pn-size-button-lg);
  border-radius: 50%;
  background: var(--pn-elevated);
  box-shadow: var(--pn-e3);
  color: var(--pn-text1);
  cursor: ew-resize;
  pointer-events: auto;
  transform: translate(-50%, -50%);
}

.compress-view__chip {
  position: absolute;
  top: var(--pn-space-12);
  display: flex;
  align-items: center;
  height: var(--pn-size-lightbox-chip);
  padding: 0 var(--pn-space-8);
  border-radius: var(--pn-radius-button-sm);
  background: var(--pn-lightbox-bg);
  color: var(--pn-text1);
  font-size: var(--pn-text-footnote);
  pointer-events: none;
  transition: opacity var(--pn-dur-fast) var(--pn-ease-in);
}

.compress-view__chip--left { left: var(--pn-space-12); }
.compress-view__chip--right { right: var(--pn-space-12); }
.compress-view__chip--hidden { opacity: 0; }

.compress-view__info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.compress-view__spacer { flex: 1; }

.compress-view__zoom {
  color: var(--pn-text3);
  font-family: var(--pn-font-mono);
  font-size: var(--pn-text-mono);
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
}

.compress-view__button:hover { background: var(--pn-lightbox-button-hover); }

@media (prefers-reduced-motion: reduce) {
  .compress-view__chip { transition: none; }
}
</style>
