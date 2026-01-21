<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import Button from 'primevue/button';
import SplitButton from 'primevue/splitbutton';
import Skeleton from 'primevue/skeleton';
import CopyableUrl from './CopyableUrl.vue';
import type { StorageObject, LinkFormat } from '../types';

const props = defineProps<{
  file: StorageObject | null;
  visible: boolean;
}>();

const emit = defineEmits<{
  close: [];
  download: [file: StorageObject];
  delete: [file: StorageObject];
  copyLink: [file: StorageObject, format: LinkFormat];
}>();

// ESC 键关闭面板或 Lightbox
const lightboxOpen = ref(false);

// 图片加载状态
const imageLoading = ref(true);
const imageError = ref(false);

watch(() => props.file, () => {
  imageLoading.value = true;
  imageError.value = false;
});

const handleImageLoad = () => {
  imageLoading.value = false;
};

const handleImageError = () => {
  imageLoading.value = false;
  imageError.value = true;
};

const openLightbox = () => {
  lightboxOpen.value = true;
};

const closeLightbox = () => {
  lightboxOpen.value = false;
};

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    if (lightboxOpen.value) {
      closeLightbox();
    } else if (props.visible) {
      emit('close');
    }
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});

const isImage = computed(() => {
  if (!props.file || props.file.type === 'folder') return false;
  const ext = props.file.name.split('.').pop()?.toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext || '');
});

// 获取路径前缀（用户名/目录）
const getPathPrefix = (key: string): string => {
  const parts = key.split('/');
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
};

// 中间省略文件名
const truncateMiddle = (str: string, maxLen: number): string => {
  if (str.length <= maxLen) return str;
  const half = Math.floor((maxLen - 3) / 2);
  return str.slice(0, half) + '...' + str.slice(-half);
};

// 获取文件扩展名（大写）
const getFileType = computed(() => {
  if (!props.file) return '';
  const ext = props.file.name.split('.').pop()?.toUpperCase();
  return ext || 'FILE';
});

// 复制格式菜单
const copyFormats = computed(() => [
  {
    label: 'URL',
    icon: 'pi pi-link',
    command: () => props.file && emit('copyLink', props.file, 'url')
  },
  {
    label: 'HTML',
    icon: 'pi pi-code',
    command: () => props.file && emit('copyLink', props.file, 'html')
  },
  {
    label: 'BBCode',
    icon: 'pi pi-hashtag',
    command: () => props.file && emit('copyLink', props.file, 'bbcode')
  }
]);

// 默认复制 Markdown
const handleDefaultCopy = () => {
  if (props.file) {
    emit('copyLink', props.file, 'markdown');
  }
};

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

