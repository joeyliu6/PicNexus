<script setup lang="ts">
/**
 * 图片灯箱 — 基于 PhotoSwipe 5
 *
 * PhotoSwipe 处理：FLIP 开/关动画、缩放、平移、手势
 * Vue 处理：底栏（信息+操作）、导航事件、收藏状态
 */
import { computed, toRef, ref, watch } from 'vue';
import 'photoswipe/style.css';
import type { HistoryItem } from '@/config/types';
import { useConfigManager } from '@/composables/useConfig';
import { useHistoryManager } from '@/composables/history/useHistory';
import { usePhotoSwipeBridge } from '@/composables/history/usePhotoSwipeBridge';
import type { PhotoSwipeCloseTargetMode } from '@/composables/history/usePhotoSwipeBridge';
import { useLightboxActions } from '@/composables/history/useLightboxActions';
import { useLightboxInfo } from '@/composables/history/useLightboxInfo';
import { useMirrorFallback } from '@/composables/history/useMirrorFallback';
import { useToast } from '@/composables/useToast';
import { getPrimaryImageUrl } from '@/utils/imageUrl';
import { safeImageUrl } from '@/security/networkPolicy';
import { useThumbCache } from '@/composables/image/useThumbCache';
import { getServiceDisplayName } from '@/constants/serviceNames';
import LightboxBottomBar from './LightboxBottomBar.vue';

const props = withDefaults(defineProps<{
  visible: boolean;
  item: HistoryItem | null;
  hasPrev?: boolean;
  hasNext?: boolean;
  resolveCloseTargetMode?: () => PhotoSwipeCloseTargetMode;
  /**
   * 已确认可走明文 HTTP 的主机名（父视图用 `getConfirmedHttpHosts` 算好传下来）
   *
   * 三个父视图（History / Favorites / Timeline）共用这一个灯箱，所以三边都得传，
   * 漏一处就在那个页面留下一个没有闸门的入口。
   */
  confirmedHttpHosts?: ReadonlySet<string>;
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
const thumbCache = useThumbCache();
const currentItem = ref<HistoryItem | null>(props.item);
watch(
  () => props.item,
  (next) => {
    currentItem.value = next;
  },
  { immediate: true },
);
const itemRef = currentItem;

// ── PhotoSwipe 桥接 ────────────────────────────
/**
 * 未过闸的原始大图地址
 *
 * 单独留一个的用途是「区分没图和有图但被拦」：两者都让 `imageSrc` 变空串，
 * 但只有后者需要告诉用户去设置页确认域名。
 */
const rawImageSrc = computed(() => {
  if (!currentItem.value) return '';
  return getPrimaryImageUrl(currentItem.value, configManager.config.value);
});

/**
 * Why 要过 `safeImageUrl`：CSP 的 `img-src` 放开 `http:` 之前（见 2ab296af），
 * 灯箱是靠 CSP 兜底挡住私网 / 云元数据 / 未确认的明文 HTTP 地址的。那道网撤掉之后，
 * 这条路上**一道闸都没有**——同一批地址在收藏页缩略图上被拦、点开大图却照常请求。
 *
 * 判据与缩略图完全一致（同一个 `safeImageUrl` + 同一份 `confirmedHttpHosts`），
 * 否则会出现「缩略图裂了但灯箱能看」这种自相矛盾的表现，用户只会以为某个页面坏了。
 */
const imageSrc = computed(() => safeImageUrl(rawImageSrc.value, props.confirmedHttpHosts) ?? '');

/**
 * LQIP 中图：400-800px 缩略图，比原图小一两个数量级、加载秒到
 * 用作模糊背景占位 + PhotoSwipe msrc，填充大图加载期间的空白
 */
// 走 thumbCache.getMediumImageUrl 而不是直接调 generateMediumThumbnailUrl：
// 后者不看会话降级状态，探测到代理不通后这里仍会请求代理死链，模糊占位和 PhotoSwipe 的
// msrc 就白瞎了。所有取「单条 URL」的入口都必须从候选链取首条，见 data-persistence.md 图5。
// 同样要过闸：模糊占位和 PhotoSwipe 的 msrc 都由它喂，漏了等于给同一批地址留了后门。
const mediumSrc = computed(() => {
  const item = currentItem.value;
  if (!item) return '';
  return safeImageUrl(thumbCache.getMediumImageUrl(item), props.confirmedHttpHosts) ?? '';
});

const itemId = computed(() => currentItem.value?.id);
const imageWidth = computed(() => currentItem.value?.width || 0);
const imageHeight = computed(() => currentItem.value?.height || 0);

const blurLoadedSrc = ref<string | null>(null);
const currentLoadFailedServiceId = ref<string | null>(null);

const toast = useToast();

function handleLoadError() {
  const serviceId = currentItem.value?.primaryService ?? null;
  currentLoadFailedServiceId.value = serviceId;
  const serviceName = serviceId ? getServiceDisplayName(serviceId, configManager.config.value) : '当前图床';
  toast.warn(`${serviceName} 图片加载失败`, '当前主图床访问失败。可在底栏链接菜单手动切换图床，或在浏览器打开确认');
}

function handleLoadSuccess() {
  currentLoadFailedServiceId.value = null;
}

/**
 * 地址被安全闸拦下时给一句解释
 *
 * Why 要弹：`usePhotoSwipeBridge.openPswp` 在 `imageSrc` 为空时直接 return，
 * 于是用户点了缩略图**什么都不会发生**。缩略图上的「加载失败」只说了坏，
 * 没说为什么坏、也没说去哪儿修；决策树里这属于「用户主动触发 + 结果有歧义」。
 *
 * Why 不会和 `handleLoadError` 重复：被拦下的地址压根没发出过请求，
 * 走不到 PhotoSwipe 的 load 失败回调，两条提示互斥。
 */
watch(
  () => (props.visible && rawImageSrc.value && !imageSrc.value ? rawImageSrc.value : null),
  (blockedUrl) => {
    if (!blockedUrl) return;
    toast.warn(
      '图片来源未确认',
      '该链接是明文 HTTP 或指向内网地址，已拦下未请求。请到设置页对这个图床的公开域名「测试连接」并确认一次。',
    );
  },
  { immediate: true },
);

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
  onLoadSuccess: handleLoadSuccess,
  resolveCloseTargetMode: props.resolveCloseTargetMode,
});

