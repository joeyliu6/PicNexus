<script setup lang="ts">
// src/components/views/upload/UploadDropZone.vue
// 文件上传拖拽区域组件

interface Props {
  isDragging: boolean;
  isPasting: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  click: [];
  paste: [];
  'drag-enter': [event: DragEvent];
  'drag-over': [event: DragEvent];
  'drag-leave': [event: DragEvent];
  'drop': [event: DragEvent];
}>();

function handleClick() {
  emit('click');
}

function handlePaste(e: Event) {
  // 阻止冒泡，避免触发点击事件
  e.stopPropagation();
  emit('paste');
}
</script>

<template>
  <div
    class="drop-zone"
    :class="{ dragging: isDragging }"
    @click="handleClick"
    @dragenter="emit('drag-enter', $event)"
    @dragover="emit('drag-over', $event)"
    @dragleave="emit('drag-leave', $event)"
    @drop="emit('drop', $event)"
  >
    <div class="drop-message">
      <i class="pi pi-cloud-upload drop-icon"></i>
      <p class="drop-text">拖拽图片到此处上传</p>
      <span class="drop-hint">
        或点击选择文件，或<button
          class="paste-link"
          :disabled="isPasting"
          @click="handlePaste"
          v-tooltip.top="'快捷键: Ctrl+V'"
        >{{ isPasting ? '正在粘贴...' : '从剪贴板粘贴' }}</button>
      </span>
    </div>
  </div>
</template>

<style scoped>
/* 拖拽区域 */
.drop-zone {
  background: var(--bg-card);
  border: 2px dashed var(--border-subtle);
  border-radius: 12px;
  padding: 60px 40px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
}

.drop-zone:hover {
  border-color: var(--primary);
  background: rgba(59, 130, 246, 0.05);
}

.drop-zone.dragging {
  border-color: var(--primary);
  background: rgba(59, 130, 246, 0.1);
  border-style: solid;
}

.drop-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  pointer-events: none;
}

.drop-icon {
  font-size: 3.5rem;
  color: var(--primary);
  opacity: 0.8;
}

.drop-text {
  font-size: 1.25rem;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0;
}

.drop-hint {
  font-size: 0.95rem;
  color: var(--text-secondary);
}

/* 剪贴板粘贴链接 */
.paste-link {
  /* 重置按钮默认样式 */
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: inherit;
  /* 链接样式 */
  color: var(--primary);
  cursor: pointer;
  transition: color 0.2s ease;
  pointer-events: auto;
}

.paste-link:hover:not(:disabled) {
  color: var(--primary-hover, #2563eb);
  text-decoration: underline;
}

.paste-link:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
</style>
