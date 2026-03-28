<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import type { HistoryItem, ServiceType } from '../../../config/types';
import { useToast } from '../../../composables/useToast';
import { useConfigManager } from '../../../composables/useConfig';
import { useCopyLink } from '../../../composables/useCopyLink';
import { useConfirm } from '../../../composables/useConfirm';
import { useHistoryManager } from '../../../composables/useHistory';
import { formatFileSize } from '../../../utils/formatters';
import { getPrimaryImageUrl } from '../../../utils/imageUrl';
import { getServiceDisplayName } from '../../../constants/serviceNames';
import { buildHistoryFailureLine } from '../../../utils/uploadFailureMessage';

const props = withDefaults(defineProps<{
  visible: boolean;
  item: HistoryItem | null;
  hasPrev?: boolean;
  hasNext?: boolean;
}>(), {
  hasPrev: false,
  hasNext: false,
});

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'delete', item: HistoryItem): void;
  (e: 'navigate', direction: 'prev' | 'next'): void;
  (e: 'toggle-favorite', item: HistoryItem): void;
}>();

const toast = useToast();
const configManager = useConfigManager();
const { copyLink: copyLinkAction, applyPrefix } = useCopyLink();
const { confirmDelete } = useConfirm();
const historyManager = useHistoryManager();

const isItemFavorited = computed(() => {
  if (!props.item) return false;
  return historyManager.favoriteSet.value.has(props.item.id);
});

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});

const formatTime = (timestamp: number) => dateFormatter.format(new Date(timestamp));

const getSuccessfulServices = (item: HistoryItem): string[] =>
  item.results.filter(r => r.status === 'success').map(r => r.serviceId);

const getFailedResults = (item: HistoryItem) =>
  item.results.filter(r => r.status === 'failed');

const successfulServicesText = computed(() => {
  if (!props.item) return '';
  return getSuccessfulServices(props.item).map(serviceId => getServiceDisplayName(serviceId)).join('、');
});

const failedResults = computed(() => {
  if (!props.item) return [];
  return getFailedResults(props.item);
});

const failedServicesText = computed(() =>
  failedResults.value
    .map(result => getServiceDisplayName(result.serviceId))
    .join('、')
);

const failedServicesTooltip = computed(() =>
  failedResults.value
    .map(result => buildHistoryFailureLine(
      getServiceDisplayName(result.serviceId),
      result.error,
      [result.serviceId]
    ))
    .join('；')
);

const lightboxImage = computed(() => {
  if (!props.item) return '';
  return getPrimaryImageUrl(props.item, configManager.config.value);
});

const imageLoading = ref(true);
const imageError = ref(false);
const imageScale = ref(1);
const MIN_SCALE = 0.5;
const MAX_SCALE = 5;

const translateX = ref(0);
const translateY = ref(0);
const isDragging = ref(false);
let dragStartX = 0;
let dragStartY = 0;
let dragStartTranslateX = 0;
let dragStartTranslateY = 0;
let dragMoveDistance = 0;
let dragRafId: number | null = null;

function handleDoubleClick() {
  recentDoubleClick = true;
  setTimeout(() => { recentDoubleClick = false; }, 0);
  if (imageScale.value !== 1) {
    imageScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
  }
}

function handleImgMouseDown(e: MouseEvent) {
  isDragging.value = true;
  dragMoveDistance = 0;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragStartTranslateX = translateX.value;
  dragStartTranslateY = translateY.value;
  e.preventDefault();
}

function handleMouseMove(e: MouseEvent) {
  if (!isDragging.value) return;
  if (dragRafId !== null) return;
  dragRafId = requestAnimationFrame(() => {
    dragRafId = null;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    dragMoveDistance = Math.sqrt(dx * dx + dy * dy);
    translateX.value = dragStartTranslateX + dx;
    translateY.value = dragStartTranslateY + dy;
  });
}

function handleMouseUp() {
  isDragging.value = false;
  // 延迟重置：mouseup → click 序列中，让 closeLightbox 先判断本次是拖拽还是点击
  setTimeout(() => { dragMoveDistance = 0; }, 0);
  if (dragRafId !== null) {
    cancelAnimationFrame(dragRafId);
    dragRafId = null;
  }
}

const imageTransform = computed(() =>
  `translate(${translateX.value}px, ${translateY.value}px) scale(${imageScale.value})`
);

const imageCursor = computed(() =>
  isDragging.value ? 'grabbing' : 'grab'
);

