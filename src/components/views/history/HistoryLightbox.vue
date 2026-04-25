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
import { usePhotoSwipeBridge } from '../../../composables/history/usePhotoSwipeBridge';
import { useLightboxActions } from '../../../composables/history/useLightboxActions';
import { useLightboxInfo } from '../../../composables/history/useLightboxInfo';
import { useMirrorFallback } from '../../../composables/history/useMirrorFallback';
import { useToast } from '../../../composables/useToast';
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

const toast = useToast();

function handleLoadError() {
  toast.warn('图片加载失败', '图床可能限制了访问。试试切换图床复制链接或在浏览器打开');
}

const { pswpEl, blurSrc, isLoading, setSwitchDirection } = usePhotoSwipeBridge({
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

// ── 图床备份管理 ─────────────────────────────
const {
  mirrors,
  isPrimaryBroken,
  allMirrorsBroken,
  checkingServices,
  switchPrimary,
  removeMirror,
  checkMirror,
} = useMirrorFallback(itemRef);

// ── 导航 ────────────────────────────────────
// emit 之前先告诉桥接方向，contentActivate 触发时才能拿到正确的 dataset.switchDir
function navigatePrev() {
  if (!props.hasPrev) return;
  setSwitchDirection('prev');
  emit('navigate', 'prev');
}
function navigateNext() {
  if (!props.hasNext) return;
  setSwitchDirection('next');
  emit('navigate', 'next');
}
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
      :mirrors="mirrors"
      :is-primary-broken="isPrimaryBroken"
      :all-mirrors-broken="allMirrorsBroken"
      :checking-services="checkingServices"
      @copy-link="handleCopyLink"
      @copy-service-link="handleCopyServiceLink"
      @open-browser="openInBrowser"
      @delete="handleDelete"
      @switch-primary="switchPrimary"
      @remove-mirror="removeMirror"
      @check-mirror="checkMirror"
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

  /*
   * 切换图片入场动画的方向位移距离
   * 复用 motion.css 的 --translate-lg(20px)：在全屏视野里足够给方向感、不张扬
   * 想加大可在此覆盖（如 calc(var(--translate-lg) * 2) → 40px）
   */
  --pswp-switch-distance: var(--translate-lg);

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
 * 切换图片时的入场动画（参考 Google Photos / Apple Photos 风格）
 *
 * 默认 keyframes 走纯淡入（无方向时兜底，例如外部代码直接改 itemId）
 * 方向化 keyframes 加 translateX —— next 从右滑入、prev 从左滑入，建立方向感
 *
 * 为什么 transform 不冲突：PhotoSwipe 的 zoom/pan 矩阵作用在 .pswp__zoom-wrap 上，
 * 不会动 .pswp__img 自身的 transform，所以这里给 img 加 translateX 是安全的
 *
 * 触发链路：键盘/滚轮/箭头 → setSwitchDirection → onNavigate → 父组件改 item →
 * itemId watch → updateSlideContent → contentActivate 给新 img 写 dataset.switchDir + class
 *
 * 为什么没有旧图退出动画：PhotoSwipe refreshSlideContent 即时销毁旧 content 创建新的，
 * 强行加幽灵层做退出会增加闪烁风险且复杂度爆炸；快速连击时 Google Photos 也会截断旧图
 */
@keyframes pswp-img-switch-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes pswp-img-switch-in-next {
  from { opacity: 0; transform: translateX(var(--pswp-switch-distance)); }
  to   { opacity: 1; transform: translateX(0); }
}

@keyframes pswp-img-switch-in-prev {
  from { opacity: 0; transform: translateX(calc(var(--pswp-switch-distance) * -1)); }
  to   { opacity: 1; transform: translateX(0); }
}

/*
 * ease-decelerate（快启慢停）匹配"进入"的语义节奏：
 * 起始位移变化快 → 末段轻轻落位，比 ease-standard 更有"图片送到位"的踏实感
 */
.pswp--picnexus .pswp__img.is-switching-in {
  animation: pswp-img-switch-in var(--duration-normal) var(--ease-decelerate);
}

.pswp--picnexus .pswp__img.is-switching-in[data-switch-dir="next"] {
  animation: pswp-img-switch-in-next var(--duration-normal) var(--ease-decelerate);
}

.pswp--picnexus .pswp__img.is-switching-in[data-switch-dir="prev"] {
  animation: pswp-img-switch-in-prev var(--duration-normal) var(--ease-decelerate);
}

/*
 * 占位图（msrc 中图模糊版）的入场淡入
 * 仅 opacity 0→1，不动 transform —— PhotoSwipe Placeholder 自身用
 * inline transform: scale() 做尺寸缩放（placeholder.js:44），
 * 加了 transform 关键帧会覆盖 inline 样式导致占位图错位/消失
 *
 * 大图未到位时占位图就是用户能看见的全部；不淡入它，
 * 就会出现"切换瞬间占位图凭空蹦出来"的明显跳变
 */
.pswp--picnexus .pswp__img--placeholder.is-switching-in {
  animation: pswp-img-switch-in var(--duration-normal) var(--ease-decelerate);
}

@media (prefers-reduced-motion: reduce) {
  .pswp--picnexus .pswp__img.is-switching-in,
  .pswp--picnexus .pswp__img.is-switching-in[data-switch-dir="next"],
  .pswp--picnexus .pswp__img.is-switching-in[data-switch-dir="prev"],
  .pswp--picnexus .pswp__img--placeholder.is-switching-in {
    animation: none;
  }
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
 *
 * background: #000 兜底：切换图片时 blur <img> 要重新下载新缩略图，
 * 下载窗口内 img.opacity=0 → 若本层无背景，PhotoSwipe 的 .pswp__bg(65% 不透明)
 * 留出的 35% 缝隙会透出底层的时间轴/表格视图。实心黑兜底彻底堵死缝隙。
 */
.pswp--picnexus .pswp-blur-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
  z-index: -1;
  pointer-events: none;
  background: var(--pswp-bg);

  /* 开场整体淡入（含 #000 兜底 + ::after 暗角），与 .pswp__bg(300ms) 同步；
   * 不做这个 animation 则 t=0 瞬间父层纯黑铺满，浅色主图 FLIP pop 对比强烈，
   * 视觉上表现为"眼前一闪一亮"。翻页不触发（只有 Teleport 挂载时才跑一次） */
  animation: pswp-blur-bg-open var(--duration-slow) ease-out;
}

@keyframes pswp-blur-bg-open {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .pswp--picnexus .pswp-blur-bg {
    animation: none;
  }
}

.pswp--picnexus .pswp-blur-bg img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1.2); /* 消除 blur 边缘白边，scale 需略大于 blur 半径 */
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 灯箱模糊背景复合滤镜，无对应 token */
  filter: blur(30px) brightness(0.45) saturate(1.1);
  opacity: 0;

  /* 时长必须 >= PhotoSwipe SHOW_ANIMATION_DURATION(300ms)，确保 blur 不早于 .pswp__bg 完成淡入；
   * 否则 blur 先到 100% 而 bg 尚未压满，浅色图会出现亮度峰值（视觉上一闪而亮） */
  transition: opacity var(--duration-slow) ease;
  pointer-events: none;
}

.pswp--picnexus .pswp-blur-bg img.is-loaded {
  opacity: 1;
}

/*
 * 影院暗角（vignette）— 高级感来源
 * 中心透明露出 blur 氛围，边缘径向沉到近黑 → 视觉焦点自然收束到主图
 * 位置：blur img 之上、.pswp__bg 之下（仍受父层 z:-1 约束）
 * 椭圆形 vs 圆形：椭圆更匹配宽屏视口，两侧沉得更深
 */
.pswp--picnexus .pswp-blur-bg::after {
  content: '';
  position: absolute;
  inset: 0;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 影院暗角径向渐变，无对应 token */
  background: radial-gradient(ellipse at center, transparent 30%, rgb(0 0 0 / 65%) 100%);
  pointer-events: none;
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
