<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { safeImageUrl } from '../../security/networkPolicy';
import { reportThumbnailUrlFailed, reportThumbnailUrlLoaded } from '../../composables/useThumbCache';
import { hasUrlListChanged } from '../../composables/useThumbnailFallbackChain';

/**
 * Why 这里没复用 useThumbnailFallbackChain（时间轴/收藏页共用的那个）：
 * 本组件自持 loading/error 状态，且带 `loading="lazy"`，"是否在等加载"必须靠自己的
 * IntersectionObserver 判断，而非由父组件传状态；还多一条「要加载的就是已经显示出来
 * 的那张」的短路（见 loadImage）。强行合并会把两套判据都拧变形。
 *
 * 安全过滤这一层现在两边都有了（2026-08-19 补上收藏页/时间轴那道闸时统一的），
 * 只是位置不同：那边在候选链入口一次性剔除，这边是翻到哪条过哪条。
 * 三处的候选链语义一致（安全过滤、按序试、失败翻页、超时兜底、回报降级），改动请同步。
 */

/**
 * 单条候选的加载超时（毫秒）
 *
 * Why 光靠 @error 不够：候选链是靠 `<img>` 的 error 事件往后翻的，但「连不上」和
 * 「报错」不是一回事。R2 开着 wsrv.nl 代理时首选是第三方地址，那条链路被墙的表现是
 * TCP 连接卡死——浏览器可能几十秒才放弃，这期间格子里一直是骨架屏。到点主动翻下一条，
 * 让垫在后面的原图尽快顶上（候选链构成见 useThumbCache.generateThumbnailUrls）。
 */
const LOAD_TIMEOUT_MS = 5000;

const props = defineProps<{
  srcs: string[];
  alt?: string;
  imageClass?: string;
  /**
   * 已通过 fake-ip 逃生舱确认的 HTTP 主机名（需先用 normalizeHost 归一化）
   *
   * Why 这里只接 prop 不自己查配置：本组件是到处复用的通用缩略图，配置读取
   * 交给调用方（如 HistoryTableView / QueueCard，见 getConfirmedWebdavHttpHosts）。
   */
  confirmedHttpHosts?: ReadonlySet<string>;
}>();

const currentSrcIndex = ref(0);
const currentSrc = ref('');
const isError = ref(false);
const isLoading = ref(true);

const wrapperRef = ref<HTMLElement | null>(null);
/** 元素是否已进入过视口（img 带 loading="lazy"，视口外浏览器根本不发请求） */
let hasEnteredViewport = false;
let timeoutId: ReturnType<typeof setTimeout> | null = null;
let observer: IntersectionObserver | null = null;
/** 上一条刚失败、但还没定性的候选（见 handleError / handleLoad） */
let pendingFailure: string | null = null;

const clearLoadTimeout = () => {
  if (timeoutId !== null) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
};

/**
 * 为当前候选启动超时计时
 *
 * 两个前提缺一不可：
 * 1. **已进入视口**——懒加载的图在视口外压根没开始请求，这时候计时会把一整屏
 *    还没轮到的候选全判成超时，一路翻到占位图（表现为「滚下去全是空格子」）。
 * 2. **后面还有候选**——最后一条翻不动了，掐断只会把「慢但最终能成」变成「直接失败」。
 */
const armLoadTimeout = () => {
  clearLoadTimeout();
  if (!hasEnteredViewport || isError.value || !isLoading.value) return;
  if (currentSrcIndex.value >= props.srcs.length - 1) return;
  timeoutId = setTimeout(() => {
    timeoutId = null;
    handleError();
  }, LOAD_TIMEOUT_MS);
};

const loadImage = () => {
  if (props.srcs && props.srcs.length > 0 && currentSrcIndex.value < props.srcs.length) {
    const nextSrc = safeImageUrl(props.srcs[currentSrcIndex.value], props.confirmedHttpHosts);
    if (nextSrc) {
      // 要加载的就是**已经显示出来**的那张：`<img>` 的 src 不会变，浏览器也就不会再发
      // load 事件，这时把 isLoading 打回 true 就再没人能把它放下来——骨架屏和图一起
      // 挤在格子里，且不自愈。
      //
      // 走到这里的主路径是 R2 降级：原图加载成功 → handleLoad 上报代理不可达 →
      // useThumbCache 清缓存重算 → 候选链从 [代理, 原图] 收成 [原图]。内容确实变了
      // （所以 hasUrlListChanged 拦不住），但首条恰好就是当前这张。
      //
      // 仍在加载中（isLoading）时不能走这条捷径：候选表可能刚变长，需要重新计时。
      if (nextSrc === currentSrc.value && !isError.value && !isLoading.value) return;
      isLoading.value = true;
      currentSrc.value = nextSrc;
      isError.value = false;
      armLoadTimeout();
    } else {
      // 被安全过滤拦下的候选**压根没发出过请求**，不能当成失败证据——不传 failedUrl。
      // 传了的话记进 pendingFailure 的会是「当前还显示着的那张旧图」（此刻 currentSrc
      // 还没换），等下一条加载成功就把这个无辜的服务判死，整个会话降级成原图直连。
      //
      // 这里也不能顺手把 isLoading 打回 true：那会用骨架屏盖住已经显示好的图，还会让
      // 上面「目标就是当前这张」的短路失效，白等一轮 5 秒超时。真正需要 loading 的那次
      // 会由下一轮 loadImage 自己设。
      advanceToNextCandidate();
    }
  } else {
    clearLoadTimeout();
    isError.value = true;
    currentSrc.value = '';
    isLoading.value = false;
  }
};