const truncateMiddle = (name: string, maxLen = 42): string => {
  if (name.length <= maxLen) return name;
  const extIdx = name.lastIndexOf('.');
  const ext = extIdx > 0 ? name.slice(extIdx) : '';
  const base = extIdx > 0 ? name.slice(0, extIdx) : name;
  const keep = maxLen - ext.length - 3;
  if (keep <= 0) return name.slice(0, maxLen - 3) + '...';
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return base.slice(0, head) + '...' + base.slice(-tail) + ext;
};

const displayFileName = computed(() => {
  if (!props.item?.localFileName) return '';
  return truncateMiddle(props.item.localFileName);
});

function onImageLoad() {
  imageLoading.value = false;
  imageError.value = false;
}

function onImageError() {
  imageLoading.value = false;
  imageError.value = true;
}

function resetImageState() {
  imageLoading.value = true;
  imageError.value = false;
  imageScale.value = 1;
  translateX.value = 0;
  translateY.value = 0;
}

function requireLink(): { link: string; item: HistoryItem } | null {
  const link = props.item?.generatedLink;
  if (!link || !props.item) {
    toast.warn('无可用链接', '该项目没有可用的链接');
    return null;
  }
  return { link, item: props.item };
}

const handleCopyLink = async () => {
  const ctx = requireLink();
  if (!ctx) return;
  await copyLinkAction({
    url: ctx.link,
    fileName: ctx.item.localFileName,
    serviceId: ctx.item.primaryService as ServiceType,
    width: ctx.item.width,
    height: ctx.item.height,
  });
};

const openInBrowser = async () => {
  const ctx = requireLink();
  if (!ctx) return;
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    const finalUrl = applyPrefix(ctx.link, ctx.item.primaryService as ServiceType);
    await open(finalUrl);
  } catch (error) {
    console.error('[Lightbox] 打开链接失败:', error);
    toast.error('打开失败', String(error));
  }
};

const handleDelete = () => {
  if (!props.item) return;
  resetImageState();
  confirmDelete('确定要删除这条历史记录吗？此操作不可撤销。', () => {
    emit('delete', props.item!);
  });
};

let recentDoubleClick = false;

const closeLightbox = () => {
  if (dragMoveDistance > 5) return;
  if (recentDoubleClick) return;
  emit('update:visible', false);
};

const navigatePrev = () => {
  if (props.hasPrev) emit('navigate', 'prev');
};

const navigateNext = () => {
  if (props.hasNext) emit('navigate', 'next');
};

function handleKeydown(e: KeyboardEvent) {
  if (!props.visible) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') navigatePrev();
  if (e.key === 'ArrowRight') navigateNext();
}

let wheelThrottleTimer: ReturnType<typeof setTimeout> | null = null;

function handleWheel(e: WheelEvent) {
  if (!props.visible) return;
  e.preventDefault();

  if (e.ctrlKey) {
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    imageScale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, imageScale.value + delta));
  } else {
    if (wheelThrottleTimer) return;
    wheelThrottleTimer = setTimeout(() => { wheelThrottleTimer = null; }, 200);
    if (e.deltaY > 0) navigateNext();
    else if (e.deltaY < 0) navigatePrev();
  }
}

function cleanupTimers() {
  if (wheelThrottleTimer) {
    clearTimeout(wheelThrottleTimer);
    wheelThrottleTimer = null;
  }
  if (dragRafId !== null) {
    cancelAnimationFrame(dragRafId);
    dragRafId = null;
  }
  isDragging.value = false;
  dragMoveDistance = 0;
}

watch(() => props.visible, (val) => {
  if (val) resetImageState();
  else cleanupTimers();
});

watch(() => props.item?.id, () => {
  if (props.visible) resetImageState();
});