watch(
  () => [currentItem.value?.id, currentItem.value?.primaryService] as const,
  () => {
    currentLoadFailedServiceId.value = null;
  },
);

// ── 收藏状态 ────────────────────────────────
const isItemFavorited = computed(() => {
  if (!currentItem.value) return false;
  return historyManager.favoriteSet.value.has(currentItem.value.id);
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
      v-if="currentItem"
      :item="currentItem"
      :display-file-name="displayFileName"
      :successful-services-text="successfulServicesText"
      :successful-services="successfulServices"
      :is-item-favorited="isItemFavorited"
      :copy-success="copySuccess"
      :mirrors="mirrors"
      :is-primary-broken="isPrimaryBroken"
      :load-failed-service-id="currentLoadFailedServiceId"
      :all-mirrors-broken="allMirrorsBroken"
      :checking-services="checkingServices"
      @copy-link="handleCopyLink"
      @copy-service-link="handleCopyServiceLink"
      @open-browser="openInBrowser"
      @delete="handleDelete"
      @switch-primary="switchPrimary"
      @remove-mirror="removeMirror"
      @check-mirror="checkMirror"
      @toggle-favorite="emit('toggle-favorite', currentItem)"
    />
  </Teleport>
</template>

<!-- PhotoSwipe 主题覆盖（外部文件；要打到 PhotoSwipe 自建 DOM，故不加 scoped） -->
<style src="./lightbox-pswp.css"></style>
