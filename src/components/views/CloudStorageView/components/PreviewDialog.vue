<script setup lang="ts">
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import type { StorageObject, LinkFormat } from '../types';

const props = defineProps<{
  /** 是否显示 */
  visible: boolean;
  /** 预览的文件 */
  file: StorageObject | null;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  copyLink: [file: StorageObject, format: LinkFormat];
  delete: [file: StorageObject];
  download: [file: StorageObject];
}>();

// 格式化文件大小
const formatSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

// 格式化日期
const formatDate = (date: Date): string => {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

// 关闭对话框
const closeDialog = () => {
  emit('update:visible', false);
};
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="emit('update:visible', $event)"
    :modal="true"
    :dismissableMask="true"
    :closable="true"
    class="preview-dialog"
    :style="{ width: '80vw', maxWidth: '1000px' }"
  >
    <template #header>
      <span>{{ file?.name }}</span>
    </template>

    <div v-if="file" class="preview-content">
      <!-- 图片预览 -->
      <div class="preview-image-wrapper">
        <img :src="file.url" :alt="file.name" class="preview-image" />
      </div>

      <!-- 文件信息 -->
      <div class="preview-info">
        <div class="info-row">
          <span class="info-label">文件名</span>
          <span class="info-value">{{ file.name }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">大小</span>
          <span class="info-value">{{ formatSize(file.size) }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">最后修改</span>
          <span class="info-value">{{ formatDate(file.lastModified) }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">路径</span>
          <span class="info-value path">{{ file.key }}</span>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="preview-footer">
        <div class="footer-left">
          <Button
            label="复制 URL"
            icon="pi pi-link"
            @click="file && emit('copyLink', file, 'url')"
            outlined
            size="small"
          />
          <Button
            label="复制 Markdown"
            icon="pi pi-file-edit"
            @click="file && emit('copyLink', file, 'markdown')"
            outlined
            size="small"
          />
        </div>
        <div class="footer-right">
          <Button
            label="下载"
            icon="pi pi-download"
            @click="file && emit('download', file)"
            outlined
            size="small"
          />
          <Button
            label="删除"
            icon="pi pi-trash"
            @click="file && emit('delete', file); closeDialog()"
            severity="danger"
            outlined
            size="small"
          />
        </div>
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.preview-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.preview-image-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-app);
  border-radius: 8px;
  overflow: hidden;
  max-height: 60vh;
}

.preview-image {
  max-width: 100%;
  max-height: 60vh;
  object-fit: contain;
}

.preview-info {
  padding: 16px;
  background: var(--bg-input);
  border-radius: 8px;
}

.info-row {
  display: flex;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.info-row:last-child {
  border-bottom: none;
}

.info-label {
  width: 100px;
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.info-value {
  flex: 1;
  color: var(--text-primary);
  font-size: 0.9rem;
  word-break: break-all;
}

.info-value.path {
  font-family: monospace;
  font-size: 0.85rem;
}

.preview-footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.footer-left,
.footer-right {
  display: flex;
  gap: 8px;
}
</style>
