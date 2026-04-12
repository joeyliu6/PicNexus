<script setup lang="ts">
/**
 * 图片灯箱 — 基于 PhotoSwipe 5
 *
 * PhotoSwipe 处理：FLIP 开/关动画、缩放、平移、手势
 * Vue 处理：底栏（信息+操作）、导航事件、收藏状态
 */
import { computed, toRef } from 'vue';
import 'photoswipe/style.css';
import type { HistoryItem } from '../../../config/types';
import { useConfigManager } from '../../../composables/useConfig';
import { useHistoryManager } from '../../../composables/useHistory';
import { usePhotoSwipeBridge } from '../../../composables/history/usePhotoSwipeBridge';
import { useLightboxActions } from '../../../composables/history/useLightboxActions';
import { useLightboxInfo } from '../../../composables/history/useLightboxInfo';
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

// ── PhotoSwipe 桥接 ────────────────────────────
const imageSrc = computed(() => {
  if (!props.item) return '';
  return getPrimaryImageUrl(props.item, configManager.config.value);
});

const itemId = computed(() => props.item?.id);
const imageWidth = computed(() => props.item?.width || 0);
const imageHeight = computed(() => props.item?.height || 0);

const { pswpEl } = usePhotoSwipeBridge({
  visible: toRef(props, 'visible'),
  imageSrc,
  itemId,
  imageWidth,
  imageHeight,
  hasPrev: toRef(props, 'hasPrev'),
  hasNext: toRef(props, 'hasNext'),
  onClose: () => emit('update:visible', false),
  onNavigate: (dir) => emit('navigate', dir),
});

// ── 收藏状态 ────────────────────────────────
const isItemFavorited = computed(() => {
  if (!props.item) return false;
  return historyManager.favoriteSet.value.has(props.item.id);
});

// ── 信息展示 ────────────────────────────────
const {
  displayFileName,
  successfulServices,
  successfulServicesText,
} = useLightboxInfo(itemRef);

// ── 操作 ────────────────────────────────────
const { handleCopyLink, handleCopyServiceLink, copySuccess, openInBrowser, handleDelete } = useLightboxActions({
  item: itemRef,
  resetZoom: () => { /* PhotoSwipe 内部管理缩放 */ },
  onDelete: (record) => emit('delete', record),
});

// ── 导航 ────────────────────────────────────
function navigatePrev() { if (props.hasPrev) emit('navigate', 'prev'); }
function navigateNext() { if (props.hasNext) emit('navigate', 'next'); }
</script>

<template>
  <!-- 自定义 UI 通过 Teleport 挂入 PhotoSwipe 根元素 -->
  <Teleport v-if="pswpEl" :to="pswpEl">
    <!-- 导航箭头：t-fade 过渡避免在边界条件（第一张/最后一张）时箭头瞬间消失 -->
    <Transition name="t-fade">
      <button
        v-if="hasPrev"
        class="pswp-nav pswp-nav--prev"
        @click="navigatePrev"
      >
        <i class="pi pi-chevron-left"></i>
      </button>
    </Transition>
    <Transition name="t-fade">
      <button
        v-if="hasNext"
        class="pswp-nav pswp-nav--next"
        @click="navigateNext"
      >
        <i class="pi pi-chevron-right"></i>
      </button>
    </Transition>

    <!-- 底栏 -->
    <LightboxBottomBar
      v-if="item"
      :item="item"
      :display-file-name="displayFileName"
      :successful-services-text="successfulServicesText"
      :successful-services="successfulServices"
      :is-item-favorited="isItemFavorited"
      :copy-success="copySuccess"
      @copy-link="handleCopyLink"
      @copy-service-link="handleCopyServiceLink"
      @open-browser="openInBrowser"
      @delete="handleDelete"
      @toggle-favorite="emit('toggle-favorite', item)"
    />
  </Teleport>
</template>

<style>
/*
 * PhotoSwipe 主题覆盖（全局样式，不加 scoped）
 * 所有选择器以 .pswp--picnexus 为前缀，避免污染
 */

/* 背景透明度由 PhotoSwipe bgOpacity 选项控制 */
.pswp--picnexus {
  --pswp-bg: #000;

  z-index: var(--z-lightbox) !important;
}

/* 隐藏 PhotoSwipe 默认顶栏（用我们自己的底栏） */
.pswp--picnexus .pswp__top-bar {
  display: none !important;
}

/* 图片圆角 + 阴影 */
.pswp--picnexus .pswp__img {
  border-radius: var(--radius-md);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 灯箱暗色环境下的图片阴影，无对应 token */
  box-shadow: 0 8px 40px rgb(0 0 0 / 50%);
}

/* 自定义导航箭头 */
.pswp-nav {
  position: absolute;
  top: calc(50% - 32px);
  transform: translateY(-50%);
  z-index: 10;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  background: var(--hover-overlay);
  color: var(--text-muted);
  font-size: var(--text-lg-xl);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-normal) ease;
  backdrop-filter: blur(8px);
}

.pswp-nav--prev { left: 20px; }
.pswp-nav--next { right: 20px; }

.pswp-nav:hover {
  color: var(--text-main);
  transform: translateY(-50%) scale(1.08);
}

/* 浅色模式：灯箱始终保持暗色风格 */
:root.light-theme .pswp--picnexus {
  --text-main: #f8fafc;
  --text-muted: #94a3b8;
  --text-tertiary: #64748b;
  --hover-overlay: rgb(255 255 255 / 8%);
  --hover-overlay-subtle: rgb(255 255 255 / 4%);
  --border-subtle: #334155;
  --error: #ef4444;
  --error-soft: rgb(239 68 68 / 15%);
}
</style>
