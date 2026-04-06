<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import type { CompressionPreset } from '../../config/types';

interface CompressResult {
  outputPath: string;
  originalSize: number;
  compressedSize: number;
  ratio: number;
  width: number;
  height: number;
  format: string;
}

interface Props {
  visible: boolean;
  preset: CompressionPreset;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  'update:visible': [value: boolean];
}>();

type Status = 'compressing' | 'done' | 'error';

const status = ref<Status>('compressing');
const fileName = ref('');
const originalSrc = ref('');
const compressedSrc = ref('');
const result = ref<CompressResult | null>(null);
const errorMsg = ref('');

const sliderX = ref(50);
const scale = ref(1);
const translateX = ref(0);
const translateY = ref(0);

const MIN_SCALE = 0.5;
const MAX_SCALE = 5;

const isDraggingSlider = ref(false);
const isDraggingImage = ref(false);
let dragStartX = 0;
let dragStartY = 0;
let dragStartTX = 0;
let dragStartTY = 0;
let rafId: number | null = null;

const containerRef = ref<HTMLElement | null>(null);

const saved = computed(() => {
  if (!result.value) return 0;
  return Math.round((1 - result.value.ratio) * 100);
});

const isLarger = computed(() => result.value ? result.value.ratio >= 1 : false);

const imageTransformStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
  transformOrigin: 'center center',
}));

const clipStyle = computed(() => ({
  clipPath: `inset(0 ${100 - sliderX.value}% 0 0)`,
}));

const zoomPercent = computed(() => Math.round(scale.value * 100));

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function resetView() {
  scale.value = 1;
  translateX.value = 0;
  translateY.value = 0;
  sliderX.value = 50;
}

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

// --- 滑块拖拽 ---
function onSliderDown(e: MouseEvent) {
  isDraggingSlider.value = true;
  e.preventDefault();
  e.stopPropagation();
  document.addEventListener('mousemove', onSliderMove);
  document.addEventListener('mouseup', onSliderUp);
}

function onSliderMove(e: MouseEvent) {
  if (!isDraggingSlider.value || !containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  sliderX.value = Math.max(2, Math.min(98, x));
}

function onSliderUp() {
  isDraggingSlider.value = false;
  document.removeEventListener('mousemove', onSliderMove);
  document.removeEventListener('mouseup', onSliderUp);
}

// --- 图片拖拽 ---
function onImageDown(e: MouseEvent) {
  if (isDraggingSlider.value) return;
  isDraggingImage.value = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragStartTX = translateX.value;
  dragStartTY = translateY.value;
  e.preventDefault();
  document.addEventListener('mousemove', onImageMove);
  document.addEventListener('mouseup', onImageUp);
}

function onImageMove(e: MouseEvent) {
  if (!isDraggingImage.value) return;
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    translateX.value = dragStartTX + (e.clientX - dragStartX);
    translateY.value = dragStartTY + (e.clientY - dragStartY);
  });
}

function onImageUp() {
  isDraggingImage.value = false;
  document.removeEventListener('mousemove', onImageMove);
  document.removeEventListener('mouseup', onImageUp);
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

// --- 缩放（以鼠标位置为中心） ---
function onWheel(e: WheelEvent) {
  if (!containerRef.value) return;
  e.preventDefault();

  const rect = containerRef.value.getBoundingClientRect();
  const mouseX = e.clientX - rect.left - rect.width / 2;
  const mouseY = e.clientY - rect.top - rect.height / 2;

  const oldScale = scale.value;
  const delta = e.deltaY > 0 ? -0.12 : 0.12;
  const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, oldScale + delta));

  if (newScale !== oldScale) {
    const ratio = newScale / oldScale;
    translateX.value = mouseX - ratio * (mouseX - translateX.value);
    translateY.value = mouseY - ratio * (mouseY - translateY.value);
    scale.value = newScale;
  }
}

function onDoubleClick() {
  resetView();
}

// --- 压缩逻辑 ---
watch(() => props.visible, (v) => {
  if (v) {
    resetView();
    selectAndCompress();
  }
});

async function selectAndCompress() {
  status.value = 'compressing';
  fileName.value = '';
  originalSrc.value = '';
  compressedSrc.value = '';
  result.value = null;
  errorMsg.value = '';

  const selected = await dialogOpen({
    multiple: false,
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }],
  });

  if (!selected) {
    close();
    return;
  }

  const filePath = Array.isArray(selected) ? selected[0] : selected;
  fileName.value = filePath.split(/[/\\]/).pop() || filePath;

  try {
    const preset = props.preset;
    let maxLongSide = 0;
    const scalePercent = preset.scalePercent ?? 100;
    if (scalePercent > 0 && scalePercent < 100) {
      const meta = await invoke<{ width: number; height: number }>('get_image_metadata', { path: filePath });
      maxLongSide = Math.round(Math.max(meta.width, meta.height) * scalePercent / 100);
    }

    const [compressResult, origB64] = await Promise.all([
      invoke<CompressResult>('compress_image', {
        filePath,
        quality: preset.quality,
        maxLongSide,
        outputFormat: preset.outputFormat,
        stripExif: preset.stripExif,
      }),
      invoke<string>('read_image_as_base64', { filePath, maxSide: 1200 }),
    ]);

    result.value = compressResult;
    originalSrc.value = origB64;

    const compB64 = await invoke<string>('read_image_as_base64', {
      filePath: compressResult.outputPath,
      maxSide: 1200,
    });
    compressedSrc.value = compB64;

    invoke('cleanup_compressed_files', { filePaths: [compressResult.outputPath] }).catch(() => {});
    status.value = 'done';
    resetView();
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
    status.value = 'error';
  }
}

