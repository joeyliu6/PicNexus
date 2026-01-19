<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import Menu from 'primevue/menu';
import { ref } from 'vue';
import type { StorageObject } from '../types';

const props = defineProps<{
  item: StorageObject;
  selected: boolean;
}>();

const emit = defineEmits<{
  select: [item: StorageObject, event: MouseEvent];
  preview: [item: StorageObject];
  open: [item: StorageObject];
  delete: [item: StorageObject];
  copyLink: [item: StorageObject];
}>();

const menuRef = ref();

const isImage = computed(() => {
  if (props.item.type === 'folder') return false;
  const ext = props.item.name.split('.').pop()?.toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext || '');
});

const icon = computed(() => {
  if (props.item.type === 'folder') return 'pi-folder';
  if (isImage.value) return 'pi-image';
  return 'pi-file';
});

const iconColor = computed(() => {
  if (props.item.type === 'folder') return '#f59e0b';
  if (isImage.value) return '#3b82f6';
  return '#94a3b8';
});

const mimeType = computed(() => {
  if (props.item.type === 'folder') return 'folder';
  const ext = props.item.name.split('.').pop()?.toLowerCase();
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
  if (bytes === 0 || props.item.type === 'folder') return '-';
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
  }).format(date);
};

const handleRowClick = (e: MouseEvent) => {
  emit('select', props.item, e);
};

const handleNameClick = (e: MouseEvent) => {
  e.stopPropagation();
  if (props.item.type === 'folder') {
    emit('open', props.item);
  } else {
    emit('preview', props.item);
  }
};

const handleCheckboxClick = (e: MouseEvent) => {
  e.stopPropagation();
  emit('select', props.item, e);
};

const menuItems = computed(() => {
  const items = [];

  if (props.item.type === 'file') {
    if (isImage.value) {
      items.push({
        label: '预览',
        icon: 'pi pi-eye',
        command: () => emit('preview', props.item),
      });
    }
    items.push({
      label: '复制链接',
      icon: 'pi pi-link',
      command: () => emit('copyLink', props.item),
    });
    items.push({ separator: true });
  } else {
    items.push({
      label: '打开文件夹',
      icon: 'pi pi-folder-open',
      command: () => emit('open', props.item),
    });
    items.push({ separator: true });
  }

  items.push({
    label: '删除',
    icon: 'pi pi-trash',
    class: 'danger-item',
    command: () => emit('delete', props.item),
  });

  return items;
});

const showMenu = (event: MouseEvent) => {
  menuRef.value?.toggle(event);
};
</script>

<template>
  <tr
    class="file-row"
    :class="{ selected }"
    @click="handleRowClick"
  >
    <td class="cell-checkbox">
      <div
        class="row-checkbox"
        :class="{ checked: selected }"
        @click="handleCheckboxClick"
      >
        <i v-if="selected" class="pi pi-check"></i>
      </div>
    </td>

    <td class="cell-name">
      <span class="object-name" @click="handleNameClick">
        <i :class="['pi', icon]" :style="{ color: iconColor }"></i>
        <span class="name-text">{{ item.name }}</span>
      </span>
    </td>

    <td class="cell-type">{{ mimeType }}</td>

    <td class="cell-size">{{ formatSize(item.size) }}</td>

    <td class="cell-date">{{ formatDate(item.lastModified) }}</td>

    <td class="cell-actions">
      <Button
        icon="pi pi-ellipsis-v"
        text
        rounded
        size="small"
        class="action-btn"
        @click.stop="showMenu"
      />
      <Menu ref="menuRef" :model="menuItems" :popup="true" />
    </td>
  </tr>
</template>

<style scoped>
.file-row {
  transition: background-color 0.15s;
  cursor: pointer;
}

.file-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.file-row.selected {
  background: rgba(59, 130, 246, 0.08);
}

.file-row td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 14px;
  color: var(--text-primary);
  vertical-align: middle;
}

.cell-checkbox {
  width: 48px;
}

.row-checkbox {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-subtle);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  background: transparent;
  opacity: 0;
}

.file-row:hover .row-checkbox,
.file-row.selected .row-checkbox {
  opacity: 1;
}

.row-checkbox:hover {
  border-color: var(--primary);
}

.row-checkbox.checked {
  background: var(--primary);
  border-color: var(--primary);
}

.row-checkbox .pi {
  font-size: 12px;
  color: white;
  font-weight: 600;
}

.cell-name {
  min-width: 200px;
}

.object-name {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--primary);
  cursor: pointer;
  transition: color 0.15s;
}

.object-name:hover {
  text-decoration: underline;
}

.object-name .pi {
  font-size: 16px;
  flex-shrink: 0;
}

.name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-type {
  width: 120px;
  color: var(--text-muted);
  font-size: 13px;
}

.cell-size {
  width: 100px;
  text-align: right;
  color: var(--text-secondary);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.cell-date {
  width: 180px;
  color: var(--text-muted);
  font-size: 13px;
}

.cell-actions {
  width: 48px;
  text-align: center;
}

.action-btn {
  opacity: 0;
  transition: opacity 0.15s;
  color: var(--text-muted);
}

.file-row:hover .action-btn {
  opacity: 1;
}

.action-btn:hover {
  color: var(--text-primary);
  background: var(--hover-overlay);
}

:deep(.danger-item) {
  color: var(--error) !important;
}

:deep(.danger-item .p-menuitem-icon) {
  color: var(--error) !important;
}

@media (max-width: 1200px) {
  .cell-type { display: none; }
}

@media (max-width: 900px) {
  .cell-date { display: none; }
}
</style>
