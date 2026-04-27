<script setup lang="ts">
/**
 * TimelinePhotoItem - 单张图片组件
 * 处理：选择状态、图片加载、点击事件
 *
 * 两种交互模式（参考 Google Photos）：
 * - 普通模式（hasSelection=false）：点击图片 = 打开灯箱
 * - 选择模式（hasSelection=true）：点击图片 = 选中/取消，放大镜打开灯箱
 *
 * 镜像 fallback：thumbnailUrls 按优先级排列（主服务在前），主图 onerror
 * 时自动试下一条，全部失效后才向父视图 emit image-error。
 */
import { ref, computed, watch } from 'vue';
import Skeleton from 'primevue/skeleton';
import type { ImageMeta } from '../../../types/image-meta';

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
  hasSelection: boolean;
  displayMode: 'fast' | 'smooth' | 'normal';
  thumbnailUrls: string[];
}>();

const emit = defineEmits<{
  (e: 'click'): void;
  (e: 'toggle-select', event: MouseEvent): void;
  (e: 'toggle-favorite'): void;
  (e: 'hover'): void;
  (e: 'image-load'): void;
  (e: 'image-error', event: Event): void;
}>();

const currentSrcIndex = ref(0);
const currentSrc = computed(() => props.thumbnailUrls[currentSrcIndex.value] ?? '');

watch(
  () => props.thumbnailUrls,
  () => { currentSrcIndex.value = 0; },
);

function handleImgError(e: Event): void {
  const next = currentSrcIndex.value + 1;
  if (next < props.thumbnailUrls.length) {
    currentSrcIndex.value = next;
    return;
  }
  emit('image-error', e);
}
</script>

<template>
  <div
    class="photo-item"
    :class="{ selected: isSelected, 'selection-mode': hasSelection }"
    :data-lightbox-id="meta.id"
    :style="{
      transform: `translate3d(${x}px, ${y}px, 0)`,
      width: `${width}px`,
      height: `${height}px`,
    }"
    @mouseenter="emit('hover')"
  >
    <div
      class="photo-wrapper"
      @click="hasSelection ? emit('toggle-select', $event) : emit('click')"
    >
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
        v-if="!isFailed && currentSrc && (isLoaded || displayMode !== 'fast')"
        :src="currentSrc"
        class="photo-img"
        :class="{ loaded: isLoaded }"
        @load="emit('image-load')"
        @error="handleImgError"
      />

      <!-- Selection Overlay -->
      <div class="selection-overlay"></div>

      <!-- Checkbox -->
      <div
        class="checkbox"
        :class="{ checked: isSelected }"
        @click.stop="emit('toggle-select', $event)"
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

      <!-- 放大镜按钮：选择模式下 hover 显示，点击打开灯箱 -->
      <div
        v-if="hasSelection"
        class="magnifier-btn"
        @click.stop="emit('click')"
      >
        <i class="pi pi-search-plus"></i>
      </div>
    </div>
  </div>
</template>

<style scoped>
.photo-item {
  position: absolute;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  will-change: transform;
}

.photo-item.selected {
  background: var(--primary-alpha-10);
}

.photo-wrapper {
  width: 100%;
  height: 100%;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-md);
  transition: transform var(--duration-medium) var(--ease-decelerate);
}

/* 选中时图片缩小，露出背景色（Google Photos 风格） */
.photo-item.selected .photo-wrapper {
  transform: scale(0.88);
}

.photo-skeleton {
  position: absolute;
  inset: 0;
  z-index: 1;

  /* 覆盖 PrimeVue Skeleton 默认背景：用项目最深灰阶 token，保证浅/深主题下与 photo-item 背景有足够对比 */
  background-color: var(--bg-titlebar);
}

.photo-error {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  color: var(--text-muted);
  opacity: 0.6;
}

.photo-error i {
  font-size: var(--text-2xl);
}

.photo-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--radius-md);
  opacity: 0;
  transition: opacity var(--duration-medium) ease-in-out;
}

.photo-img.loaded {
  opacity: 1;
}

