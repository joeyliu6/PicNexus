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
  /** 关闭回调 */
  onClose: () => void;
  /** 导航回调 */
  onNavigate: (direction: 'prev' | 'next') => void;
  /** 是否有上一张 */
  hasPrev: Ref<boolean>;
  /** 是否有下一张 */
  hasNext: Ref<boolean>;
}

/**
 * 在 DOM 中查找缩略图元素，用于 FLIP 动画。
 *
 * 注意：KeepAlive 会让多个视图的 DOM 同时存在。
 * 必须遍历所有匹配元素，选出真正可见的那个（rect.width > 0 且在视口内）。
 * 如果缩略图已被虚拟滚动回收或在隐藏视图中，返回 undefined → PhotoSwipe 降级为 fade。
 */
function findThumbElement(itemId: string): HTMLElement | undefined {
  const els = document.querySelectorAll(`[data-lightbox-id="${itemId}"]`);
  for (const el of els) {
    const rect = el.getBoundingClientRect();
    // 隐藏元素（KeepAlive 缓存的视图）的 rect 为 0；虚拟滚动回收的元素不在视口内
    if (rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight) {
      return el as HTMLElement;
    }
  }
  return undefined;
}

export function usePhotoSwipeBridge(options: PhotoSwipeBridgeOptions) {
  let pswp: PhotoSwipe | null = null;
  /** PhotoSwipe 根元素，供 Vue Teleport 挂载自定义 UI */
  const pswpEl = ref<HTMLElement | null>(null);

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
    const src = options.imageSrc.value;
    const id = options.itemId.value;
    if (!src || !id) return;

    const thumbEl = findThumbElement(id);
    const w = options.imageWidth.value || 1920;
    const h = options.imageHeight.value || 1080;

    // 从缩略图元素提取已加载的图片 URL 作为过渡占位图，避免动画期间只显示黑色背景
    const thumbImg = thumbEl?.querySelector('img');
    const msrc = thumbImg?.currentSrc || thumbImg?.src || undefined;

    pswp = new PhotoSwipe({
      dataSource: [{
        src,
        msrc,
        width: w,
        height: h,
        element: thumbEl,
        thumbCropped: true, // 缩略图使用 object-fit: cover 裁切
      }],
      index: 0,
      bgOpacity: 0.85,
      showHideAnimationType: thumbEl ? 'zoom' : 'fade',
      showAnimationDuration: 300,
      hideAnimationDuration: 200,
      zoomAnimationDuration: 250,
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
    });

    // 关闭事件 → 同步回 Vue
    pswp.on('close', () => {
      pswpEl.value = null;
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
    const w = options.imageWidth.value || 1920;
    const h = options.imageHeight.value || 1080;
    if (!src) return;

    const ds = pswp.options.dataSource;
    if (Array.isArray(ds) && ds[0]) {
      ds[0].src = src;
      ds[0].width = w;
      ds[0].height = h;
      // 清除 element 引用（导航时不需要 FLIP）
      ds[0].element = undefined;
    }
    pswp.refreshSlideContent(0);
  }

  // ── Watch: visible → 打开/关闭 ──────────────

  watch(options.visible, async (val) => {
    if (val) {
      await nextTick();
      openPswp();
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
    if (pswp) {
      pswp.destroy();
      pswp = null;
    }
  });

  return { pswpEl };
}
