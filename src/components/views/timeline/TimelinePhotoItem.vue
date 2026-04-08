<script setup lang="ts">
/**
 * TimelinePhotoItem - 单张图片组件
 * 处理：悬停信息、选择状态、图片加载、点击事件
 */
import { computed } from 'vue';
import Skeleton from 'primevue/skeleton';
import type { ImageMeta } from '../../../types/image-meta';
import type { HistoryItem } from '../../../config/types';
import { getServiceDisplayName } from '../../../constants/serviceNames';
import { getServiceIcon } from '../../../utils/icons';

const props = defineProps<{
  meta: ImageMeta;
  x: number;
  y: number;
  width: number;
  height: number;
  isSelected: boolean;
  isFavorited: boolean;
  isLoaded: boolean;
  isFailed: boolean;
  displayMode: 'fast' | 'smooth' | 'normal';
  thumbnailUrl: string;
  hoverDetail?: HistoryItem;
}>();

const emit = defineEmits<{
  (e: 'click'): void;
  (e: 'toggle-select'): void;
  (e: 'toggle-favorite'): void;
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
      <!-- 加载失败占位 -->
      <div v-if="isFailed" class="photo-error">
        <i class="pi pi-image"></i>
      </div>

      <!-- 图片未加载时显示 Skeleton 占位 -->
      <Skeleton
        v-else-if="!isLoaded"
        width="100%"
        height="100%"
        borderRadius="8px"
        class="photo-skeleton"
      />

      <!-- 图片 - 快速滚动时不加载新图片，但已加载的始终显示 -->
      <img
        v-if="!isFailed && thumbnailUrl && (isLoaded || displayMode !== 'fast')"
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

      <!-- Favorite Button -->
      <div
        class="favorite-btn"
        :class="{ favorited: isFavorited }"
        @click.stop="emit('toggle-favorite')"
      >
        <i :class="isFavorited ? 'pi pi-star-fill' : 'pi pi-star'"></i>
      </div>

      <!-- 悬停信息层 -->
      <div class="hover-info" v-if="hoverDetail && successfulServices.length > 0">
        <div class="service-badges">
          <span
            v-for="service in successfulServices"
            :key="service"
            class="service-badge"
            :title="`已上传到 ${getServiceDisplayName(service)}`"
          >
            <span class="badge-icon" v-html="getServiceIcon(service)" />
            {{ getServiceDisplayName(service) }}
          </span>
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

.photo-error {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  border-radius: 8px;
  color: var(--text-muted);
  opacity: 0.6;
}

.photo-error i {
  font-size: 1.5rem;
}

.photo-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity var(--duration-medium) ease-in-out, transform var(--duration-medium);
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
  transition: opacity var(--duration-normal);
  pointer-events: none;
}

.photo-item.selected .selection-overlay {
  opacity: 1;
  background: var(--primary-alpha-20);
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
  transition: all var(--duration-normal);
  z-index: 2;
}

.checkbox::before {
  content: '';
  position: absolute;
  inset: -8px;
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

.favorite-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  color: rgba(255, 255, 255, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all var(--duration-normal);
  z-index: 2;
  cursor: pointer;
  font-size: var(--text-2xs-xs);
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}

.favorite-btn::before {
  content: '';
  position: absolute;
  inset: -8px;
}

.photo-wrapper:hover .favorite-btn,
.favorite-btn.favorited {
  opacity: 1;
}

.favorite-btn.favorited {
  color: var(--warning);
  filter: drop-shadow(0 1px 3px rgba(234, 179, 8, 0.4));
}

.favorite-btn:hover {
  transform: scale(1.15);
}

.favorite-btn.favorited:hover {
  filter: drop-shadow(0 1px 4px rgba(234, 179, 8, 0.6));
}

.favorite-btn.favorited i {
  animation: k-pop 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
}

@media (prefers-reduced-motion: reduce) {
  .favorite-btn.favorited i {
    animation: none;
  }
}

.hover-info {
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, transparent 30%, rgba(0, 0, 0, 0.85) 100%);
  opacity: 0;
  transition: opacity var(--duration-normal) ease;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 10px;
  pointer-events: none;
  color: white;
  border-radius: 8px;
}

.photo-wrapper:hover .hover-info {
  opacity: 1;
}

.service-badges {
  display: flex;
  gap: 4px;
  flex-wrap: wrap-reverse;
  justify-content: flex-end;
  transform: translateY(4px);
  transition: transform var(--duration-normal) ease;
}

.photo-wrapper:hover .hover-info .service-badges {
  transform: translateY(0);
}

.service-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  background: rgb(89 92 96 / 50%);
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(4px);
}

.badge-icon {
  width: 14px;
  height: 14px;
  display: inline-flex;
  flex-shrink: 0;
}

.badge-icon :deep(svg) {
  width: 14px;
  height: 14px;
}

/* 响应式适配 */
@media (max-width: 768px) {
  .hover-info {
    padding: 8px;
  }

  .service-badge {
    font-size: 9px;
    padding: 2px 5px;
  }

}

@media (max-width: 480px) {
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