function retrySelect() {
  resetView();
  selectAndCompress();
}

onMounted(() => {
  document.addEventListener('keydown', onKeyDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeyDown);
  onSliderUp();
  onImageUp();
});
</script>

<template>
  <Teleport to="body">
    <Transition name="cpd">
      <div v-if="visible" class="cpd-overlay" @click="onOverlayClick">
        <div class="cpd-dialog">
          <!-- 头部 -->
          <div class="cpd-header">
            <div class="cpd-header-left">
              <span class="cpd-title">压缩预览</span>
              <span v-if="status === 'done' && result" class="cpd-filename" v-tooltip.top="fileName">{{ fileName }}</span>
            </div>
            <button class="cpd-close" @click="close" v-tooltip.bottom="'关闭 (Esc)'">
              <i class="pi pi-times" />
            </button>
          </div>

          <!-- 信息条 -->
          <div v-if="status === 'done' && result" class="cpd-info-bar">
            <div class="cpd-info-left">
              <span class="cpd-size-badge original">{{ formatSize(result.originalSize) }}</span>
              <i class="pi pi-arrow-right cpd-arrow" />
              <span class="cpd-size-badge compressed">{{ formatSize(result.compressedSize) }}</span>
              <span class="cpd-ratio-badge" :class="isLarger ? 'larger' : 'saved'">
                {{ isLarger ? '体积增大' : `节省 ${saved}%` }}
              </span>
            </div>
            <span class="cpd-dims">{{ result.width }} × {{ result.height }} · {{ result.format.toUpperCase() }}</span>
          </div>

          <!-- 主体区域 -->
          <div class="cpd-body">
            <!-- 加载状态 -->
            <div v-if="status === 'compressing'" class="cpd-state">
              <div class="cpd-loading-ring">
                <i class="pi pi-spin pi-spinner" />
              </div>
              <span class="cpd-state-text">{{ fileName ? '压缩中...' : '选择图片...' }}</span>
              <span v-if="fileName" class="cpd-state-hint">{{ fileName }}</span>
            </div>

            <!-- 错误状态 -->
            <div v-else-if="status === 'error'" class="cpd-state">
              <div class="cpd-error-icon">
                <i class="pi pi-times-circle" />
              </div>
              <span class="cpd-state-text error">压缩失败</span>
              <span class="cpd-state-hint">{{ errorMsg }}</span>
              <button class="cpd-retry-btn" @click="retrySelect">
                <i class="pi pi-refresh" />
                重新选择
              </button>
            </div>

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
  z-index: 9998;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
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

/* --- 头部 --- */
.cpd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 0;
  flex-shrink: 0;
}

.cpd-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.cpd-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  flex-shrink: 0;
}

.cpd-filename {
  font-size: 13px;
  color: var(--text-muted);
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 10px;
  background: var(--hover-overlay-subtle);
  border-radius: 4px;
  font-family: var(--font-mono);
}

.cpd-close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 8px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--duration-fast);
  flex-shrink: 0;
}

.cpd-close:hover {
  background: var(--hover-overlay);
  color: var(--text-primary);
}

/* --- 信息条 --- */
.cpd-info-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 24px 0;
  font-size: 13px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.cpd-info-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cpd-size-badge {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: 6px;
}

.cpd-size-badge.original {
  color: var(--text-secondary);
  background: var(--hover-overlay-subtle);
}

.cpd-size-badge.compressed {
  color: var(--primary);
  background: var(--primary-alpha-8);
}

.cpd-arrow {
  font-size: 10px;
  color: var(--text-muted);
}

.cpd-ratio-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 6px;
}

.cpd-ratio-badge.saved {
  color: var(--success);
  background: var(--success-soft);
}

.cpd-ratio-badge.larger {
  color: var(--warning);
  background: var(--warning-soft);
}

.cpd-dims {
  color: var(--text-muted);
  font-size: 12px;
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
  background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
}

/* --- 状态页 --- */
.cpd-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: var(--bg-input);
}

.cpd-loading-ring {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--primary-alpha-8);
}

.cpd-loading-ring .pi {
  font-size: 24px;
  color: var(--primary);
}

.cpd-error-icon {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--error-soft);
}

.cpd-error-icon .pi {
  font-size: 24px;
  color: var(--error);
}

.cpd-state-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
}

.cpd-state-text.error {
  color: var(--error);
}

.cpd-state-hint {
  font-size: 12px;
  color: var(--text-muted);
  max-width: 400px;
  text-align: center;
  word-break: break-all;
}

.cpd-retry-btn {
  margin-top: 4px;
  padding: 7px 18px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--duration-fast);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.cpd-retry-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-alpha-8);
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
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
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
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  color: var(--text-primary);
  font-size: 14px;
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
  font-size: 12px;
  font-weight: 600;
  color: white;
  background: rgba(0, 0, 0, 0.55);
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
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  min-width: 40px;
}

/* --- 按钮 --- */
.cpd-btn {
  padding: 8px 20px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
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
  font-size: 12px;
}

.cpd-btn.ghost {
  background: transparent;
  color: var(--text-muted);
  padding: 4px 10px;
  font-size: 12px;
}

.cpd-btn.ghost:hover {
  color: var(--primary);
  background: var(--primary-alpha-8);
}
</style>
