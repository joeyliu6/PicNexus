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
export const HIDE_ANIMATION_DURATION = 200;
export const ZOOM_ANIMATION_DURATION = 250;

/**
 * 加载指示器延迟（ms）
 * 快图（缓存命中、小图秒到）在此窗口内完成即不显示 spinner，避免闪屏；
 * 超出则认定为"慢图"淡入指示器。200ms 是人感「即时」阈值上限（NN Group 研究：<400ms 感受为即时）
 */
const LOADING_INDICATOR_DELAY = 200;

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
  /** 是否有上一张 */
  hasPrev: Ref<boolean>;
  /** 是否有下一张 */
  hasNext: Ref<boolean>;
}

/** FLIP 动画源元素的最小宽度阈值（px），低于此值降级为 fade */
const FLIP_MIN_WIDTH = 100;

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
    bgOpacity: 0.65,
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
function findThumbElement(itemId: string): HTMLElement | undefined {
  const els = document.querySelectorAll(`[data-lightbox-id="${itemId}"]`);
  let bestEl: HTMLElement | undefined;
  let bestArea = 0;
  for (const el of els) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight) {
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        bestEl = el as HTMLElement;
      }
    }
  }
  return bestEl;
}

export function usePhotoSwipeBridge(options: PhotoSwipeBridgeOptions) {
  let pswp: PhotoSwipe | null = null;
  /** PhotoSwipe 根元素，供 Vue Teleport 挂载自定义 UI */
  const pswpEl = ref<HTMLElement | null>(null);
  /** 模糊背景图源：全程优先取中图（LQIP），加载秒到；无中图时回落到原图 */
  const blurSrc = ref<string | null>(null);
  /** 大图加载中（延迟 LOADING_INDICATOR_DELAY 后才置 true，避免快图闪 spinner） */
  const isLoading = ref(false);
  let loadingDelayTimer: ReturnType<typeof setTimeout> | null = null;

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

  /** 判断事件对应的 content 是否为当前 active content（孤儿过滤） */
  function isCurrentContent(eventContent: unknown): boolean {
    if (!pswp) return false;
    const active = pswp.currSlide?.content;
    if (active && eventContent === active) return true;
    // A 方案时机缝隙兜底（refreshSlideContent 瞬间 currSlide 可能短暂不稳定）
    const data = (eventContent as { data?: { id?: string } } | null)?.data;
    return data?.id !== undefined && data.id === currentLoadingId;
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

  // ── 键盘导航（PhotoSwipe 原生仅处理 Esc） ──────

  function handleKeydown(e: KeyboardEvent) {
    if (!pswp) return;
    if (e.key === 'ArrowLeft' && options.hasPrev.value) {
      e.preventDefault();
      options.onNavigate('prev');
    }
    if (e.key === 'ArrowRight' && options.hasNext.value) {
      e.preventDefault();
      options.onNavigate('next');
    }
  }

  // ── 滚轮导航（非 Ctrl 时前后翻页，Ctrl 交给 PhotoSwipe 缩放） ──

  let wheelTimer: ReturnType<typeof setTimeout> | null = null;

  function handleWheel(e: WheelEvent) {
    if (!pswp || e.ctrlKey) return; // Ctrl+wheel 交给 PhotoSwipe 缩放
    if (wheelTimer) return;
    wheelTimer = setTimeout(() => { wheelTimer = null; }, 200);
    if (e.deltaY > 0 && options.hasNext.value) options.onNavigate('next');
    else if (e.deltaY < 0 && options.hasPrev.value) options.onNavigate('prev');
  }

  // ── 打开 PhotoSwipe ─────────────────────────

  function openPswp() {
    // 若已有实例存活（快速开关时上一次 close 动画尚未结束），跳过以防重复叠加
    if (pswp) return;
    const src = options.imageSrc.value;
    const id = options.itemId.value;
    if (!src || !id) return;

    const thumbEl = findThumbElement(id);
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
    // 模糊背景优先用中图（LQIP）；回落 FLIP 占位图；再回落原图
    blurSrc.value = options.mediumSrc.value || flipSrc || src;

    // thumbEl filter：每次计算 FLIP 起止点时实时查 DOM
    // 导航到其他图片后再关闭，仍能精准飞回当前图片对应的缩略图，而非初始那张
    // 返回 undefined 时 PhotoSwipe 源码会把 _thumbBounds 留空，自动降级 fade（不会报错）
    pswp.addFilter('thumbEl', (_thumbEl, _data, _index) => {
      const currentId = options.itemId.value;
      if (!currentId) return _thumbEl as HTMLElement;
      const el = findThumbElement(currentId);
      // 缩略图已被虚拟滚动回收、或源尺寸过小 → 交给 PhotoSwipe 降级 fade
      if (!el) return undefined as unknown as HTMLElement;
      const rect = el.getBoundingClientRect();
      if (rect.width < FLIP_MIN_WIDTH) return undefined as unknown as HTMLElement;
      return el;
    });

    // 关闭事件 → 同步回 Vue
    // thisInstance 守卫：防止旧实例的 close 事件在新实例创建后仍干扰状态
    const thisInstance = pswp;
    pswp.on('close', () => {
      if (pswp !== thisInstance) return;
      pswpEl.value = null;
      blurSrc.value = null;
      clearLoadingIndicator();
      currentLoadingId = undefined;
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
    pswp.on('loadComplete', (e) => {
      if (!isCurrentContent(e.content)) return;
      clearLoadingIndicator();
      if (e.isError) options.onLoadError?.();
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

    // 同步更新 element + thumbCropped，让后续关闭动画能飞回当前图片对应的缩略图
    // thumbCropped 需与目标元素的 object-fit 一致：悬浮预览 contain 不裁剪，小缩略图 cover 裁剪
    const newThumbEl = newId ? findThumbElement(newId) : undefined;
    const isPreviewEl = newThumbEl?.classList.contains('global-thumb-hover-preview');

    // ⚠️ 必须替换整个 dataSource[0] 对象而非修改字段：
    // PhotoSwipe 的 content.data 持有 dataSource[index] 的对象引用，
    // 修改字段会污染旧 content.data（导致孤儿事件过滤失效）
    const newData = {
      src,
      msrc: medium || undefined,
      width: w,
      height: h,
      element: newThumbEl,
      thumbCropped: !!newThumbEl && !isPreviewEl,
      id: newId,
    };
    pswp.options.dataSource = [newData];
    currentLoadingId = newId;
    // 旧 content 的孤儿事件可能在 refresh 后延迟触发，主动预清避免残留 spinner
    clearLoadingIndicator();
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

  // ── 清理 ────────────────────────────────────

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown);
    if (wheelTimer) { clearTimeout(wheelTimer); wheelTimer = null; }
    clearLoadingIndicator();
    if (pswp) {
      pswp.destroy();
      pswp = null;
    }
  });

  return { pswpEl, blurSrc, isLoading };
}