/**
 * 翻到下一条候选；翻不动了就收尾成「这张图没了」
 *
 * @param failedUrl 确实发起过请求并失败的 URL。没发过请求就别传——见 loadImage 的安全过滤分支。
 */
const advanceToNextCandidate = (failedUrl?: string) => {
  clearLoadTimeout();
  currentSrcIndex.value++;
  if (currentSrcIndex.value < props.srcs.length) {
    // 先不上报：单看一条失败分不清「代理不通」还是「代理背后那张图被删了」，
    // 而上报会把整个会话降级。等下一条出结果才能定性（同 useThumbnailFallbackChain）
    if (failedUrl) pendingFailure = failedUrl;
    loadImage();
  } else {
    // 候选全试完了 = 这张图本身没了，不能赖到代理头上
    pendingFailure = null;
    isError.value = true;
    isLoading.value = false;
  }
};

/** `<img>` 的 error 事件 / 超时兜底：当前这条确实请求过，也确实失败了 */
const handleError = () => {
  advanceToNextCandidate(currentSrc.value);
};

const handleLoad = () => {
  clearLoadTimeout();
  if (pendingFailure) {
    // 前一条挂、这一条通 → 问题确实出在前一条那个服务
    reportThumbnailUrlFailed(pendingFailure);
    pendingFailure = null;
  }
  reportThumbnailUrlLoaded(currentSrc.value);
  isLoading.value = false;
};

onMounted(() => {
  // 环境没有 IntersectionObserver（如 jsdom 单测）时退化成「立即视为可见」：
  // 超时兜底照常工作，只是失去了「视口外不计时」这层优化。
  if (typeof IntersectionObserver === 'undefined') {
    hasEnteredViewport = true;
    armLoadTimeout();
    return;
  }
  if (!wrapperRef.value) return;
  observer = new IntersectionObserver((entries) => {
    if (!entries.some(e => e.isIntersecting)) return;
    hasEnteredViewport = true;
    observer?.disconnect();
    observer = null;
    armLoadTimeout();
  });
  observer.observe(wrapperRef.value);
});

onUnmounted(() => {
  clearLoadTimeout();
  observer?.disconnect();
  observer = null;
});

// 监听源列表变化（srcs 由上游 [...new Set()] / computed 产出，引用不稳定，只能按内容比）
watch(
  () => props.srcs,
  (next, prev) => {
    if (!hasUrlListChanged(next, prev)) return;
    currentSrcIndex.value = 0;
    // 待定的失败记录必须跟着候选链一起清：留着上一条链的 pendingFailure，会在新链的候选
    // 加载成功时套用「前一条挂、这一条通」的判据，把不相干的服务判死（同 useThumbnailFallbackChain）
    pendingFailure = null;
    loadImage();
  },
  { immediate: true },
);

// 用户在设置页走完逃生舱确认后，同一个会话里已挂载的缩略图应该立刻能显示，不必等组件重新挂载
watch(() => props.confirmedHttpHosts, () => {
  if (isError.value) {
    currentSrcIndex.value = 0;
    loadImage();
  }
});

</script>

<template>
  <div ref="wrapperRef" class="thumbnail-wrapper">
    <!-- 加载中显示骨架屏 -->
    <div v-if="isLoading && !isError" class="thumbnail-skeleton"></div>
    
    <!-- 加载成功显示图片 -->
    <img
      v-if="!isError && currentSrc"
      :src="currentSrc"
      :alt="alt"
      :class="imageClass"
      class="thumbnail-img"
      referrerpolicy="no-referrer"
      loading="lazy"
      decoding="async"
      @error="handleError"
      @load="handleLoad"
    />
    
    <!-- 占位符：错误或无可用源时显示 -->
    <div v-if="isError" class="thumbnail-placeholder">
      <slot name="placeholder">
        <i class="pi pi-image placeholder-icon"></i>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.thumbnail-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
}

.thumbnail-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.thumbnail-skeleton {
  width: 100%;
  height: 100%;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 渐变回退色无对应 token */
  background: linear-gradient(90deg,
    var(--bg-input, #f3f4f6) 25%,
    var(--bg-card, #fff) 50%,
    var(--bg-input, #f3f4f6) 75%
  );
  background-size: 200% 100%;
  animation: k-shimmer var(--duration-shimmer) ease-in-out infinite;
}

.thumbnail-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-input, #f3f4f6);
  color: var(--text-muted, #9ca3af);
}

.placeholder-icon {
  font-size: var(--text-2xl);
  opacity: 0.5;
}
</style>