const formatDate = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${d} ${h}:${min}`;
};

const handleOverlayClick = (e: MouseEvent) => {
  if ((e.target as HTMLElement).classList.contains('drawer-overlay')) {
    emit('close');
  }
};
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div
        v-if="visible && file"
        class="drawer-overlay"
        @click="handleOverlayClick"
      >
        <div class="drawer-panel" @click.stop>
          <!-- 标题区：路径 + 文件名分层 -->
          <div class="drawer-title-section">
            <span v-if="getPathPrefix(file.key)" class="path-breadcrumb">{{ getPathPrefix(file.key) }}</span>
            <span class="file-title" :title="file.name">{{ truncateMiddle(file.name, 28) }}</span>
          </div>

          <div class="drawer-content">
            <!-- 毛玻璃图片预览 -->
            <div
              v-if="isImage && file.url"
              class="preview-section"
              @click="!imageLoading && !imageError && openLightbox()"
            >
              <div class="preview-blur-bg" :style="{ backgroundImage: `url(${file.url})` }"></div>

              <!-- 骨架屏：图片加载中显示 -->
              <div v-if="imageLoading" class="skeleton-wrapper">
                <Skeleton width="100%" height="200px" borderRadius="8px" />
              </div>

              <!-- 实际图片 -->
              <img
                v-show="!imageLoading && !imageError"
                :src="file.url"
                :alt="file.name"
                class="preview-image"
                @load="handleImageLoad"
                @error="handleImageError"
              />

              <!-- 加载失败提示 -->
              <div v-if="imageError" class="image-error">
                <i class="pi pi-image" />
                <span>图片加载失败</span>
              </div>
            </div>

            <!-- 链接输入框 -->
            <div v-if="file.url" class="url-section">
              <CopyableUrl :url="file.url" @copy="emit('copyLink', file, 'url')" />
            </div>

            <!-- 操作按钮区：主按钮 + 删除图标 -->
            <div v-if="file.url" class="action-row">
              <SplitButton
                label="复制 Markdown"
                icon="pi pi-code"
                :model="copyFormats"
                @click="handleDefaultCopy"
                class="copy-split-btn"
              />
              <Button
                icon="pi pi-trash"
                class="btn-icon btn-delete"
                @click="emit('delete', file)"
                v-tooltip.bottom="'删除'"
              />
            </div>

            <!-- 元数据区：底部三列布局 -->
            <div class="metadata-section">
              <div class="metadata-divider"></div>
              <div class="metadata-grid">
                <div class="meta-item">
                  <span class="meta-label">类型</span>
                  <span class="meta-value">{{ getFileType }}</span>
                </div>
                <div class="meta-item">
                  <span class="meta-label">大小</span>
                  <span class="meta-value">{{ formatSize(file.size) }}</span>
                </div>
                <div class="meta-item">
                  <span class="meta-label">时间</span>
                  <span class="meta-value">{{ formatDate(file.lastModified) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Lightbox 放大预览 -->
    <Transition name="fade">
      <div
        v-if="lightboxOpen && file?.url"
        class="lightbox-overlay"
        @click="closeLightbox"
      >
        <div class="lightbox-blur-bg" :style="{ backgroundImage: `url(${file.url})` }"></div>
        <img :src="file.url" :alt="file.name" class="lightbox-image" @click.stop />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
}

.drawer-panel {
  width: 400px;
  max-width: 90vw;
  height: 100%;
  background: var(--bg-card);
  border-left: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-modal);
}

/* 标题区：分层显示 */
.drawer-title-section {
  padding: 32px 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}

.path-breadcrumb {
  font-size: 12px;
  color: var(--primary);
  font-weight: 400;
}

.file-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  word-break: break-all;
  line-height: 1.4;
}

.drawer-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 24px 24px;
  display: flex;
  flex-direction: column;
}

/* 毛玻璃图片预览 */
.preview-section {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 20px;
  min-height: 200px;
  max-height: 360px;
  overflow: hidden;
  cursor: pointer;
  border: none;
}

.preview-blur-bg {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  filter: blur(30px) brightness(0.6);
  transform: scale(1.3);
  z-index: 1;
}

.preview-image {
  position: relative;
  z-index: 2;
  max-width: 100%;
  max-height: 300px;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: var(--shadow-float);
}

/* 骨架屏包装器 - 填满整个预览区域 */
.skeleton-wrapper {
  position: absolute;
  inset: 0;
  z-index: 2;
  border-radius: 12px;
  overflow: hidden;
}

.skeleton-wrapper :deep(.p-skeleton) {
  width: 100% !important;
  height: 100% !important;
  border-radius: 12px;
}

/* 图片加载失败 */
.image-error {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
}

.image-error i {
  font-size: 32px;
}

/* 链接输入框区 */
.url-section {
  margin-bottom: 16px;
}

/* 操作按钮区 */
.action-row {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.copy-split-btn {
  flex: 1;
}

:deep(.copy-split-btn .p-splitbutton-button) {
  flex: 1;
}

:deep(.copy-split-btn .p-splitbutton-dropdown) {
  border-left: 1px solid rgba(255, 255, 255, 0.3);
}

.btn-icon {
  width: 44px !important;
  height: 44px !important;
  border-radius: 8px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  background: var(--bg-input) !important;
  border: 1px solid var(--border-subtle) !important;
  color: var(--text-secondary) !important;
  flex-shrink: 0;
}

.btn-icon:hover {
  background: var(--hover-overlay) !important;
}

.btn-delete:hover {
  background: var(--state-error-bg) !important;
  border-color: var(--error) !important;
  color: var(--error) !important;
}

/* 元数据区 */
.metadata-section {
  margin-top: auto;
  padding: 12px 24px;
  margin-left: -24px;
  margin-right: -24px;
  margin-bottom: -24px;
  background: var(--bg-surface, #f8f9fa);
  border-top: 1px solid var(--border-subtle);
}

.metadata-divider {
  display: none;
}

.metadata-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 4px;
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.meta-label {
  font-size: 12px;
  color: var(--text-muted);
}

.meta-value {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
}

/* Lightbox 放大预览 */
.lightbox-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.lightbox-blur-bg {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  filter: blur(50px) brightness(0.4);
  transform: scale(1.2);
}

.lightbox-image {
  position: relative;
  z-index: 1;
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: var(--shadow-modal);
  cursor: default;
}

/* 滚动条样式 */
.drawer-content::-webkit-scrollbar {
  width: 6px;
}

.drawer-content::-webkit-scrollbar-track {
  background: transparent;
}

.drawer-content::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 3px;
}

.drawer-content::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}

/* 动画 */
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.25s ease;
}

.drawer-enter-active .drawer-panel,
.drawer-leave-active .drawer-panel {
  transition: transform 0.25s ease;
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer-enter-from .drawer-panel,
.drawer-leave-to .drawer-panel {
  transform: translateX(100%);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 480px) {
  .drawer-panel {
    width: 100%;
  }
}
</style>
