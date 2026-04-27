/**
 * PhotoSwipe 5 桥接 composable
 *
 * 管理 PhotoSwipe 实例的生命周期，提供 Vue 响应式接口。
 * - 打开/关闭：基于 visible ref
 * - FLIP 英雄过渡：通过 data-lightbox-id 定位缩略图
 * - 缩放/平移/手势：交给 PhotoSwipe 原生处理
 * - 导航：由 Vue 层驱动（emit navigate 事件），通过 refreshSlideContent 更新内容
 */
import { ref, watch, onUnmounted, nextTick, type Ref, type ComputedRef } from 'vue';
import PhotoSwipe from 'photoswipe';
import type { PhotoSwipeOptions } from 'photoswipe';
import { prefersReducedMotion, motionDuration } from '../../utils/reducedMotion';

export const SHOW_ANIMATION_DURATION = 300;
export const HIDE_ANIMATION_DURATION = 280;
export const ZOOM_ANIMATION_DURATION = 250;

/**
 * 加载指示器延迟（ms）
 * 快图（缓存命中、小图秒到）在此窗口内完成即不显示 spinner，避免闪屏；
 * 超出则认定为"慢图"淡入指示器。200ms 是人感「即时」阈值上限（NN Group 研究：<400ms 感受为即时）
 */
const LOADING_INDICATOR_DELAY = 200;
const LOAD_RETRY_DELAY = 500;
const MAX_LOAD_RETRIES = 1;
const FULL_IMAGE_WAITING_CLASS = 'is-waiting-full-image';
const FULL_IMAGE_READY_CLASS = 'is-full-image-ready';

export type PhotoSwipeCloseTargetMode = 'auto' | 'preview' | 'thumb' | 'fade';

export interface PhotoSwipeBridgeOptions {
  /** 灯箱是否可见 */
  visible: Ref<boolean>;
  /** 当前图片完整 URL */
  imageSrc: ComputedRef<string>;
  /** 当前 HistoryItem ID */
  itemId: ComputedRef<string | undefined>;
  /** 图片原始宽度 */
  imageWidth: ComputedRef<number>;
  /** 图片原始高度 */
  imageHeight: ComputedRef<number>;
  /**
   * LQIP 中图 URL（400-800px 缩略图）
   * 用作模糊背景占位和 PhotoSwipe 的 msrc placeholder，比 DOM 小缩略图更清晰
   */
  mediumSrc: ComputedRef<string>;
  /** 关闭回调 */
  onClose: () => void;
  /** 导航回调 */
  onNavigate: (direction: 'prev' | 'next') => void;
  /** 大图加载失败回调（PhotoSwipe loadError 事件） */
  onLoadError?: () => void;
  /** 大图加载成功回调 */
  onLoadSuccess?: () => void;
  /** 关闭动画计算 bounds 前，同步决定收回到预览图、小缩略图或淡出 */
  resolveCloseTargetMode?: () => PhotoSwipeCloseTargetMode;
  /** 是否有上一张 */
  hasPrev: Ref<boolean>;
  /** 是否有下一张 */
  hasNext: Ref<boolean>;
}

/** FLIP 动画源元素的最小宽度阈值（px），低于此值降级为 fade */
const FLIP_MIN_WIDTH = 100;

/**
 * 表示「没有缩略图」的 filter 返回值。
 * PhotoSwipe TS 上游签名过严 (=> HTMLElement)，但运行时在 photoswipe.esm.js:4377
 * 有 `if (thumbnail)` 判断 → 返回 undefined 会安全降级 fade，无副作用。
 */
const NO_THUMB = undefined as unknown as HTMLElement;

interface PswpSlideOptions {
  src: string;
  msrc: string | undefined;
  w: number;
  h: number;
  thumbEl: HTMLElement | undefined;
  useZoom: boolean;
  isCropped: boolean;
  /** itemId 作为 dataSource.id，供 loadComplete 事件过滤孤儿 content */
  id: string;
}

