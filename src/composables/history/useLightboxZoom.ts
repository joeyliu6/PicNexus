import { ref, computed } from 'vue';

/** 缩放常量 */
const MIN_SCALE = 0.5;
const MAX_SCALE = 5;

/**
 * 灯箱图片缩放、平移、拖拽逻辑
 *
 * 管理 scale / translate 状态，以及拖拽判定（区分点击与拖拽）。
 */
export function useLightboxZoom() {
  const imageScale = ref(1);
  const translateX = ref(0);
  const translateY = ref(0);
  const isDragging = ref(false);

  /** 拖拽内部状态（非响应式，减少开销） */
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartTranslateX = 0;
  let dragStartTranslateY = 0;
  let dragMoveDistance = 0;
  let dragRafId: number | null = null;

  /** 最近是否触发了双击（用于阻止 click 关闭） */
  let recentDoubleClick = false;

  // ── 计算属性 ──────────────────────────────

  const imageTransform = computed(() =>
    `translate(${translateX.value}px, ${translateY.value}px) scale(${imageScale.value})`
  );

  const imageCursor = computed(() =>
    isDragging.value ? 'grabbing' : 'grab'
  );

  // ── 重置 ─────────────────────────────────

  function resetZoom() {
    imageScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
  }

  // ── 双击：切换缩放 ──────────────────────────

  function handleDoubleClick() {
    recentDoubleClick = true;
    setTimeout(() => { recentDoubleClick = false; }, 0);
    if (imageScale.value !== 1) {
      resetZoom();
    }
  }

  // ── 拖拽三件套 ─────────────────────────────

  function handleImgMouseDown(e: MouseEvent) {
    isDragging.value = true;
    dragMoveDistance = 0;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartTranslateX = translateX.value;
    dragStartTranslateY = translateY.value;
    e.preventDefault();
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging.value) return;
    if (dragRafId !== null) return;
    dragRafId = requestAnimationFrame(() => {
      dragRafId = null;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      dragMoveDistance = Math.sqrt(dx * dx + dy * dy);
      translateX.value = dragStartTranslateX + dx;
      translateY.value = dragStartTranslateY + dy;
    });
  }

  function handleMouseUp() {
    isDragging.value = false;
    // 延迟重置：mouseup → click 序列中，让 closeLightbox 先判断本次是拖拽还是点击
    setTimeout(() => { dragMoveDistance = 0; }, 0);
    if (dragRafId !== null) {
      cancelAnimationFrame(dragRafId);
      dragRafId = null;
    }
  }

  // ── 滚轮缩放 ──────────────────────────────

  function applyWheelZoom(deltaY: number) {
    const delta = deltaY > 0 ? -0.15 : 0.15;
    imageScale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, imageScale.value + delta));
  }

  // ── 判定辅助 ──────────────────────────────

  /** 当前拖拽距离是否超过阈值（用于区分点击和拖拽） */
  function isDragMove(): boolean {
    return dragMoveDistance > 5;
  }

  /** 最近是否刚触发双击 */
  function isRecentDoubleClick(): boolean {
    return recentDoubleClick;
  }

  // ── 清理 ──────────────────────────────────

  function cleanupDrag() {
    if (dragRafId !== null) {
      cancelAnimationFrame(dragRafId);
      dragRafId = null;
    }
    isDragging.value = false;
    dragMoveDistance = 0;
  }

  return {
    // 响应式状态
    imageScale,
    translateX,
    translateY,
    isDragging,
    // 计算属性
    imageTransform,
    imageCursor,
    // 方法
    resetZoom,
    handleDoubleClick,
    handleImgMouseDown,
    handleMouseMove,
    handleMouseUp,
    applyWheelZoom,
    isDragMove,
    isRecentDoubleClick,
    cleanupDrag,
  };
}
