import { ref, watch, type Ref, type ComputedRef } from 'vue';

/**
 * 灯箱图片预加载、加载状态管理、错误处理
 *
 * 通过 Image 预加载确认可访问后再切换 src，避免闪烁。
 * 支持延迟显示 loading 指示器（150ms 阈值），减少快图闪烁。
 */
export function useLightboxImage(
  lightboxImage: ComputedRef<string>,
  visible: Ref<boolean>,
  itemId: ComputedRef<string | undefined>,
  onReset: () => void,
) {
  const displaySrc = ref('');
  const imageReady = ref(false);
  const showLoadingIndicator = ref(false);
  const imageError = ref(false);

  /** 预加载内部状态 */
  let preloadInstance: HTMLImageElement | null = null;
  let loadingDelayTimer: ReturnType<typeof setTimeout> | null = null;

  // ── 清理预加载 ─────────────────────────────

  function cleanupPreload() {
    if (preloadInstance) {
      preloadInstance.onload = null;
      preloadInstance.onerror = null;
      preloadInstance = null;
    }
    if (loadingDelayTimer !== null) {
      clearTimeout(loadingDelayTimer);
      loadingDelayTimer = null;
    }
    showLoadingIndicator.value = false;
  }

  // ── 预加载并切换 ──────────────────────────────

  function preloadAndSwitch(newSrc: string, immediateLoading = false) {
    cleanupPreload();

    if (!newSrc) {
      displaySrc.value = '';
      // 空 URL 时清空显示，等待有效数据
      return;
    }

    if (newSrc === displaySrc.value) {
      imageError.value = false;
      return;
    }

    imageError.value = false;

    if (immediateLoading) {
      showLoadingIndicator.value = true;
    } else {
      loadingDelayTimer = setTimeout(() => {
        if (preloadInstance) showLoadingIndicator.value = true;
      }, 150);
    }

    const img = new Image();
    preloadInstance = img;

    img.onload = () => {
      if (preloadInstance !== img) return;
      cleanupPreload();
      displaySrc.value = newSrc;
      imageReady.value = true;
      imageError.value = false;
    };

    img.onerror = () => {
      if (preloadInstance !== img) return;
      cleanupPreload();
      imageError.value = true;
    };

    img.src = newSrc;
  }

  // ── img 元素 error 回调 ──────────────────────

  function onImageError() {
    // 防止预加载成功后 img 元素二次请求的竞态误报
    if (!imageReady.value) {
      imageError.value = true;
    }
    imageReady.value = false;
  }

  // ── watcher：可见性变化 ────────────────────────

  watch(visible, (val) => {
    if (val) {
      onReset();
      displaySrc.value = '';
      imageReady.value = false;
      imageError.value = false;
      preloadAndSwitch(lightboxImage.value, true);
    } else {
      cleanupPreload();
    }
  });

  // ── watcher：切换图片 ─────────────────────────

  watch(itemId, () => {
    if (visible.value) {
      onReset();
      preloadAndSwitch(lightboxImage.value);
    }
  });

  return {
    displaySrc,
    imageReady,
    showLoadingIndicator,
    imageError,
    onImageError,
    cleanupPreload,
  };
}
