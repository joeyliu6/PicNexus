<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import type { StorageObject, ViewMode } from '../types';

const props = withDefaults(
  defineProps<{
    /** 文件对象 */
    item: StorageObject;
    /** 是否选中 */
    selected: boolean;
    /** 视图模式 */
    viewMode?: ViewMode;
  }>(),
  {
    viewMode: 'grid',
  }
);

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
    class="file-card"
    :class="{
      'is-selected': selected,
      'is-folder': item.type === 'folder',
      'list-mode': viewMode === 'list',
    }"
    @click="handleClick"
    @dblclick="handleDoubleClick"
  >
    <!-- 选择复选框 -->
    <div class="selection-checkbox" @click.stop="handleCheckboxClick">
      <i v-if="selected" class="pi pi-check check-icon"></i>
    </div>

    <!-- 缩略图区域 -->
    <div class="thumbnail-wrapper">
      <!-- 文件夹图标 -->
      <div v-if="item.type === 'folder'" class="folder-icon-wrapper">
        <i class="pi pi-folder folder-icon"></i>
      </div>

      <!-- 图片预览 -->
      <img
        v-else-if="isImage && thumbnailUrl"
        :src="thumbnailUrl"
        :alt="item.name"
        class="file-image"
        loading="lazy"
      />

      <!-- 非图片文件图标 -->
      <div v-else class="generic-file-icon">
        <i :class="`pi ${icon}`"></i>
      </div>
    </div>

    <!-- 文件信息 -->
    <div class="file-info">
      <div class="file-name" :title="item.name">{{ item.name }}</div>
      <div class="file-meta">
        <span class="file-size">{{ formatSize(item.size) }}</span>
      </div>
    </div>

    <!-- 悬浮操作按钮 -->
    <div class="hover-actions">
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
/* 文件卡片主容器 */
.file-card {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
  cursor: pointer;
  height: 100%;
}

.file-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-float);
  border-color: var(--primary);
}

.file-card.is-selected {
  border-color: var(--primary);
  background: var(--selected-bg);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}

/* 复选框样式 */
.selection-checkbox {
  position: absolute;
  top: 10px;
  left: 10px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.6);
  background: rgba(0, 0, 0, 0.3);
  opacity: 0;
  transition: all 0.2s;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}

.file-card:hover .selection-checkbox,
.file-card.is-selected .selection-checkbox {
  opacity: 1;
}

.file-card.is-selected .selection-checkbox {
  background: var(--primary);
  border-color: var(--primary);
}

.check-icon {
  font-size: 12px;
  color: white;
  font-weight: 600;
}

/* 缩略图区域 */
.thumbnail-wrapper {
  aspect-ratio: 1;
  width: 100%;
  background: var(--bg-app);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
}

.file-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s ease;
}

.file-card:hover .file-image {
  transform: scale(1.05);
}

/* 文件夹图标 */
.folder-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(245, 158, 11, 0.02));
}

.folder-icon {
  font-size: 3.5rem;
  color: #f59e0b;
  opacity: 0.85;
  transition: transform 0.2s, opacity 0.2s;
}

.file-card:hover .folder-icon {
  transform: scale(1.1);
  opacity: 1;
}

/* 通用文件图标 */
.generic-file-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.generic-file-icon i {
  font-size: 3rem;
  color: var(--text-muted);
  opacity: 0.6;
}

/* 文件信息区域 */
.file-info {
  padding: 12px;
  flex-shrink: 0;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-card);
}

.file-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
  line-height: 1.3;
}

.file-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.file-size {
  font-size: 11px;
  color: var(--text-muted);
}

/* 悬浮操作按钮 */
.hover-actions {
  position: absolute;
  bottom: 56px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  gap: 4px;
  padding: 8px;
  background: linear-gradient(to top, var(--bg-card) 0%, transparent 100%);
  opacity: 0;
  transform: translateY(8px);
  transition: all 0.2s;
}

.file-card:hover .hover-actions {
  opacity: 1;
  transform: translateY(0);
}

/* 文件夹特殊样式 */
.file-card.is-folder .thumbnail-wrapper {
  background: transparent;
}

/* ========== 列表模式样式 ========== */
.file-card.list-mode {
  flex-direction: row;
  height: 100%;
  border-radius: 8px;
  padding: 4px;
  gap: 12px;
}

.file-card.list-mode:hover {
  transform: none;
}

.file-card.list-mode .selection-checkbox {
  position: static;
  flex-shrink: 0;
  margin: auto 0;
  opacity: 0;
}

.file-card.list-mode:hover .selection-checkbox,
.file-card.list-mode.is-selected .selection-checkbox {
  opacity: 1;
}

.file-card.list-mode .thumbnail-wrapper {
  width: 44px;
  height: 44px;
  aspect-ratio: 1;
  border-radius: 6px;
  flex-shrink: 0;
}

.file-card.list-mode .folder-icon {
  font-size: 1.5rem;
}

.file-card.list-mode .generic-file-icon i {
  font-size: 1.5rem;
}

.file-card.list-mode .file-info {
  flex: 1;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  display: flex;
  border-top: none;
  padding: 0;
  min-width: 0;
  background: transparent;
}

.file-card.list-mode .file-name {
  flex: 1;
  margin-bottom: 0;
  min-width: 0;
}

.file-card.list-mode .file-meta {
  flex-shrink: 0;
  margin-left: 16px;
}

.file-card.list-mode .hover-actions {
  position: static;
  opacity: 0;
  background: none;
  transform: none;
  padding: 0;
  margin-left: 8px;
  flex-shrink: 0;
}

.file-card.list-mode:hover .hover-actions {
  opacity: 1;
}
</style>
