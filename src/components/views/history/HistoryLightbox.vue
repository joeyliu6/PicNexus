<script setup lang="ts">
/**
 * 图片灯箱 — 基于 PhotoSwipe 5
 *
 * PhotoSwipe 处理：FLIP 开/关动画、缩放、平移、手势
 * Vue 处理：底栏（信息+操作）、导航事件、收藏状态
 */
import { computed, toRef, ref } from 'vue';
import 'photoswipe/style.css';
import type { HistoryItem } from '../../../config/types';
import { useConfigManager } from '../../../composables/useConfig';
import { useHistoryManager } from '../../../composables/useHistory';
import { useToast } from '../../../composables/useToast';
import { usePhotoSwipeBridge } from '../../../composables/history/usePhotoSwipeBridge';
import { useLightboxActions } from '../../../composables/history/useLightboxActions';
import { useLightboxInfo } from '../../../composables/history/useLightboxInfo';
import { getPrimaryImageUrl } from '../../../utils/imageUrl';
import { generateMediumThumbnailUrl } from '../../../composables/useThumbCache';
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
const toast = useToast();
const itemRef = computed(() => props.item);

// ── PhotoSwipe 桥接 ────────────────────────────
const imageSrc = computed(() => {
  if (!props.item) return '';
  return getPrimaryImageUrl(props.item, configManager.config.value);
});

/**
 * LQIP 中图：400-800px 缩略图，比原图小一两个数量级、加载秒到
 * 用作模糊背景占位 + PhotoSwipe msrc，填充大图加载期间的空白
 */
const mediumSrc = computed(() => {
  if (!props.item) return '';
  const result = props.item.results.find(
    r => r.serviceId === props.item!.primaryService && r.status === 'success'
  );
  if (!result?.result?.url) return '';
  return generateMediumThumbnailUrl(
    result.serviceId,
    result.result.url,
    result.result.fileKey,
    configManager.config.value
  );
});

const itemId = computed(() => props.item?.id);
const imageWidth = computed(() => props.item?.width || 0);
const imageHeight = computed(() => props.item?.height || 0);

const blurLoadedSrc = ref<string | null>(null);

function handleLoadError() {
  toast.warn('图片加载失败', '图床可能限制了访问。试试切换图床复制链接或在浏览器打开');
}

const { pswpEl, blurSrc, isLoading } = usePhotoSwipeBridge({
  visible: toRef(props, 'visible'),
  imageSrc,
  mediumSrc,
  itemId,
  imageWidth,
  imageHeight,
  hasPrev: toRef(props, 'hasPrev'),
  hasNext: toRef(props, 'hasNext'),
  onClose: () => emit('update:visible', false),
  onNavigate: (dir) => emit('navigate', dir),
  onLoadError: handleLoadError,
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
    <!-- 高斯模糊背景层（z-index: -1，位于黑色遮罩 .pswp__bg 之后） -->
    <div class="pswp-blur-bg" aria-hidden="true">
      <img
        v-if="blurSrc"
        :src="blurSrc"
        :class="{ 'is-loaded': blurLoadedSrc === blurSrc }"
        alt=""
        @load="blurLoadedSrc = blurSrc"
      />
    </div>

    <!--
      加载指示器包裹层占除底栏外的可视区，内部 flex 居中 → spinner 自动落在图片中心
      大图超过 200ms 未完成时淡入，快图（含缓存命中）不会触发
      采用纯 SVG 描边环（iOS Photos 风格），无胶囊背景，不抢图片视觉
    -->
    <Transition name="t-fade">
      <div
        v-if="isLoading"
        class="pswp-spinner-wrap"
        role="status"
        aria-label="图片加载中"
      >
        <svg class="pswp-spinner-ring" viewBox="0 0 40 40" aria-hidden="true">
          <!-- pathLength=100 把周长归一化为 100，dasharray 可用百分比语义（75:25 = 3/4 弧）-->
          <circle cx="20" cy="20" r="17" pathLength="100" />
        </svg>
      </div>
    </Transition>

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

  /*
   * 底栏预留空间：对应 usePhotoSwipeBridge.ts paddingFn bottom(72px)
   * = LightboxBottomBar 高度 64px + 8px 间隙；spinner 居中时据此向上偏移
   */
  --pswp-bottom-bar-space: 72px;

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

/*
 * 占位符透明化
 * 默认 .pswp__img--placeholder（div 版本，无 msrc 时）背景是 --pswp-placeholder-bg(#222)
 * 项目已通过 msrc 注入中图缩略图作为 LQIP，div 版仅在 msrc 缺失时出现 —
 * 此时让它透明，露出下方 .pswp-blur-bg，避免出现纯灰大块
 */
.pswp--picnexus .pswp__img--placeholder {
  background: transparent !important;
}

/*
 * 加载指示器包裹层：铺满除底栏外的可视区，flex 居中让 spinner 落在图片中心
 * z-index: --z-base 使其在灯箱内部栈上方但不越过全局层
 */
.pswp-spinner-wrap {
  position: absolute;
  inset: 0 0 var(--pswp-bottom-bar-space) 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-base);
  pointer-events: none;

  /* 组件局部几何 token：纯 SVG 描边环的尺寸参数，不属于全局 spacing 体系 */
  --pswp-spinner-size: 40px;
  --pswp-spinner-stroke: 2px;
}

/* 纯描边圆环 — iOS Photos 风：无胶囊背景，不抢图片视觉 */
.pswp-spinner-ring {
  width: var(--pswp-spinner-size);
  height: var(--pswp-spinner-size);
  animation: k-spin var(--duration-spinner) linear infinite;
}

.pswp-spinner-ring circle {
  fill: none;
  stroke: var(--text-main);
  stroke-width: var(--pswp-spinner-stroke);
  stroke-opacity: 0.85;
  stroke-linecap: round;

  /* pathLength=100 + 75:25 = 3/4 弧可见 + 1/4 空隙，配合旋转产生"追尾"视觉。
     与 circle 的 r 值解耦 —— 改 r 不用重算 dasharray */
  stroke-dasharray: 75 25;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 深色环境描边的微投影，无对应 token */
  filter: drop-shadow(0 1px 2px rgb(0 0 0 / 40%));
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

/*
 * 高斯模糊背景层
 * z-index: -1 → 渲染在 .pswp__bg 黑色遮罩层（z:auto+transform=0 级）之后
 * 视觉层序：blur(-1) → 黑色遮罩(0) → 主图(3)
 * 黑色遮罩作为"调光层"压在 blur 上，只露出少量颜色氛围
 */
.pswp--picnexus .pswp-blur-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
  z-index: -1;
  pointer-events: none;
}

.pswp--picnexus .pswp-blur-bg img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1.2); /* 消除 blur 边缘白边，scale 需略大于 blur 半径 */
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 灯箱模糊背景复合滤镜，无对应 token */
  filter: blur(30px) brightness(0.6) saturate(1.3);
  opacity: 0;
  transition: opacity var(--duration-slow) ease;
  pointer-events: none;
}

.pswp--picnexus .pswp-blur-bg img.is-loaded {
  opacity: 1;
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
