// src/components/views/CloudStorageView/composables/useMarqueeSelection.ts
// 框选功能逻辑

import { ref, computed, onMounted, onUnmounted, type Ref } from 'vue';

export interface SelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MarqueeSelectionOptions {
  containerRef: Ref<HTMLElement | null>;
  onSelectionChange: (rect: SelectionRect) => void;
  onSelectionEnd: () => void;
}

export function useMarqueeSelection(options: MarqueeSelectionOptions) {
  const { containerRef, onSelectionChange, onSelectionEnd } = options;

  const isSelecting = ref(false);
  const startPoint = ref({ x: 0, y: 0 });
  const currentPoint = ref({ x: 0, y: 0 });

  const selectionRect = computed<SelectionRect | null>(() => {
    if (!isSelecting.value) return null;
    return {
      left: Math.min(startPoint.value.x, currentPoint.value.x),
      top: Math.min(startPoint.value.y, currentPoint.value.y),
      width: Math.abs(currentPoint.value.x - startPoint.value.x),
      height: Math.abs(currentPoint.value.y - startPoint.value.y),
    };
  });

  const handleMouseDown = (e: MouseEvent) => {
    if (!containerRef.value) return;
    // 只在空白区域开始框选（非文件卡片）
    if ((e.target as HTMLElement).closest('.file-card')) return;
    // 只响应左键
    if (e.button !== 0) return;

    isSelecting.value = true;
    const rect = containerRef.value.getBoundingClientRect();
    const scrollLeft = containerRef.value.scrollLeft || 0;
    const scrollTop = containerRef.value.scrollTop || 0;

    startPoint.value = {
      x: e.clientX - rect.left + scrollLeft,
      y: e.clientY - rect.top + scrollTop,
    };
    currentPoint.value = { ...startPoint.value };
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isSelecting.value || !containerRef.value) return;

    const rect = containerRef.value.getBoundingClientRect();
    const scrollLeft = containerRef.value.scrollLeft || 0;
    const scrollTop = containerRef.value.scrollTop || 0;

    currentPoint.value = {
      x: e.clientX - rect.left + scrollLeft,
      y: e.clientY - rect.top + scrollTop,
    };

    if (selectionRect.value) {
      onSelectionChange(selectionRect.value);
    }
  };

  const handleMouseUp = () => {
    if (isSelecting.value) {
      onSelectionEnd();
      isSelecting.value = false;
    }
  };

  onMounted(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  });

  onUnmounted(() => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  });

  return {
    isSelecting,
    selectionRect,
    handleMouseDown,
  };
}
