<script setup lang="ts">
/**
 * TimelinePhotoItem - 单张图片组件
 * 处理：悬停信息、选择状态、图片加载、点击事件
 */
import { computed } from 'vue';
import Skeleton from 'primevue/skeleton';
import type { ImageMeta } from '../../../types/image-meta';
import type { HistoryItem } from '../../../config/types';
import { formatFileSize, formatUploadTime } from '../../../utils/formatters';
import { getServiceDisplayName } from '../../../constants/serviceNames';

const props = defineProps<{
  meta: ImageMeta;
  x: number;
  y: number;
  width: number;
  height: number;
  isSelected: boolean;
  isLoaded: boolean;
  displayMode: 'fast' | 'smooth' | 'normal';
  thumbnailUrl: string;
  hoverDetail?: HistoryItem;
}>();

const emit = defineEmits<{
  (e: 'click'): void;
  (e: 'toggle-select'): void;
  (e: 'hover'): void;
  (e: 'image-load'): void;
  (e: 'image-error', event: Event): void;
}>();

const successfulServices = computed(() => {
  if (!props.hoverDetail) return [];
  return props.hoverDetail.results
    .filter(r => r.status === 'success')
    .map(r => r.serviceId);
});
</script>

<template>
  <div
    class="photo-item"
    :class="{ selected: isSelected }"
    :style="{
      transform: `translate3d(${x}px, ${y}px, 0)`,
      width: `${width}px`,
      height: `${height}px`,
    }"
    @mouseenter="emit('hover')"
  >
    <div class="photo-wrapper" @click="emit('click')">
      <!-- 图片未加载时显示 Skeleton 占位 -->
      <Skeleton
        v-if="!isLoaded"
        width="100%"
        height="100%"
        borderRadius="8px"
        class="photo-skeleton"
      />

      <!-- 图片 - 快速滚动时不加载新图片，但已加载的始终显示 -->
      <img
        v-if="thumbnailUrl && (isLoaded || displayMode !== 'fast')"
        :src="thumbnailUrl"
        class="photo-img"
        :class="{ loaded: isLoaded }"
        @load="emit('image-load')"
        @error="emit('image-error', $event)"
      />

      <!-- Selection Overlay -->
      <div class="selection-overlay"></div>

      <!-- Checkbox -->
      <div
        class="checkbox"
        :class="{ checked: isSelected }"
        @click.stop="emit('toggle-select')"
      >
        <i v-if="isSelected" class="pi pi-check"></i>
      </div>

      <!-- 悬停信息层 -->
      <div class="hover-info" v-if="hoverDetail">
        <div class="hover-info-top">
          <span class="file-name" :title="hoverDetail.localFileName">
            {{ hoverDetail.localFileName }}
          </span>
        </div>
        <div class="hover-info-bottom">
          <div class="info-row">
            <i class="pi pi-file"></i>
            <span class="file-size">{{ formatFileSize(hoverDetail.fileSize ?? 0) }}</span>
          </div>
          <div class="info-row">
            <i class="pi pi-clock"></i>
            <span class="upload-time">{{ formatUploadTime(meta.timestamp) }}</span>
          </div>
          <div class="service-badges" v-if="successfulServices.length > 0">
            <span
              v-for="service in successfulServices"
              :key="service"
              class="service-badge"
              :title="`已上传到 ${getServiceDisplayName(service)}`"
            >
              {{ getServiceDisplayName(service) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.photo-item {
  position: absolute;
  background: var(--bg-secondary);
  border-radius: 8px;
  overflow: hidden;
  will-change: transform;
}

.photo-wrapper {
  width: 100%;
  height: 100%;
  cursor: pointer;
  position: relative;
}

.photo-skeleton {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.photo-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.3s ease-in-out, transform 0.3s;
}

.photo-img.loaded {
  opacity: 1;
}

.photo-wrapper:hover .photo-img.loaded {
  transform: scale(1.03);
}

.selection-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.1);
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
}

.photo-item.selected .selection-overlay {
  opacity: 1;
  background: rgba(59, 130, 246, 0.2);
  border: 2px solid var(--primary);
  border-radius: 8px;
}

.checkbox {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.8);
  background: rgba(0, 0, 0, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all 0.2s;
  z-index: 2;
}

.photo-wrapper:hover .checkbox,
.checkbox.checked {
  opacity: 1;
}

.checkbox:hover {
  background: rgba(0, 0, 0, 0.4);
}

.checkbox.checked {
  background: var(--primary);
  border-color: var(--primary);
}

.checkbox.checked i {
  font-size: 10px;
  color: white;
  font-weight: bold;
}

.hover-info {
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, transparent 30%, rgba(0, 0, 0, 0.85) 100%);
  opacity: 0;
  transition: opacity 0.2s ease;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 10px;
  pointer-events: none;
  color: white;
  border-radius: 8px;
}

.photo-wrapper:hover .hover-info {
  opacity: 1;
}

.hover-info-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.file-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.hover-info-bottom {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  opacity: 0.95;
}

.info-row i {
  font-size: 10px;
  opacity: 0.8;
}

.service-badges {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 2px;
}

.service-badge {
  padding: 3px 7px;
  background: rgba(59, 130, 246, 0.85);
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(4px);
}

/* 响应式适配 */
@media (max-width: 768px) {
  .hover-info {
    padding: 8px;
  }

  .file-name {
    font-size: 12px;
  }

  .info-row {
    font-size: 10px;
  }

  .service-badge {
    font-size: 9px;
    padding: 2px 5px;
  }
}

@media (max-width: 480px) {
  .hover-info-bottom {
    gap: 4px;
  }

  .service-badges {
    display: none;
  }
}

@media (hover: none) {
  .hover-info {
    display: none;
  }

  .checkbox {
    width: 32px;
    height: 32px;
  }
}
</style>
