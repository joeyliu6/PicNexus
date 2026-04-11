<script setup lang="ts">
import Skeleton from 'primevue/skeleton';
import type { ImageMeta } from '../../../types/image-meta';

type ImageState = 'loading' | 'loaded' | 'failed' | undefined;

defineProps<{
  meta: ImageMeta;
  thumbnailUrl: string;
  imageState: ImageState;
  selected: boolean;
}>();

const emit = defineEmits<{
  click: [];
  'toggle-select': [];
  'toggle-favorite': [];
  'image-state-change': [state: 'loaded' | 'failed'];
}>();
</script>

<template>
  <div
    class="photo-item"
    :class="{ selected }"
    @click="emit('click')"
  >
    <!-- 加载骨架 -->
    <Skeleton
      v-if="imageState !== 'loaded' && imageState !== 'failed'"
      width="100%"
      height="100%"
      border-radius="8px"
      class="photo-skeleton"
    />

    <!-- 加载失败占位 -->
    <div v-if="imageState === 'failed'" class="photo-error">
      <i class="pi pi-image"></i>
    </div>

    <!-- 图片 -->
    <img
      v-if="imageState !== 'failed'"
      :src="thumbnailUrl"
      class="photo-img"
      :class="{ loaded: imageState === 'loaded' }"
      loading="lazy"
      @load="emit('image-state-change', 'loaded')"
      @error="emit('image-state-change', 'failed')"
    />

    <!-- 选中遮罩 -->
    <div class="selection-overlay"></div>

    <!-- 复选框 -->
    <div
      class="checkbox"
      :class="{ checked: selected }"
      @click.stop="emit('toggle-select')"
    >
      <i v-if="selected" class="pi pi-check"></i>
    </div>

    <!-- 收藏按钮（收藏视图中始终为已收藏状态） -->
    <div
      class="favorite-btn favorited"
      @click.stop="emit('toggle-favorite')"
    >
      <i class="pi pi-star-fill"></i>
    </div>
  </div>
</template>

<style scoped>
/* === 图片项 === */
.photo-item {
  position: relative;
  aspect-ratio: 1;
  background: var(--bg-secondary);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  will-change: transform;
}

.photo-skeleton {
  position: absolute !important;
  inset: 0;
  z-index: 1;
}

.photo-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  color: var(--text-muted);
  opacity: 0.6;
}

.photo-error i {
  font-size: var(--text-2xl);
}

.photo-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity var(--duration-medium) ease-in-out, transform var(--duration-medium);
}

.photo-img.loaded {
  opacity: 1;
}

.photo-item:hover .photo-img.loaded {
  transform: scale(1.03);
}

/* 选中遮罩 */
.selection-overlay {
  position: absolute;
  inset: 0;
  background: var(--overlay-light);
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

/* 复选框 */
.checkbox {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid var(--photo-overlay-border);
  background: var(--photo-overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all var(--duration-normal);
  z-index: 2;
}

.photo-item:hover .checkbox,
.checkbox.checked {
  opacity: 1;
}

.checkbox:hover {
  background: var(--photo-overlay-bg-hover);
}

.checkbox.checked {
  background: var(--primary);
  border-color: var(--primary);
}

.checkbox.checked i {
  font-size: var(--text-2xs);
  color: white;
  font-weight: bold;
}

/* 收藏按钮 */
.favorite-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  color: var(--photo-overlay-border);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all var(--duration-normal);
  z-index: 2;
  cursor: pointer;
  font-size: var(--text-2xs-xs);
  filter: drop-shadow(0 1px 2px var(--photo-overlay-bg-hover));
}

.photo-item:hover .favorite-btn,
.favorite-btn.favorited {
  opacity: 1;
}

.favorite-btn.favorited {
  color: var(--warning);
  filter: drop-shadow(0 1px 3px rgb(234 179 8 / 40%));
}

.favorite-btn:hover {
  transform: scale(1.15);
}

.favorite-btn.favorited:hover {
  filter: drop-shadow(0 1px 4px rgb(234 179 8 / 60%));
}
</style>