/** 构建 PhotoSwipe 初始化选项（纯函数，与生命周期解耦，便于阅读）*/
function buildPswpOptions(slide: PswpSlideOptions): PhotoSwipeOptions {
  const reduced = prefersReducedMotion();
  return {
    dataSource: [{
      src: slide.src,
      msrc: slide.msrc,
      width: slide.w,
      height: slide.h,
      element: slide.useZoom ? slide.thumbEl : undefined,
      thumbCropped: slide.isCropped,
      id: slide.id,
    }],
    index: 0,
    bgOpacity: 0.76,
    // 自定义 spinner 由 Vue 层 Teleport 渲染；清空默认错误文案（避免 slide 内显示英文错误）
    errorMsg: '',
    showHideAnimationType: reduced ? 'none' : (slide.useZoom ? 'zoom' : 'fade'),
    showAnimationDuration: motionDuration(SHOW_ANIMATION_DURATION),
    hideAnimationDuration: motionDuration(HIDE_ANIMATION_DURATION),
    zoomAnimationDuration: motionDuration(ZOOM_ANIMATION_DURATION),
    easing: 'cubic-bezier(.4,0,.22,1)',
    // 禁用 PhotoSwipe 默认 UI（用我们自己的）
    arrowPrev: false,
    arrowNext: false,
    zoom: false,
    close: false,
    counter: false,
    // 键盘：仅保留 Esc（方向键由我们的 handleKeydown 处理）
    escKey: true,
    arrowKeys: false,
    // 单图模式禁用循环和滑动
    loop: false,
    // 底部留空给 LightboxBottomBar
    paddingFn: () => ({ top: 0, bottom: 72, left: 80, right: 80 }),
    // 滚轮缩放（Ctrl+wheel）
    wheelToZoom: true,
    // 点击行为
    bgClickAction: 'close',
    tapAction: 'close',
    imageClickAction: 'zoom-or-close',
    doubleTapAction: 'zoom',
    // 主容器样式类
    mainClass: 'pswp--picnexus',
  };
}

/**
 * 在 DOM 中查找缩略图元素，用于 FLIP 动画。
 *
 * 注意：KeepAlive 会让多个视图的 DOM 同时存在。
 * 必须遍历所有匹配元素，选出真正可见的那个（rect.width > 0 且在视口内）。
 * 当表格视图同时存在 36px 缩略图和 300px 悬浮预览时，优先选面积最大的元素，
 * 使 FLIP 动画从更大、比例更正确的预览开始，避免跳跃感和模糊占位图。
 * 如果缩略图已被虚拟滚动回收或在隐藏视图中，返回 undefined → PhotoSwipe 降级为 fade。
 */
function findThumbElement(itemId: string, mode: PhotoSwipeCloseTargetMode = 'auto'): HTMLElement | undefined {
  if (mode === 'fade') return undefined;

  const els = document.querySelectorAll(`[data-lightbox-id="${CSS.escape(itemId)}"]`);
  const visibleEls = Array.from(els).filter((el): el is HTMLElement => {
    if (!(el instanceof HTMLElement)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
  });

  if (mode === 'thumb') {
    return visibleEls.find(el => el.classList.contains('thumb-box'));
  }

  if (mode === 'preview') {
    return visibleEls.find(el => el.classList.contains('global-thumb-hover-preview'))
      ?? visibleEls.find(el => el.classList.contains('thumb-box'));
  }

  let bestEl: HTMLElement | undefined;
  let bestArea = 0;
  for (const el of visibleEls) {
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      bestArea = area;
      bestEl = el;
    }
  }
  return bestEl;
}

