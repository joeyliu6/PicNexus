<script setup lang="ts">
import { computed } from 'vue';
import Checkbox from 'primevue/checkbox';
import type { StorageObject } from '../types';

const props = defineProps<{
  item: StorageObject;
  selected: boolean;
}>();

const emit = defineEmits<{
  select: [item: StorageObject, event: MouseEvent];
  preview: [item: StorageObject];
  open: [item: StorageObject];
  showDetail: [item: StorageObject];
}>();

const isImage = computed(() => {
  if (props.item.type === 'folder') return false;
  const ext = props.item.name.split('.').pop()?.toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext || '');
});

const fileType = computed(() => {
  if (props.item.type === 'folder') return '文件夹';
  const ext = props.item.name.split('.').pop()?.toLowerCase() || '';
  const typeMap: Record<string, string> = {
    png: 'PNG', jpg: 'JPG', jpeg: 'JPG', gif: 'GIF',
    webp: 'WebP', svg: 'SVG', bmp: 'BMP', ico: 'ICO',
    pdf: 'PDF', json: 'JSON', txt: 'TXT',
  };
  return typeMap[ext] || ext.toUpperCase() || '-';
});

const formatSize = (bytes: number): string => {
  if (bytes === 0) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
};

const formatDate = (date: Date): string => {
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
};

const handleCheckboxClick = (e: MouseEvent) => {
  e.stopPropagation();
  emit('select', props.item, e);
};

const handleRowClick = () => {
  if (props.item.type === 'folder') {
    emit('open', props.item);
  } else if (isImage.value) {
    emit('showDetail', props.item);
  } else {
    emit('showDetail', props.item);
  }
};
</script>

<template>
  <div
    class="file-list-item"
    :class="{
      'is-selected': selected,
      'is-folder': item.type === 'folder',
    }"
    @click="handleRowClick"
  >
    <!-- 复选框 -->
    <div class="item-checkbox" @click="handleCheckboxClick">
      <Checkbox
        :modelValue="selected"
        binary
        :pt="{ root: { style: 'pointer-events: none' } }"
      />
    </div>

    <!-- 文件信息 -->
    <div class="item-info">
      <i v-if="item.type === 'folder'" class="pi pi-folder folder-icon"></i>
      <span class="item-name" :title="item.name">{{ item.name }}</span>
    </div>

    <!-- 类型 -->
    <div class="item-type">{{ fileType }}</div>

    <!-- 元信息 -->
    <div class="item-meta">
      <span class="item-size">{{ formatSize(item.size) }}</span>
      <span class="item-time">{{ formatDate(item.lastModified) }}</span>
    </div>
  </div>
</template>

<style scoped>
.file-list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--bg-card);
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  border-radius: 0;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.file-list-item:hover {
  background: var(--hover-overlay);
}

.file-list-item.is-selected {
  background: rgba(var(--primary-rgb, 59, 130, 246), 0.08);
}

.item-checkbox {
  width: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.item-info .folder-icon {
  font-size: 1.1rem;
  color: var(--primary);
  flex-shrink: 0;
}

.item-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-type {
  width: 60px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
}

.item-size {
  width: 80px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: right;
}

.item-time {
  width: 90px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: right;
}
</style>
