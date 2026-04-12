<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, toRef } from 'vue';
import type { CompressionPreset } from '../../config/types';
import { useImageZoom } from '../../composables/useImageZoom';
import { useCompressionTask } from '../../composables/useCompressionTask';
import CompressionPreviewHeader from './compression-preview/CompressionPreviewHeader.vue';
import CompressionPreviewInfoBar from './compression-preview/CompressionPreviewInfoBar.vue';
import CompressionPreviewState from './compression-preview/CompressionPreviewState.vue';

interface Props {
  visible: boolean;
  preset: CompressionPreset;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  'update:visible': [value: boolean];
}>();

// ---- 容器 ref（template 中绑定） ----
const containerRef = ref<HTMLElement | null>(null);

// ---- 缩放 & 平移 ----
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
} = useImageZoom(containerRef, {
  zoomAtCursor: true,
  enableSlider: true,
});

// ---- 压缩任务 ----
const {
  status,
  fileName,
  originalSrc,
  compressedSrc,
  result,
  errorMsg,
  getSaved,
  getIsLarger,
  formatSize,
  selectAndCompress,
} = useCompressionTask(toRef(props, 'preset'), {
  onDone: () => resetView(),
});

// ---- 派生计算属性（template 直接使用） ----
const saved = computed(() => getSaved());
const isLarger = computed(() => getIsLarger());

// ---- 对话框控制 ----
function close() {
  emit('update:visible', false);
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}

function onOverlayClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('cpd-overlay')) {
    close();
  }
}

// ---- 打开时自动选择文件 & 压缩 ----
watch(() => props.visible, async (v) => {
  if (v) {
    resetView();
    const selected = await selectAndCompress();
    if (!selected) close();
  }
});

function retrySelect() {
  resetView();
  selectAndCompress();
}

onMounted(() => {
  document.addEventListener('keydown', onKeyDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeyDown);
  cleanupZoom();
});
</script>

<template>
  <Teleport to="body">
    <Transition name="cpd">
      <div v-if="visible" class="cpd-overlay" @click="onOverlayClick">
        <div class="cpd-dialog">
          <!-- 头部 -->
          <CompressionPreviewHeader
            :show-filename="status === 'done' && !!result"
            :file-name="fileName"
            @close="close"
          />

          <!-- 信息条 -->
          <CompressionPreviewInfoBar
            v-if="status === 'done' && result"
            :result="result"
            :saved="saved"
            :is-larger="isLarger"
            :format-size="formatSize"
          />

          <!-- 主体区域 -->
          <div class="cpd-body">
            <!-- 加载/错误状态 -->
            <CompressionPreviewState
              v-if="status === 'compressing' || status === 'error'"
              :status="status"
              :file-name="fileName"
              :error-msg="errorMsg"
              @retry="retrySelect"
            />

            <!-- 对比视图 -->
            <div
              v-else-if="status === 'done' && originalSrc && compressedSrc"
              ref="containerRef"
              class="cpd-compare"
              :style="{ cursor: isDraggingImage ? 'grabbing' : 'grab' }"
              @wheel.prevent="onWheel"
              @mousedown="onImageDown"
              @dblclick="onDoubleClick"
            >
              <!-- 底层：压缩后 -->
              <div class="cpd-img-layer">
                <img :src="compressedSrc" :style="imageTransformStyle" class="cpd-img" draggable="false" />
              </div>
              <!-- 顶层：原图（clip 在 wrapper 上，百分比基于容器） -->
              <div class="cpd-img-layer" :style="clipStyle">
                <img :src="originalSrc" :style="imageTransformStyle" class="cpd-img" draggable="false" />
              </div>

              <!-- 滑块 -->
              <div class="cpd-slider" :style="{ left: sliderX + '%' }">
                <div class="cpd-slider-line" />
                <div
                  class="cpd-slider-handle"
                  @mousedown.stop="onSliderDown"
                  :style="{ cursor: 'ew-resize' }"
                >
                  <i class="pi pi-arrows-h" />
                </div>
              </div>

              <!-- 标签 -->
              <span class="cpd-badge cpd-badge-left" :class="{ hidden: sliderX <= 8 }">原图</span>
              <span class="cpd-badge cpd-badge-right" :class="{ hidden: sliderX >= 92 }">压缩后</span>
            </div>
          </div>

          <!-- 底部 -->
          <div class="cpd-footer">
            <div class="cpd-footer-left">
              <template v-if="status === 'done'">
                <span class="cpd-zoom-label">{{ zoomPercent }}%</span>
                <button v-if="scale !== 1" class="cpd-btn ghost" @click="resetView">重置</button>
              </template>
            </div>
            <div class="cpd-footer-right">
              <button v-if="status === 'done' || status === 'error'" class="cpd-btn outline" @click="retrySelect">
                <i class="pi pi-image" />
                换一张
              </button>
              <button class="cpd-btn primary" @click="close">关闭</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* --- 遮罩 & 动画 --- */
