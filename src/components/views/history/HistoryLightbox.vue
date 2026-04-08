<script setup lang="ts">
import { computed, toRef } from 'vue';
import type { HistoryItem } from '../../../config/types';
import { useConfigManager } from '../../../composables/useConfig';
import { useHistoryManager } from '../../../composables/useHistory';
import { useLightboxZoom } from '../../../composables/history/useLightboxZoom';
import { useLightboxImage } from '../../../composables/history/useLightboxImage';
import { useLightboxActions } from '../../../composables/history/useLightboxActions';
import { useLightboxInfo } from '../../../composables/history/useLightboxInfo';
import { useLightboxKeyboard } from '../../../composables/history/useLightboxKeyboard';
import { getPrimaryImageUrl } from '../../../utils/imageUrl';
import LightboxBottomBar from './LightboxBottomBar.vue';

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

const configManager = useConfigManager();
const historyManager = useHistoryManager();
const itemRef = computed(() => props.item);

// ── 缩放 & 拖拽 ────────────────────────────
const {
  imageTransform,
  imageCursor,
  resetZoom,
  handleDoubleClick,
  handleImgMouseDown,
  handleMouseMove,
  handleMouseUp,
  applyWheelZoom,
  isDragMove,
  isRecentDoubleClick,
  cleanupDrag,
} = useLightboxZoom();

// ── 图片预加载 ──────────────────────────────
const lightboxImage = computed(() => {
  if (!props.item) return '';
  return getPrimaryImageUrl(props.item, configManager.config.value);
});

const itemId = computed(() => props.item?.id);

const {
  displaySrc,
  imageReady,
  showLoadingIndicator,
  imageError,
  onImageError,
  cleanupPreload,
} = useLightboxImage(lightboxImage, toRef(props, 'visible'), itemId, resetZoom);

// ── 收藏状态 ────────────────────────────────
const isItemFavorited = computed(() => {
  if (!props.item) return false;
  return historyManager.favoriteSet.value.has(props.item.id);
});

// ── 信息展示 ────────────────────────────────
const {
  displayFileName,
  successfulServicesText,
  failedResults,
  failedServicesText,
  failedServicesTooltip,
} = useLightboxInfo(itemRef);

// ── 操作 ────────────────────────────────────
const { handleCopyLink, openInBrowser, handleDelete } = useLightboxActions({
  item: itemRef,
  resetZoom,
  onDelete: (record) => emit('delete', record),
});

// ── 键盘 & 滚轮 & 导航 ─────────────────────
const { closeLightbox, navigatePrev, navigateNext, handleWheel } = useLightboxKeyboard({
  visible: toRef(props, 'visible'),
  hasPrev: toRef(props, 'hasPrev'),
  hasNext: toRef(props, 'hasNext'),
  isDragMove,
  isRecentDoubleClick,
  applyWheelZoom,
  cleanupDrag,
  cleanupPreload,
  emitClose: () => emit('update:visible', false),
  emitNavigate: (dir) => emit('navigate', dir),
});
</script>

<template>
  <Teleport to="body">
    <Transition name="lightbox-fade">
      <div v-if="visible" class="lightbox-overlay" @click="closeLightbox" @wheel.prevent="handleWheel" @mousemove="handleMouseMove" @mouseup="handleMouseUp">
        <div
          v-if="displaySrc"
          class="lightbox-bg"
          :style="{ backgroundImage: `url(${displaySrc})` }"
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
            <div v-if="showLoadingIndicator && !imageError" class="lightbox-loading-overlay">
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
            v-show="!imageError && displaySrc"
            :src="displaySrc"
            :class="['lightbox-img', { 'lightbox-img-loaded': imageReady }]"
            :style="{ transform: imageTransform, cursor: imageCursor }"
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

        <LightboxBottomBar
          v-if="item"
          :item="item"
          :display-file-name="displayFileName"
          :successful-services-text="successfulServicesText"
          :failed-results="failedResults"
          :failed-services-text="failedServicesText"
          :failed-services-tooltip="failedServicesTooltip"
          :is-item-favorited="isItemFavorited"
          @copy-link="handleCopyLink"
          @open-browser="openInBrowser"
          @delete="handleDelete"
          @toggle-favorite="emit('toggle-favorite', item)"
        />
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
  transition: opacity var(--duration-normal) ease, background var(--duration-normal) ease, color var(--duration-normal) ease;
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
  transition: all var(--duration-normal) ease;
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
  transition: opacity var(--duration-medium) ease, transform var(--duration-micro) ease-out;
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
  /* TODO: 3s 无对应动效变量（最大为 --duration-breathe: 2000ms），暂保留硬编码 */
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
  transition: opacity var(--duration-medium) ease;
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
  transition: opacity var(--duration-normal) ease;
}

.lightbox-fade-leave-active {
  transition: opacity var(--duration-normal) ease;
}

.lightbox-fade-enter-from,
.lightbox-fade-leave-to {
  opacity: 0;
}
</style>
