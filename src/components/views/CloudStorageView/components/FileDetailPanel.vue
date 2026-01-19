<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import CopyableUrl from './CopyableUrl.vue';
import type { StorageObject, LinkFormat } from '../types';

const props = defineProps<{
  file: StorageObject | null;
  visible: boolean;
}>();

const emit = defineEmits<{
  close: [];
  download: [file: StorageObject];
  delete: [file: StorageObject];
  copyLink: [file: StorageObject, format: LinkFormat];
}>();

const isImage = computed(() => {
  if (!props.file || props.file.type === 'folder') return false;
  const ext = props.file.name.split('.').pop()?.toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext || '');
});

const mimeType = computed(() => {
  if (!props.file) return '';
  if (props.file.type === 'folder') return 'folder';
  const ext = props.file.name.split('.').pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
  };
  return mimeMap[ext || ''] || 'application/octet-stream';
});

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

const formatDate = (date: Date): string => {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(date);
};
</script>

<template>
  <Transition name="slide">
    <div v-if="visible && file" class="detail-panel">
      <div class="detail-header">
        <Button
          icon="pi pi-arrow-left"
          text
          rounded
          size="small"
          @click="emit('close')"
          v-tooltip.right="'返回'"
        />
        <div class="header-actions">
          <Button
            icon="pi pi-download"
            label="下载"
            outlined
            size="small"
            @click="emit('download', file)"
          />
          <Button
            icon="pi pi-trash"
            label="删除"
            severity="danger"
            outlined
            size="small"
            @click="emit('delete', file)"
          />
        </div>
      </div>

      <div class="detail-path">
        <span class="path-text">{{ file.key }}</span>
        <Button
          icon="pi pi-copy"
          text
          rounded
          size="small"
          @click="emit('copyLink', file, 'url')"
          v-tooltip.left="'复制路径'"
        />
      </div>

      <div class="detail-content">
        <div v-if="isImage && file.url" class="detail-preview">
          <img :src="file.url" :alt="file.name" class="preview-image" />
        </div>

        <div class="info-section">
          <div class="section-title">对象详细信息</div>
          <div class="info-grid">
            <div class="info-row">
              <span class="info-label">创建日期</span>
              <span class="info-value">{{ formatDate(file.lastModified) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">类型</span>
              <span class="info-value">{{ mimeType }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">存储类</span>
              <span class="info-value">标准</span>
            </div>
            <div class="info-row">
              <span class="info-label">大小</span>
              <span class="info-value">{{ formatSize(file.size) }}</span>
            </div>
          </div>
        </div>

        <div v-if="file.url" class="info-section">
          <div class="section-title">URL</div>
          <div class="section-subtitle">自定义域</div>
          <CopyableUrl :url="file.url" @copy="emit('copyLink', file, 'url')" />

          <div class="url-actions">
            <Button
              icon="pi pi-link"
              label="复制 URL"
              text
              size="small"
              @click="emit('copyLink', file, 'url')"
            />
            <Button
              icon="pi pi-file-edit"
              label="复制 Markdown"
              text
              size="small"
              @click="emit('copyLink', file, 'markdown')"
            />
          </div>
        </div>

        <div class="info-section">
          <div class="section-title">自定义元数据</div>
          <div class="empty-metadata">无自定义元数据集</div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.detail-panel {
  position: absolute;
  top: 0;
  right: 0;
  width: 420px;
  height: 100%;
  background: var(--bg-card);
  border-left: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  z-index: 50;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.15);
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.detail-path {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  background: var(--bg-app);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.path-text {
  flex: 1;
  font-family: var(--font-mono, monospace);
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-all;
  line-height: 1.5;
}

.detail-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.detail-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-app);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 20px;
  max-height: 300px;
  overflow: hidden;
}

.preview-image {
  max-width: 100%;
  max-height: 260px;
  object-fit: contain;
  border-radius: 4px;
}

.info-section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.section-subtitle {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.info-grid {
  background: var(--bg-app);
  border-radius: 8px;
  overflow: hidden;
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
}

.info-row:last-child {
  border-bottom: none;
}

.info-label {
  font-size: 13px;
  color: var(--text-muted);
}

.info-value {
  font-size: 13px;
  color: var(--text-primary);
  text-align: right;
}

.url-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.empty-metadata {
  font-size: 13px;
  color: var(--text-muted);
  font-style: italic;
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}

@media (max-width: 768px) {
  .detail-panel {
    width: 100%;
    position: fixed;
    left: 0;
    right: 0;
  }
}
</style>