onMounted(() => window.addEventListener('keydown', handleKeydown));
onUnmounted(() => window.removeEventListener('keydown', handleKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="lightbox-fade">
      <div v-if="visible" class="lightbox-overlay" @click="closeLightbox" @wheel.prevent="handleWheel" @mousemove="handleMouseMove" @mouseup="handleMouseUp">
        <div
          v-if="lightboxImage"
          class="lightbox-bg"
          :style="{ backgroundImage: `url(${lightboxImage})` }"
        ></div>
        <div class="lightbox-bg-dim"></div>

        <button class="lightbox-close" @click.stop="closeLightbox">
          <i class="pi pi-times"></i>
        </button>

        <button
          v-if="hasPrev"
          class="lightbox-nav lightbox-nav-prev"
          @click.stop="navigatePrev"
        >
          <i class="pi pi-chevron-left"></i>
        </button>

        <div class="lightbox-content" @click.stop @dblclick.prevent="handleDoubleClick">
          <Transition name="lightbox-loader">
            <div v-if="imageLoading && !imageError" class="lightbox-loading-overlay">
              <div class="lightbox-breathe-container">
                <i class="pi pi-image lightbox-breathe-icon"></i>
              </div>
              <span class="lightbox-loading-text">加载中…</span>
            </div>
          </Transition>

          <div v-if="imageError" class="lightbox-error">
            <i class="pi pi-image"></i>
            <span>图片加载失败，可能已过期</span>
          </div>
          <img
            v-show="!imageError"
            :src="lightboxImage"
            :class="['lightbox-img', { 'lightbox-img-loaded': !imageLoading }]"
            :style="{ transform: imageTransform, cursor: imageCursor }"
            @load="onImageLoad"
            @error="onImageError"
            @mousedown="handleImgMouseDown"
          />

        </div>

        <button
          v-if="hasNext"
          class="lightbox-nav lightbox-nav-next"
          @click.stop="navigateNext"
        >
          <i class="pi pi-chevron-right"></i>
        </button>

        <div v-if="item" class="lightbox-bottom" @click.stop>
          <div class="lightbox-info-cell cell-filename">
            <span class="cell-value filename-value" :title="item.localFileName">{{ displayFileName }}</span>
            <span class="cell-label">文件名</span>
          </div>
          <div class="lightbox-divider"></div>
          <div class="lightbox-info-cell cell-time">
            <span class="cell-value">{{ formatTime(item.timestamp) }}</span>
            <span class="cell-label">上传时间</span>
          </div>
          <div class="lightbox-divider"></div>
          <div class="lightbox-info-cell cell-size">
            <span class="cell-value">{{ formatFileSize(item.fileSize ?? 0) }}</span>
            <span class="cell-label">文件大小</span>
          </div>
          <div class="lightbox-divider"></div>
          <div
            class="lightbox-info-cell cell-source"
            v-tooltip.top="successfulServicesText"
          >
            <span class="cell-value source-value">{{ successfulServicesText }}</span>
            <span class="cell-label">已传图床</span>
          </div>
          <template v-if="failedResults.length > 0">
            <div class="lightbox-divider"></div>
            <div
              class="lightbox-info-cell cell-failed"
              v-tooltip.top="failedServicesTooltip"
            >
              <span class="cell-value source-value">{{ failedServicesText }}</span>
              <span class="cell-label">失败图床</span>
            </div>
          </template>
          <div class="lightbox-actions">
            <button
              class="action-btn"
              :class="{ 'action-btn-favorited': isItemFavorited }"
              @click="emit('toggle-favorite', item)"
              v-tooltip.top="isItemFavorited ? '取消收藏' : '收藏'"
            >
              <i :class="isItemFavorited ? 'pi pi-star-fill' : 'pi pi-star'"></i>
            </button>
            <button class="action-btn" @click="handleCopyLink" v-tooltip.top="'复制链接'">
              <i class="pi pi-copy"></i>
            </button>
            <button class="action-btn" @click="openInBrowser" v-tooltip.top="'在浏览器打开'">
              <i class="pi pi-external-link"></i>
            </button>
            <button class="action-btn action-btn-danger" @click="handleDelete" v-tooltip.top="'删除记录'">
              <i class="pi pi-trash"></i>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lightbox-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-lightbox);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding-bottom: 64px; /* 预留底栏空间，图片在底栏上方区域居中 */
}

.lightbox-bg {
  position: absolute;
  inset: -60px;
  background-size: cover;
  background-position: center;
  filter: blur(40px) brightness(0.35) saturate(1.2);
  transform: scale(1.15);
}

.lightbox-bg-dim {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.25);
}

.lightbox-close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 3;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: var(--hover-overlay);
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.15;
  transition: opacity 0.25s ease, background 0.2s ease, color 0.2s ease;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.lightbox-close:hover {
  opacity: 1;
  color: var(--text-main);
}

