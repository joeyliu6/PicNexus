/**
 * 缩略图候选链消费逻辑（时间轴 / 收藏页共用）
 *
 * 候选链由 useThumbCache 产出（主服务在前、镜像在后；R2 开代理时还会在代理后面
 * 垫一条原图）。本 composable 负责「怎么消费」：按顺序试、失败往后翻、翻到底才算失败，
 * 并把结果回报给 useThumbCache 用于会话级降级。
 *
 * Why 抽出来：时间轴和收藏页此前各写了一份逐字相同的 currentSrcIndex + handleImgError，
 * 结果超时兜底只补进了时间轴那份，收藏页在代理卡死时会一直停在骨架屏。同一套判据
 * 散在两个组件里，修一处漏一处是必然的。
 */
import { ref, computed, watch, watchEffect, onMounted, onUnmounted, type Ref } from 'vue';
import { reportThumbnailUrlFailed, reportThumbnailUrlLoaded } from './useThumbCache';

/**
 * 单条候选的加载超时（毫秒）
 *
 * Why 光靠 onerror 不够：候选链是靠 `<img>` 的 error 事件往后翻的，但「连不上」和
 * 「报错」不是一回事。R2 开着第三方代理时首选指向 wsrv.nl，那条链路卡死的表现是
 * TCP 连接迟迟不返回——浏览器可能几十秒才放弃，这期间格子里一直是骨架屏。
 * 到点主动翻下一条，让垫底的原图尽快顶上。
 */
export const THUMB_LOAD_TIMEOUT_MS = 5000;

interface UseThumbnailFallbackChainOptions {
  /** 候选 URL 列表（响应式 getter，通常是 `() => props.thumbnailUrls`） */
  urls: () => string[];
  /**
   * 当前 `<img>` 是否已渲染且仍在等加载
   *
   * 用来决定要不要计时。各视图的判据不同（时间轴要排除 fast 滚动模式下不渲染的图、
   * 收藏页看 imageState），所以由调用方给。判断错的代价是：对根本没在加载的图计时，
   * 会把整屏候选误翻一遍。
   */
  isWaiting: () => boolean;
  /** 候选全部试完仍失败时回调，由调用方决定怎么向上报 */
  onExhausted: (event?: Event) => void;
  /**
   * 承载 `<img>` 的元素，用于视口判定（可选）
   *
   * **只要 `<img>` 带 `loading="lazy"` 就必须传。** 懒加载的图在视口外浏览器压根不发
   * 请求，对它计时等于凭空判超时：收藏页一次渲染 80 格、无虚拟化，不传这个引用会让
   * 视口外那 60 多张在 5 秒后集体「失败」，把明明通着的代理判死。
   * 不传则视为「总在视口内」——适用于虚拟列表这类只渲染窗口内元素且不用 lazy 的场景。
   */
  elementRef?: Ref<HTMLElement | null>;
}

export function useThumbnailFallbackChain(options: UseThumbnailFallbackChainOptions) {
  const currentSrcIndex = ref(0);
  const currentSrc = computed(() => options.urls()[currentSrcIndex.value] ?? '');

  /** 元素是否已进入过视口（没传 elementRef 时恒为 true，见该选项说明） */
  const hasEnteredViewport = ref(!options.elementRef);
  let observer: IntersectionObserver | null = null;

  /**
   * 上一条刚失败、但还没定性的候选
   *
   * Why 不当场上报：`reportThumbnailUrlFailed` 会把整个会话降级成原图直连，而单看
   * 一条失败根本分不清是「代理不通」还是「代理背后那张图被删了」——用户在桶里删对象
   * 是常规操作，wsrv.nl 对失效上游同样返回错误。一张死图就把全会话的代理关掉，
   * 等于路上有辆抛锚的车就宣布整条高速封闭。
   *
   * 候选链天然提供了区分手段：**前一条失败、后一条成功**，才说明问题出在前一条那个
   * 服务上；如果后面全都失败，那就是这张图本身没了，与代理无关。
   */
  let pendingFailure: string | null = null;

  function hasUrlListChanged(next: string[], prev?: string[]): boolean {
    if (!prev || next.length !== prev.length) return true;
    return next.some((url, index) => url !== prev[index]);
  }

  // 候选列表换了内容才回到第 0 条：上游对同一份数据返回的是稳定引用，
  // 但降级重算后会产出新数组，这时必须从头试。
  watch(options.urls, (next, prev) => {
    if (hasUrlListChanged(next, prev)) {
      currentSrcIndex.value = 0;
      pendingFailure = null;
    }
  });

  /** 翻到下一条候选；返回 false 表示已经翻到底了 */
  function advance(): boolean {
    const next = currentSrcIndex.value + 1;
    if (next >= options.urls().length) return false;
    currentSrcIndex.value = next;
    return true;
  }

  /** 当前候选失败：记下它，翻下一条；翻不动了就交给调用方收尾 */
  function failCurrent(event?: Event): void {
    const failed = currentSrc.value;
    if (advance()) {
      // 还有后路，等后路的结果再决定这条算不算「服务不可用」
      if (failed) pendingFailure = failed;
      return;
    }
    // 候选全试完了 = 这张图本身没了，不能赖到代理头上
    pendingFailure = null;
    options.onExhausted(event);
  }

  function handleError(event?: Event): void {
    failCurrent(event);
  }

  function handleLoad(): void {
    if (pendingFailure) {
      // 前一条挂、这一条通 → 问题确实出在前一条那个服务（若它是代理，会话就此降级）
      reportThumbnailUrlFailed(pendingFailure);
      pendingFailure = null;
    }
    reportThumbnailUrlLoaded(currentSrc.value);
  }

  onMounted(() => {
    const el = options.elementRef?.value;
    if (!el) return;
    // 环境没有 IntersectionObserver（如 jsdom 单测）时退化成「立即视为可见」：
    // 超时兜底照常工作，只是失去了「视口外不计时」这层守卫。
    if (typeof IntersectionObserver === 'undefined') {
      hasEnteredViewport.value = true;
      return;
    }
    observer = new IntersectionObserver((entries) => {
      if (!entries.some(e => e.isIntersecting)) return;
      hasEnteredViewport.value = true;
      observer?.disconnect();
      observer = null;
    });
    observer.observe(el);
  });

  onUnmounted(() => {
    observer?.disconnect();
    observer = null;
  });

  // 超时兜底。三个前提缺一不可（用 watchEffect 而非 watch：任一前提变化都要重新
  // 评估并清掉旧计时）：
  // 1. **已进入视口**——见 elementRef 的说明，懒加载图在视口外根本没发请求；
  // 2. **确实在等加载**——见 isWaiting 的说明；
  // 3. **后面还有候选**——最后一条翻不动，掐断只会把「慢但最终能成」变成「直接失败」。
  watchEffect((onCleanup) => {
    const hasNext = currentSrcIndex.value < options.urls().length - 1;
    if (!hasEnteredViewport.value || !options.isWaiting() || !currentSrc.value || !hasNext) return;

    const timer = setTimeout(() => failCurrent(), THUMB_LOAD_TIMEOUT_MS);
    onCleanup(() => clearTimeout(timer));
  });

  return { currentSrc, handleError, handleLoad };
}
