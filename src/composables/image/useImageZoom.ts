/**
 * 通用图片缩放、平移交互逻辑
 *
 * 用于 CompressionPreviewDialog（原图、压缩后两栏各用一份，缩放平移互不影响）。
 */
import { ref, computed, onBeforeUnmount, type Ref } from 'vue';

/** 缩放配置 */
export interface ImageZoomOptions {
  /** 最小缩放倍率，默认 0.5 */
  minScale?: number;
  /** 最大缩放倍率，默认 5 */
  maxScale?: number;
  /** 滚轮每次缩放的增量，默认 0.12 */
  wheelDelta?: number;
  /** 是否以鼠标位置为缩放中心，默认 false（纯增量缩放） */
  zoomAtCursor?: boolean;
}

export function useImageZoom(
  containerRef: Ref<HTMLElement | null>,
  options: ImageZoomOptions = {},
) {
  const {
    minScale = 0.5,
    maxScale = 5,
    wheelDelta = 0.12,
    zoomAtCursor = false,
  } = options;

  // ---- 缩放 & 平移状态 ----
  const scale = ref(1);
  const translateX = ref(0);
  const translateY = ref(0);

  // ---- 图片拖拽状态 ----
  const isDraggingImage = ref(false);
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartTX = 0;
  let dragStartTY = 0;
  /** 本次拖拽累计移动距离（用于区分拖拽和点击） */
  let dragMoveDistance = 0;
  let rafId: number | null = null;

  // ---- 计算属性 ----
  const imageTransformStyle = computed(() => ({
    transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
    transformOrigin: 'center center',
  }));

  /** 以 CSS transform 字符串形式输出（供不需要对象语法的场景） */
  const imageTransformString = computed(() =>
    `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
  );

  const zoomPercent = computed(() => Math.round(scale.value * 100));

  const imageCursor = computed(() =>
    isDraggingImage.value ? 'grabbing' : 'grab',
  );

  // ---- 重置 ----
  function resetView() {
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
  }

  // ======== 图片拖拽 ========
  function onImageDown(e: MouseEvent) {
    isDraggingImage.value = true;
    dragMoveDistance = 0;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartTX = translateX.value;
    dragStartTY = translateY.value;
    e.preventDefault();
    document.addEventListener('mousemove', onImageMove);
    document.addEventListener('mouseup', onImageUp);
  }

  function onImageMove(e: MouseEvent) {
    if (!isDraggingImage.value) return;
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      dragMoveDistance = Math.sqrt(dx * dx + dy * dy);
      translateX.value = dragStartTX + dx;
      translateY.value = dragStartTY + dy;
    });
  }

  function onImageUp() {
    isDraggingImage.value = false;
    document.removeEventListener('mousemove', onImageMove);
    document.removeEventListener('mouseup', onImageUp);
    // 延迟重置：mouseup → click 序列中，让外部先判断本次是拖拽还是点击
    setTimeout(() => { dragMoveDistance = 0; }, 0);
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // ======== 缩放 ========
  /**
   * 处理滚轮缩放
   * @param e 原生 WheelEvent
   */
  function onWheel(e: WheelEvent) {
    if (!containerRef.value) return;
    e.preventDefault();

    const oldScale = scale.value;
    const delta = e.deltaY > 0 ? -wheelDelta : wheelDelta;
    const newScale = Math.min(maxScale, Math.max(minScale, oldScale + delta));

    if (newScale !== oldScale) {
      if (zoomAtCursor) {
        // 以鼠标位置为中心缩放
        const rect = containerRef.value.getBoundingClientRect();
        const mouseX = e.clientX - rect.left - rect.width / 2;
        const mouseY = e.clientY - rect.top - rect.height / 2;
        const ratio = newScale / oldScale;
        translateX.value = mouseX - ratio * (mouseX - translateX.value);
        translateY.value = mouseY - ratio * (mouseY - translateY.value);
      }
      scale.value = newScale;
    }
  }

  /** 双击重置视图 */
  function onDoubleClick() {
    resetView();
  }

  /** 获取本次拖拽的移动距离（用于判断是否为有效拖拽） */
  function getDragDistance(): number {
    return dragMoveDistance;
  }

  // ---- 清理 ----
  function cleanup() {
    onImageUp();
  }

  onBeforeUnmount(cleanup);

  return {
    // 状态
    scale,
    translateX,
    translateY,
    isDraggingImage,

    // 计算属性
    imageTransformStyle,
    imageTransformString,
    zoomPercent,
    imageCursor,

    // 方法
    resetView,
    onImageDown,
    onWheel,
    onDoubleClick,
    getDragDistance,
    cleanup,
  };
}