.lightbox-nav {
  position: absolute;
  top: calc(50% - 32px);
  transform: translateY(-50%);
  z-index: 3;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  background: var(--hover-overlay);
  color: var(--text-muted);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.lightbox-nav-prev { left: 20px; }
.lightbox-nav-next { right: 20px; }

.lightbox-nav:hover {
  color: var(--text-main);
  transform: translateY(-50%) scale(1.08);
}

.lightbox-content {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  max-width: calc(100vw - 160px);
  max-height: calc(100vh - 64px - 48px); /* 底栏64 + 上下留白48 */
  min-width: 200px;
  min-height: 200px;
}

.lightbox-img {
  max-width: calc(100vw - 160px);
  max-height: calc(100vh - 64px - 48px);
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
  opacity: 0;
  transition: opacity 0.3s ease, transform 0.1s ease-out;
  user-select: none;
}

.lightbox-img-loaded {
  opacity: 1;
}

.lightbox-loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  z-index: 1;
}

.lightbox-breathe-container {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--hover-overlay-subtle);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--border-subtle);
}

.lightbox-breathe-icon {
  font-size: 1.5rem;
  color: var(--text-muted);
  animation: lightbox-breathe 3s ease-in-out infinite;
}

@keyframes lightbox-breathe {
  0%, 100% {
    opacity: 0.3;
    transform: scale(0.98);
    filter: drop-shadow(0 0 0 rgba(255, 255, 255, 0));
  }
  50% {
    opacity: 0.8;
    transform: scale(1);
    filter: drop-shadow(0 0 15px rgba(255, 255, 255, 0.4));
  }
}

.lightbox-loading-text {
  font-size: var(--text-base);
  color: var(--text-tertiary);
  letter-spacing: 0.05em;
}

/* Loading overlay 淡入淡出 */
.lightbox-loader-enter-active,
.lightbox-loader-leave-active {
  transition: opacity 0.3s ease;
}

.lightbox-loader-enter-from,
.lightbox-loader-leave-to {
  opacity: 0;
}

.lightbox-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  color: var(--text-muted);
}

.lightbox-error i {
  font-size: 3rem;
  color: var(--error);
}

.lightbox-error span {
  font-size: 14px;
}

.lightbox-bottom {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 3;
  height: 64px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  box-shadow: 0 -1px 0 0 rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  padding: 0 24px;
  cursor: default;
}

.lightbox-info-cell {
  display: flex;
  flex-direction: column;
  padding: 0 16px;
  gap: 3px;
  min-width: 0;
  flex-shrink: 0;
}

.cell-filename {
  flex: 5;
  flex-shrink: 1;
  padding-left: 0;
}

.cell-time {
  flex: 2;
}

.cell-size {
  flex: 1;
}

.cell-source {
  flex: 1.5;
  flex-shrink: 1;
}

.cell-failed {
  flex: 1.6;
  flex-shrink: 1;
}

.cell-value {
  color: var(--text-main);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}

.source-value,
.filename-value {
  overflow: hidden;
  text-overflow: ellipsis;
}

.cell-label {
  color: var(--text-tertiary);
  font-size: 11px;
  letter-spacing: 0.02em;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}

.lightbox-divider {
  width: 1px;
  height: 28px;
  background: var(--border-subtle);
  flex-shrink: 0;
}

.lightbox-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding-left: 16px;
}

.action-btn {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  border: none;
  background: var(--hover-overlay-subtle);
  color: var(--text-muted);
  font-size: 15px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.action-btn:hover {
  background: var(--hover-overlay);
  color: var(--text-main);
}

.action-btn-favorited {
  color: var(--warning) !important;
}

.action-btn-favorited:hover {
  background: var(--warning-alpha-15) !important;
}

.action-btn-danger {
  color: var(--error);
}

.action-btn-danger:hover {
  background: var(--error-soft);
  color: var(--error);
}

/* 浅色模式：灯箱始终保持暗色风格，重新绑定为暗色变量值（来源：style.css :root） */
:root.light-theme .lightbox-overlay {
  --text-main: #f8fafc;
  --text-muted: #94a3b8;
  --text-tertiary: #64748b;
  --hover-overlay: rgba(255, 255, 255, 0.08);
  --hover-overlay-subtle: rgba(255, 255, 255, 0.04);
  --border-subtle: #334155;
  --error: #ef4444;
  --error-soft: rgba(239, 68, 68, 0.15);
}

.lightbox-fade-enter-active {
  transition: opacity 0.25s ease;
}

.lightbox-fade-leave-active {
  transition: opacity 0.2s ease;
}

.lightbox-fade-enter-from,
.lightbox-fade-leave-to {
  opacity: 0;
}
</style>
