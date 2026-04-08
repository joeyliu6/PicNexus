import { onMounted, onUnmounted, type Ref } from 'vue';

interface LightboxKeyboardOptions {
  visible: Ref<boolean>;
  hasPrev: Ref<boolean>;
  hasNext: Ref<boolean>;
  isDragMove: () => boolean;
  isRecentDoubleClick: () => boolean;
  applyWheelZoom: (deltaY: number) => void;
  cleanupDrag: () => void;
  cleanupPreload: () => void;
  emitClose: () => void;
  emitNavigate: (direction: 'prev' | 'next') => void;
}

export function useLightboxKeyboard({
  visible,
  hasPrev,
  hasNext,
  isDragMove,
  isRecentDoubleClick,
  applyWheelZoom,
  cleanupDrag,
  cleanupPreload,
  emitClose,
  emitNavigate,
}: LightboxKeyboardOptions) {
  function closeLightbox() {
    if (isDragMove()) return;
    if (isRecentDoubleClick()) return;
    emitClose();
  }

  function navigatePrev() {
    if (hasPrev.value) emitNavigate('prev');
  }

  function navigateNext() {
    if (hasNext.value) emitNavigate('next');
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!visible.value) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') navigatePrev();
    if (e.key === 'ArrowRight') navigateNext();
  }

  let wheelThrottleTimer: ReturnType<typeof setTimeout> | null = null;

  function handleWheel(e: WheelEvent) {
    if (!visible.value) return;
    e.preventDefault();

    if (e.ctrlKey) {
      applyWheelZoom(e.deltaY);
    } else {
      if (wheelThrottleTimer) return;
      wheelThrottleTimer = setTimeout(() => { wheelThrottleTimer = null; }, 200);
      if (e.deltaY > 0) navigateNext();
      else if (e.deltaY < 0) navigatePrev();
    }
  }

  onMounted(() => window.addEventListener('keydown', handleKeydown));
  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown);
    if (wheelThrottleTimer) {
      clearTimeout(wheelThrottleTimer);
      wheelThrottleTimer = null;
    }
    cleanupDrag();
    cleanupPreload();
  });

  return { closeLightbox, navigatePrev, navigateNext, handleWheel };
}