.cpd-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-lightbox);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 60%);
  backdrop-filter: blur(8px);
}

.cpd-enter-active {
  transition: opacity var(--duration-normal) ease;
}

.cpd-enter-active .cpd-dialog {
  transition: transform var(--duration-normal) var(--ease-overshoot), opacity var(--duration-normal) ease;
}

.cpd-leave-active {
  transition: opacity var(--duration-fast) ease;
}

.cpd-leave-active .cpd-dialog {
  transition: transform var(--duration-fast) ease, opacity var(--duration-fast) ease;
}

.cpd-enter-from {
  opacity: 0;
}

.cpd-enter-from .cpd-dialog {
  opacity: 0;
  transform: scale(0.92);
}

.cpd-leave-to {
  opacity: 0;
}

.cpd-leave-to .cpd-dialog {
  opacity: 0;
  transform: scale(0.95);
}

/* --- 弹窗主体 --- */
.cpd-dialog {
  width: 900px;
  max-width: 94vw;
  height: 680px;
  max-height: 88vh;
  background: var(--bg-card);
  border-radius: 16px;
  box-shadow: var(--shadow-dialog);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* --- 主体 --- */
.cpd-body {
  flex: 1;
  min-height: 0;
  margin: 12px 24px;
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  background: var(--bg-input);

  /* 棋盘格背景（透明图可见） */
  background-image:
    linear-gradient(45deg, var(--hover-overlay-subtle) 25%, transparent 25%),
    linear-gradient(-45deg, var(--hover-overlay-subtle) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--hover-overlay-subtle) 75%),
    linear-gradient(-45deg, transparent 75%, var(--hover-overlay-subtle) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}

/* --- 对比容器 --- */
.cpd-compare {
  width: 100%;
  height: 100%;
  min-height: 380px;
  position: relative;
  overflow: hidden;
  user-select: none;
}

.cpd-img-layer {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.cpd-img-layer + .cpd-img-layer {
  z-index: 1;
}

.cpd-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  will-change: transform;
  pointer-events: none;
}

/* --- 滑块 --- */
.cpd-slider {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 2;
  transform: translateX(-50%);
  pointer-events: none;
}

.cpd-slider-line {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 2px;
  margin-left: -1px;
  background: var(--bg-card);
  box-shadow: 0 0 4px rgb(0 0 0 / 50%);
}

.cpd-slider-handle {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 36px;
  height: 36px;
  margin-left: -18px;
  margin-top: -18px;
  border-radius: 50%;
  background: var(--bg-card);
  box-shadow: 0 2px 8px rgb(0 0 0 / 30%);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  color: var(--text-primary);
  font-size: var(--text-base);
  transition: transform var(--duration-micro);
}

.cpd-slider-handle:hover {
  transform: scale(1.1);
}

/* --- 标签 --- */
.cpd-badge {
  position: absolute;
  top: 12px;
  z-index: 3;
  padding: 4px 12px;
  border-radius: 6px;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: white;
  background: rgb(0 0 0 / 55%);
  backdrop-filter: blur(4px);
  pointer-events: none;
  transition: opacity var(--duration-fast);
}

.cpd-badge.hidden {
  opacity: 0;
}

.cpd-badge-left {
  left: 12px;
}

.cpd-badge-right {
  right: 12px;
}

/* --- 底部 --- */
.cpd-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px 20px;
  flex-shrink: 0;
}

.cpd-footer-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cpd-footer-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cpd-zoom-label {
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--text-muted);
  min-width: 40px;
}

/* --- 按钮 --- */
.cpd-btn {
  padding: 8px 20px;
  border-radius: 8px;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: all var(--duration-fast);
  border: none;
}

.cpd-btn.primary {
  background: var(--primary);
  color: white;
}

.cpd-btn.primary:hover {
  filter: brightness(1.1);
}

.cpd-btn.outline {
  background: transparent;
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.cpd-btn.outline:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.cpd-btn.outline .pi {
  font-size: var(--text-xs);
}

.cpd-btn.ghost {
  background: transparent;
  color: var(--text-muted);
  padding: 4px 10px;
  font-size: var(--text-xs);
}

.cpd-btn.ghost:hover {
  color: var(--primary);
  background: var(--primary-alpha-8);
}
</style>