export function usePhotoSwipeBridge(options: PhotoSwipeBridgeOptions) {
  let pswp: PhotoSwipe | null = null;
  let closeTargetMode: PhotoSwipeCloseTargetMode = 'auto';
  /** PhotoSwipe 根元素，供 Vue Teleport 挂载自定义 UI */
  const pswpEl = ref<HTMLElement | null>(null);
  /** 模糊背景图源：全程优先取中图（LQIP），加载秒到；无中图时回落到原图 */
  const blurSrc = ref<string | null>(null);
  /** 大图加载中（延迟 LOADING_INDICATOR_DELAY 后才置 true，避免快图闪 spinner） */
  const isLoading = ref(false);
  let loadingDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let loadRetryTimer: ReturnType<typeof setTimeout> | null = null;
  const loadRetryCounts = new Map<string, number>();

  /**
   * 切换方向（驱动入场动画的方向位移）
   * 由三个调用点同步：键盘方向键、滚轮翻页、Vue 层导航箭头
   * contentActivate 事件读取该值写入 .pswp__img 的 dataset.switchDir，CSS 选择器据此走不同 keyframes
   */
  const switchDirection = ref<'prev' | 'next' | null>(null);
  function setSwitchDirection(dir: 'prev' | 'next') {
    switchDirection.value = dir;
  }

  /**
   * 当前在加载的 itemId，用于过滤「孤儿 content」的串扰事件
   *
   * 背景：PhotoSwipe 的 slide.destroy() 不清 content.element.onload，
   * 也不把 content.slide 置 undefined，导致已销毁的旧图片加载完成后
   * 仍会 dispatch loadComplete（见 node_modules/photoswipe/src/js/slide/slide.js:208）。
   *
   * 双保险过滤：
   * A) 事件 payload 的 content 与 pswp.currSlide.content 对比（对象引用）
   * B) dataSource[0].id 与 currentLoadingId 对比（itemId 语义层兜底 A 的时机缝隙）
   */
  let currentLoadingId: string | undefined;
  let currentLoadingSrc: string | undefined;

  /** 判断事件对应的 content 是否为当前 active content（孤儿过滤） */
  function isCurrentContent(eventContent: unknown): boolean {
    if (!pswp) return false;
    const active = pswp.currSlide?.content;
    if (active && eventContent === active) return true;
    // A 方案时机缝隙兜底（refreshSlideContent 瞬间 currSlide 可能短暂不稳定）
    const data = (eventContent as { data?: { id?: string; src?: string } } | null)?.data;
    if (data?.id === undefined || data.id !== currentLoadingId) return false;
    return data.src === undefined || data.src === currentLoadingSrc;
  }

  function getContentId(eventContent: unknown): string | undefined {
    return (eventContent as { data?: { id?: string } } | null)?.data?.id;
  }

  function applyImageRequestAttributes(eventContent: unknown): void {
    const el = (eventContent as { element?: unknown } | null)?.element;
    if (!(el instanceof HTMLImageElement)) return;
    el.referrerPolicy = 'no-referrer';
    el.decoding = 'async';
  }

  function getContentImageElement(eventContent: unknown): HTMLImageElement | null {
    const el = (eventContent as { element?: unknown } | null)?.element;
    return el instanceof HTMLImageElement ? el : null;
  }

  function markFullImageWaiting(eventContent: unknown): void {
    const el = getContentImageElement(eventContent);
    if (!el) return;
    el.classList.add(FULL_IMAGE_WAITING_CLASS);
    el.classList.remove(FULL_IMAGE_READY_CLASS);
  }

  function revealFullImageWhenDecoded(eventContent: unknown, onReady: () => void): void {
    const el = getContentImageElement(eventContent);
    if (!el) {
      onReady();
      return;
    }

    const reveal = () => {
      if (!isCurrentContent(eventContent)) return;
      el.classList.remove(FULL_IMAGE_WAITING_CLASS);
      el.classList.add(FULL_IMAGE_READY_CLASS);
      onReady();
    };

    if (typeof el.decode === 'function') {
      void el.decode().catch(() => {}).finally(reveal);
      return;
    }

    reveal();
  }

  /** 调度加载指示器显示：延迟触发，期间若 loadComplete 会取消 */
  function scheduleLoadingIndicator() {
    if (loadingDelayTimer) clearTimeout(loadingDelayTimer);
    loadingDelayTimer = setTimeout(() => {
      isLoading.value = true;
      loadingDelayTimer = null;
    }, LOADING_INDICATOR_DELAY);
  }

  /** 取消调度 + 立即隐藏指示器（loadComplete / loadError / 关闭时调用） */
  function clearLoadingIndicator() {
    if (loadingDelayTimer) {
      clearTimeout(loadingDelayTimer);
      loadingDelayTimer = null;
    }
    isLoading.value = false;
  }

  function clearLoadRetryTimer() {
    if (loadRetryTimer) {
      clearTimeout(loadRetryTimer);
      loadRetryTimer = null;
    }
  }

  function scheduleLoadRetry(eventContent: unknown): boolean {
    if (!pswp) return false;
    const id = getContentId(eventContent);
    if (!id || id !== currentLoadingId) return false;

    const retryCount = loadRetryCounts.get(id) ?? 0;
    if (retryCount >= MAX_LOAD_RETRIES) return false;

    loadRetryCounts.set(id, retryCount + 1);
    clearLoadRetryTimer();
    loadRetryTimer = setTimeout(() => {
      loadRetryTimer = null;
      if (!pswp || currentLoadingId !== id) return;
      clearLoadingIndicator();
      pswp.refreshSlideContent(0);
    }, LOAD_RETRY_DELAY);
    return true;
  }

  // ── 键盘导航（PhotoSwipe 原生仅处理 Esc） ──────

  function handleKeydown(e: KeyboardEvent) {
    if (!pswp) return;
    if (e.key === 'ArrowLeft' && options.hasPrev.value) {
      e.preventDefault();
      setSwitchDirection('prev');
      options.onNavigate('prev');
    }
    if (e.key === 'ArrowRight' && options.hasNext.value) {
      e.preventDefault();
      setSwitchDirection('next');
      options.onNavigate('next');
    }
  }

  // ── 滚轮导航（非 Ctrl 时前后翻页，Ctrl 交给 PhotoSwipe 缩放） ──

  let wheelTimer: ReturnType<typeof setTimeout> | null = null;

  function handleWheel(e: WheelEvent) {
    if (!pswp || e.ctrlKey) return; // Ctrl+wheel 交给 PhotoSwipe 缩放
    if (wheelTimer) return;
    wheelTimer = setTimeout(() => { wheelTimer = null; }, 200);
    if (e.deltaY > 0 && options.hasNext.value) {
      setSwitchDirection('next');
      options.onNavigate('next');
    } else if (e.deltaY < 0 && options.hasPrev.value) {
      setSwitchDirection('prev');
      options.onNavigate('prev');
    }
  }

  // ── 打开 PhotoSwipe ─────────────────────────

  function openPswp() {
    // 若已有实例存活（快速开关时上一次 close 动画尚未结束），跳过以防重复叠加
    if (pswp) return;
    const src = options.imageSrc.value;
    const id = options.itemId.value;
    if (!src || !id) return;

    const thumbEl = findThumbElement(id, 'auto');
    const w = options.imageWidth.value || 1920;
    const h = options.imageHeight.value || 1080;

    // msrc 优先级：中图缩略图（LQIP，清晰）→ DOM 现存小缩略图（FLIP 动画兜底）→ undefined
    // 中图由父组件按图床规则生成，比 DOM 小缩略图更大更清晰，模糊后仍能看出轮廓
    const thumbImg = thumbEl?.querySelector('img');
    const flipSrc = thumbImg?.currentSrc || thumbImg?.src || undefined;
    const msrc = options.mediumSrc.value || flipSrc;

    // 悬浮预览用 object-fit: contain（不裁剪），缩略图用 object-fit: cover（裁剪）
    const isPreviewEl = thumbEl?.classList.contains('global-thumb-hover-preview');
    const isCropped = !isPreviewEl;

    // 只有源元素足够大时才用 zoom，否则降级为 fade（避免从极小缩略图做 FLIP 导致跳跃感和模糊占位图）
    const thumbWidth = thumbEl?.getBoundingClientRect().width ?? 0;
    const useZoom = !!(thumbEl && thumbWidth >= FLIP_MIN_WIDTH);

    pswp = new PhotoSwipe(buildPswpOptions({ src, msrc, w, h, thumbEl, useZoom, isCropped, id }));
    currentLoadingId = id;
    currentLoadingSrc = src;
    closeTargetMode = 'auto';
    // 重置方向：上一次会话残留的值不应影响新灯箱的首次切换判定
    switchDirection.value = null;
    // 模糊背景优先用中图（LQIP）；回落 FLIP 占位图；再回落原图
    blurSrc.value = options.mediumSrc.value || flipSrc || src;

    // thumbEl filter：每次计算 FLIP 起止点时实时查 DOM，作为 thumbCropped 的 SSOT
    //
    // 为什么 filter 也要管 thumbCropped：
    // Vue 默认 watch flush='pre' 会让 updateSlideContent 在 DOM 更新前跑，
    // 此时 findThumbElement 只能匹配旧的悬浮预览 data-lightbox-id → 落在小缩略图上。
    // 关闭瞬间 DOM 已 flush，filter 能找到真正的悬浮预览（contain），但若 data.thumbCropped
    // 仍是 updateSlideContent 写入的 true（按 cover 算 innerRect），长宽比悬殊的图会
    // 在 FLIP 末端出现落点偏移。filter 与 element 一起同步 thumbCropped，避免这种错配。
    //
    // 返回 undefined（NO_THUMB）时 PhotoSwipe 源码会把 _thumbBounds 留空，自动降级 fade
    pswp.addFilter('thumbEl', (_thumbEl, data, _index) => {
      const currentId = options.itemId.value;
      if (!currentId) return _thumbEl as HTMLElement;
      const el = findThumbElement(currentId, closeTargetMode);
      // 缩略图已被虚拟滚动回收、或源尺寸过小 → 交给 PhotoSwipe 降级 fade
      if (!el) return NO_THUMB;
      const rect = el.getBoundingClientRect();
      if (closeTargetMode !== 'thumb' && rect.width < FLIP_MIN_WIDTH) return NO_THUMB;
      // 悬浮预览 object-fit:contain → 不裁剪；小缩略图 object-fit:cover → 裁剪
      data.thumbCropped = !el.classList.contains('global-thumb-hover-preview');
      return el;
    });

    // 关闭事件 → 同步回 Vue
    // thisInstance 守卫：防止旧实例的 close 事件在新实例创建后仍干扰状态
    const thisInstance = pswp;
    pswp.on('close', () => {
      if (pswp !== thisInstance) return;
      closeTargetMode = options.resolveCloseTargetMode?.() ?? 'auto';
      pswpEl.value = null;
      blurSrc.value = null;
      clearLoadingIndicator();
      clearLoadRetryTimer();
      loadRetryCounts.clear();
      currentLoadingId = undefined;
      currentLoadingSrc = undefined;
      pswp = null;
      options.onClose();
    });

    // 滚轮事件拦截（非 Ctrl 时用于翻页）
    pswp.on('wheel', (e) => {
      const we = e.originalEvent as WheelEvent;
      if (!we.ctrlKey) {
        e.preventDefault();
        handleWheel(we);
      }
    });

    // 加载状态：仅响应「当前 active content」的事件，过滤掉孤儿 content 的串扰
    pswp.on('contentLoad', (e) => {
      if (!isCurrentContent(e.content)) return;
      scheduleLoadingIndicator();
    });
    pswp.on('contentLoadImage', (e) => {
      if (!isCurrentContent(e.content)) return;
      applyImageRequestAttributes(e.content);
      markFullImageWaiting(e.content);
    });
    pswp.on('loadComplete', (e) => {
      if (!isCurrentContent(e.content)) return;
      if (e.isError) {
        clearLoadingIndicator();
        if (!scheduleLoadRetry(e.content)) options.onLoadError?.();
      } else {
        revealFullImageWhenDecoded(e.content, () => {
          clearLoadingIndicator();
          const id = getContentId(e.content);
          if (id) loadRetryCounts.delete(id);
          options.onLoadSuccess?.();
        });
      }
    });

    // 切换图片淡入动画：给每次新激活的 .pswp__img 加 is-switching-in，触发 CSS keyframes
    // 首次 activate 是开灯箱，FLIP 接管过渡，这里跳过避免双动画打架
    let isFirstActivate = true;
    pswp.on('contentActivate', (e) => {
      if (isFirstActivate) { isFirstActivate = false; return; }
      const el = e.content?.element;
      if (!(el instanceof HTMLElement)) return;
      // 方向 attr 决定 keyframes 的起始 translateX 方向（next 从右进、prev 从左进）
      // 缺省方向（如外部代码绕过 setSwitchDirection 触发 itemId 变更）走纯 fade
      if (switchDirection.value) el.dataset.switchDir = switchDirection.value;
      el.classList.add('is-switching-in');

      // 同步给占位图（PhotoSwipe 自带的 .pswp__img--placeholder）加纯 opacity 淡入：
      // 大图未加载完时占位图是用户唯一可见的视觉主体，
      // 不淡入它就会"凭空蹦出来"形成切换瞬间的明显跳变。
      // 注意：占位图自身有 transform: scale() 用作尺寸缩放（placeholder.js:44），
      // CSS keyframes 必须只动 opacity，否则会覆盖 inline transform 导致占位图错位。
      const placeholderEl = e.content?.placeholder?.element;
      if (placeholderEl instanceof HTMLElement) {
        placeholderEl.classList.add('is-switching-in');
      }
    });

    pswp.init();
    pswpEl.value = pswp.element ?? null;

    // 绑定键盘
    window.addEventListener('keydown', handleKeydown);
  }

  // ── 关闭 PhotoSwipe ─────────────────────────

  function closePswp() {
    window.removeEventListener('keydown', handleKeydown);
    if (pswp) {
      pswp.close();
    }
  }

  // ── 更新当前幻灯片内容（导航时调用） ──────────

  function updateSlideContent() {
    if (!pswp) return;
    const src = options.imageSrc.value;
    const medium = options.mediumSrc.value;
    const newId = options.itemId.value;
    const w = options.imageWidth.value || 1920;
    const h = options.imageHeight.value || 1080;
    if (!src) return;

    // element / thumbCropped 不在此处推断：Vue watch 默认 pre-flush 会让本函数在 DOM
    // 更新前跑，此时悬浮预览的 data-lightbox-id 仍是旧图，查不到正确元素。统一交给
    // thumbEl filter 在关闭瞬间实时查 DOM 并同步 thumbCropped，避免窗口期内的错配。
    //
    // ⚠️ 必须替换整个 dataSource[0] 对象而非修改字段：
    // PhotoSwipe 的 content.data 持有 dataSource[index] 的对象引用，
    // 修改字段会污染旧 content.data（导致孤儿事件过滤失效）
    const newData = {
      src,
      msrc: medium || undefined,
      width: w,
      height: h,
      id: newId,
    };
    pswp.options.dataSource = [newData];
    currentLoadingId = newId;
    currentLoadingSrc = src;
    if (newId) loadRetryCounts.delete(newId);
    // 旧 content 的孤儿事件可能在 refresh 后延迟触发，主动预清避免残留 spinner
    clearLoadingIndicator();
    clearLoadRetryTimer();
    pswp.refreshSlideContent(0);
    // 模糊背景：导航时用中图（秒到），避免切换瞬间变黑
    blurSrc.value = medium || src;
  }

  // ── Watch: visible → 打开/关闭 ──────────────

  watch(options.visible, async (val) => {
    if (val) {
      await nextTick();
      // nextTick 期间 visible 可能已被关闭（快速开关竞态），需二次验证
      if (options.visible.value) openPswp();
    } else {
      closePswp();
    }
  });

  // ── Watch: itemId → 内容切换（导航） ─────────

  watch(options.itemId, (newId, oldId) => {
    if (newId && newId !== oldId && pswp) {
      // 等 Vue 更新完 imageSrc 等计算属性
      nextTick(() => updateSlideContent());
    }
  });

  watch(
    () => [options.itemId.value, options.imageSrc.value, options.mediumSrc.value] as const,
    ([newId, newSrc], [oldId, oldSrc]) => {
      if (!newId || newId !== oldId || newSrc === oldSrc || !pswp) return;
      nextTick(() => updateSlideContent());
    },
  );

  // ── 清理 ────────────────────────────────────

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown);
    if (wheelTimer) { clearTimeout(wheelTimer); wheelTimer = null; }
    clearLoadingIndicator();
    clearLoadRetryTimer();
    loadRetryCounts.clear();
    if (pswp) {
      pswp.destroy();
      pswp = null;
    }
  });

  return { pswpEl, blurSrc, isLoading, setSwitchDirection };
}
