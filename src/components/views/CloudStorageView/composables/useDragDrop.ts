// src/components/views/CloudStorageView/composables/useDragDrop.ts
// 拖拽上传逻辑

import { ref, onMounted, onUnmounted, type Ref } from 'vue';

export interface DragDropOptions {
  /** 拖拽区域元素引用 */
  dropZoneRef: Ref<HTMLElement | null>;
  /** 文件拖入回调 */
  onFilesDropped: (files: File[]) => void;
  /** 是否启用 */
  enabled?: Ref<boolean>;
}

export interface DragDropReturn {
  /** 是否正在拖拽 */
  isDragging: Ref<boolean>;
  /** 是否悬停在拖拽区域 */
  isOver: Ref<boolean>;
}

export function useDragDrop(options: DragDropOptions): DragDropReturn {
  const { dropZoneRef, onFilesDropped, enabled = ref(true) } = options;

  const isDragging = ref(false);
  const isOver = ref(false);

  // 拖拽计数器（用于处理子元素触发的事件）
  let dragCounter = 0;

  // 处理拖拽进入
  const handleDragEnter = (e: DragEvent) => {
    if (!enabled.value) return;
    e.preventDefault();
    e.stopPropagation();

    dragCounter++;
    isDragging.value = true;

    if (e.currentTarget === dropZoneRef.value) {
      isOver.value = true;
    }
  };

  // 处理拖拽离开
  const handleDragLeave = (e: DragEvent) => {
    if (!enabled.value) return;
    e.preventDefault();
    e.stopPropagation();

    dragCounter--;

    if (dragCounter === 0) {
      isDragging.value = false;
      isOver.value = false;
    }
  };

  // 处理拖拽悬停
  const handleDragOver = (e: DragEvent) => {
    if (!enabled.value) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  // 处理文件放置
  const handleDrop = (e: DragEvent) => {
    if (!enabled.value) return;
    e.preventDefault();
    e.stopPropagation();

    dragCounter = 0;
    isDragging.value = false;
    isOver.value = false;

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    // 过滤图片文件
    const imageFiles: File[] = [];
    const validExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext && validExtensions.includes(ext)) {
        imageFiles.push(file);
      }
    }

    if (imageFiles.length > 0) {
      onFilesDropped(imageFiles);
    }
  };

  // 全局拖拽事件（用于显示拖拽状态）
  const handleGlobalDragEnter = (e: DragEvent) => {
    if (!enabled.value) return;
    e.preventDefault();
    isDragging.value = true;
  };

  const handleGlobalDragLeave = (e: DragEvent) => {
    if (!enabled.value) return;
    // 只有在离开窗口时才重置
    if (e.relatedTarget === null) {
      isDragging.value = false;
      isOver.value = false;
      dragCounter = 0;
    }
  };

  // 设置事件监听
  onMounted(() => {
    const element = dropZoneRef.value;
    if (!element) return;

    element.addEventListener('dragenter', handleDragEnter);
    element.addEventListener('dragleave', handleDragLeave);
    element.addEventListener('dragover', handleDragOver);
    element.addEventListener('drop', handleDrop);

    // 全局事件
    document.addEventListener('dragenter', handleGlobalDragEnter);
    document.addEventListener('dragleave', handleGlobalDragLeave);
  });

  onUnmounted(() => {
    const element = dropZoneRef.value;
    if (element) {
      element.removeEventListener('dragenter', handleDragEnter);
      element.removeEventListener('dragleave', handleDragLeave);
      element.removeEventListener('dragover', handleDragOver);
      element.removeEventListener('drop', handleDrop);
    }

    document.removeEventListener('dragenter', handleGlobalDragEnter);
    document.removeEventListener('dragleave', handleGlobalDragLeave);
  });

  return {
    isDragging,
    isOver,
  };
}
