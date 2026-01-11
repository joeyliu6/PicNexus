<script setup lang="ts">
import { computed } from 'vue';
import Checkbox from 'primevue/checkbox';
import Button from 'primevue/button';
import type { StorageObject } from '../types';

const props = defineProps<{
  /** 文件对象 */
  item: StorageObject;
  /** 是否选中 */
  selected: boolean;
}>();

const emit = defineEmits<{
  select: [item: StorageObject, event: MouseEvent];
  preview: [item: StorageObject];
  copyLink: [item: StorageObject];
  delete: [item: StorageObject];
  open: [item: StorageObject];
}>();

// 是否为图片
const isImage = computed(() => {
  if (props.item.type === 'folder') return false;
  const ext = props.item.name.split('.').pop()?.toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext || '');
});

// 缩略图 URL
const thumbnailUrl = computed(() => {
  if (props.item.type === 'folder') return '';
  return props.item.url || '';
});

// 图标（用于非图片文件或文件夹）
const icon = computed(() => {
  if (props.item.type === 'folder') return 'pi-folder';
  if (!isImage.value) return 'pi-file';
  return '';
});

// 格式化文件大小
const formatSize = (bytes: number): string => {
  if (bytes === 0) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
};

// 处理点击
const handleClick = (e: MouseEvent) => {
  emit('select', props.item, e);
};

// 处理双击
const handleDoubleClick = () => {
  if (props.item.type === 'folder') {
    emit('open', props.item);
  } else if (isImage.value) {
    emit('preview', props.item);
  }
};

// 处理复选框点击（阻止事件冒泡）
const handleCheckboxClick = (e: MouseEvent) => {
  e.stopPropagation();
  emit('select', props.item, e);
};
</script>

<template>
  <div
    class="file-grid-item"
    :class="{ selected, folder: item.type === 'folder' }"
    @click="handleClick"
    @dblclick="handleDoubleClick"
  >
    <!-- 选择复选框 -->
    <div class="item-checkbox" @click.stop="handleCheckboxClick">
      <Checkbox :modelValue="selected" :binary="true" />
    </div>

    <!-- 预览区域 -->
    <div class="item-preview">
      <!-- 文件夹图标 -->
      <i v-if="item.type === 'folder'" class="pi pi-folder folder-icon"></i>

      <!-- 图片预览 -->
      <img
        v-else-if="isImage && thumbnailUrl"
        :src="thumbnailUrl"
        :alt="item.name"
        class="item-image"
        loading="lazy"
      />

      <!-- 非图片文件图标 -->
      <i v-else :class="`pi ${icon}`" class="file-icon"></i>
    </div>

    <!-- 文件信息 -->
    <div class="item-info">
      <p class="item-name" :title="item.name">{{ item.name }}</p>
      <p class="item-size">{{ formatSize(item.size) }}</p>
    </div>

    <!-- 操作按钮 -->
    <div class="item-actions">
      <Button
        v-if="item.type === 'file' && isImage"
        icon="pi pi-eye"
        @click.stop="emit('preview', item)"
        size="small"
        text
        rounded
        v-tooltip.top="'预览'"
      />
      <Button
        v-if="item.type === 'file'"
        icon="pi pi-copy"
        @click.stop="emit('copyLink', item)"
        size="small"
        text
        rounded
        v-tooltip.top="'复制链接'"
      />
      <Button
        icon="pi pi-trash"
        @click.stop="emit('delete', item)"
        severity="danger"
        size="small"
        text
        rounded
        v-tooltip.top="'删除'"
      />
    </div>
  </div>
</template>

<style scoped>
.file-grid-item {
  position: relative;
  background: var(--bg-input);
  border: 2px solid transparent;
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  cursor: pointer;
}

.file-grid-item:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-float);
}

.file-grid-item.selected {
  border-color: var(--primary);
  background: rgba(59, 130, 246, 0.08);
}

.file-grid-item.folder .item-preview {
  background: rgba(59, 130, 246, 0.08);
}

/* 复选框 */
.item-checkbox {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  background: var(--bg-card);
  padding: 4px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.file-grid-item:hover .item-checkbox,
.file-grid-item.selected .item-checkbox {
  opacity: 1;
}

/* 预览区域 */
.item-preview {
  width: 100%;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--bg-app);
}

.item-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.2s;
}

.file-grid-item:hover .item-image {
  transform: scale(1.05);
}

.folder-icon {
  font-size: 4rem;
  color: var(--primary);
  opacity: 0.8;
}

.file-icon {
  font-size: 3rem;
  color: var(--text-muted);
}

/* 文件信息 */
.item-info {
  padding: 10px 12px 6px;
  flex-shrink: 0;
}

.item-name {
  margin: 0 0 4px 0;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-size {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

/* 操作按钮 */
.item-actions {
  display: flex;
  justify-content: center;
  gap: 2px;
  padding: 6px 8px 8px;
  background: var(--bg-app);
  border-top: 1px solid var(--border-subtle);
  opacity: 0;
  transition: opacity 0.2s;
}

.file-grid-item:hover .item-actions {
  opacity: 1;
}
</style>