.selection-overlay {
  position: absolute;
  inset: 0;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 半透明遮罩，非主题色 */
  background: rgb(0 0 0 / 10%);
  opacity: 0;
  transition: opacity var(--duration-normal);
  pointer-events: none;
}

.photo-item.selected .selection-overlay {
  opacity: 1;
  background: var(--primary-alpha-20);
  border-radius: var(--radius-md);
}

.checkbox {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-full);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 照片上的半透明边框，非主题色 */
  border: 2px solid rgb(255 255 255 / 50%);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 照片上的半透明背景，非主题色 */
  background: rgb(0 0 0 / 10%);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity var(--duration-normal), background var(--duration-normal), border-color var(--duration-normal);
  z-index: 2;
}

.checkbox::before {
  content: '';
  position: absolute;
  inset: -8px;
}

/* 两段式露出：图片 hover 时半亮，复选框直接 hover 才全亮 */
.photo-wrapper:hover .checkbox {
  opacity: 0.6;
}

.checkbox.checked {
  opacity: 1;
  background: var(--primary);
  border-color: var(--primary);
}

/* 选择模式下所有复选框常驻全亮（用户意图明确，不走两段式） */
.photo-item.selection-mode .checkbox {
  opacity: 1;
}

.checkbox:hover {
  opacity: 1;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 照片上的半透明悬停背景，非主题色 */
  background: rgb(0 0 0 / 40%);
}

.checkbox.checked i {
  font-size: var(--text-2xs);
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 深色勾选框上的白色对勾，固定配色 */
  color: white;
  font-weight: var(--weight-bold);
}

.favorite-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  border-radius: var(--radius-full);
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 照片上的半透明白色图标，固定配色 */
  color: rgb(255 255 255 / 85%);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity var(--duration-normal), color var(--duration-normal), transform var(--duration-normal), filter var(--duration-normal);
  z-index: 2;
  cursor: pointer;
  font-size: var(--text-xs);
  filter: drop-shadow(0 1px 2px rgb(0 0 0 / 50%));
}

.favorite-btn::before {
  content: '';
  position: absolute;
  inset: -8px;
}

/* 两段式露出：图片 hover 半亮，按钮直接 hover 才全亮 */
.photo-wrapper:hover .favorite-btn {
  opacity: 0.6;
}

.favorite-btn.favorited {
  opacity: 0.6;
  color: var(--warning);
  filter: drop-shadow(0 1px 3px rgb(234 179 8 / 40%));
}

.favorite-btn:hover {
  opacity: 1;
  transform: scale(1.15);
}

.favorite-btn.favorited:hover {
  opacity: 1;
  filter: drop-shadow(0 1px 4px rgb(234 179 8 / 60%));
}

.favorite-btn.favorited i {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 弹跳动画 0.6s 无对应 token */
  animation: k-pop 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
}

@media (prefers-reduced-motion: reduce) {
  .favorite-btn.favorited i {
    animation: none;
  }
}

/* 放大镜按钮：选择模式下右下角，hover 时显示 */
.magnifier-btn {
  position: absolute;
  bottom: var(--space-sm);
  right: var(--space-sm);
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  border-radius: var(--radius-full);
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 照片上的半透明白色图标，固定配色 */
  color: rgb(255 255 255 / 85%);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity var(--duration-normal), transform var(--duration-normal), background var(--duration-normal);
  z-index: 2;
  cursor: pointer;
  font-size: var(--text-xs);
  filter: drop-shadow(0 1px 2px rgb(0 0 0 / 50%));
}

/* 扩展可点击区域到 52x52px */
.magnifier-btn::before {
  content: '';
  position: absolute;
  inset: -16px;
}

/* 两段式露出：图片 hover 半亮，按钮直接 hover 才全亮 */
.photo-wrapper:hover .magnifier-btn {
  opacity: 0.6;
}

.magnifier-btn:hover {
  opacity: 1;
  transform: scale(1.15);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 照片上的半透明悬停背景，非主题色 */
  background: rgb(0 0 0 / 35%);
}

@media (hover: none) {
  .checkbox {
    width: 32px;
    height: 32px;
  }

  .magnifier-btn {
    width: 32px;
    height: 32px;
    opacity: 1;
  }
}
</style>
