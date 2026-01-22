<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import Checkbox from 'primevue/checkbox';
import type { StorageObject } from '../types';
import { formatFileSize } from '../../../../utils/formatters';

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

const itemInfoRef = ref<HTMLElement | null>(null);
const containerWidth = ref(400);

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (itemInfoRef.value) {
    containerWidth.value = itemInfoRef.value.offsetWidth;
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerWidth.value = entry.contentRect.width;
      }
    });
    resizeObserver.observe(itemInfoRef.value);
  }
});

onUnmounted(() => {
  resizeObserver?.disconnect();
});

const truncatedName = computed(() => {
  const name = props.item.name;
  const charWidth = 7;
  const maxLength = Math.max(30, Math.floor(containerWidth.value / charWidth));

  if (name.length <= maxLength) return name;

  const half = Math.floor((maxLength - 3) / 2);
  return name.slice(0, half) + '...' + name.slice(-half);
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
    <div ref="itemInfoRef" class="item-info">
      <i v-if="item.type === 'folder'" class="pi pi-folder folder-icon"></i>
      <span class="item-name" :title="item.name">{{ truncatedName }}</span>
    </div>

    <!-- 类型 -->
    <div class="item-type">{{ fileType }}</div>

    <!-- 元信息 -->
    <div class="item-meta">
      <span class="item-size">{{ formatFileSize(item.size, { emptyText: '-' }) }}</span>
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
  border: none;
  border-bottom: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 0;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.file-list-item:hover {
  background: rgba(59, 130, 246, 0.05);
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
  color: var(--text-muted);
  flex-shrink: 0;
}

.item-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-type {
  width: 60px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-tertiary);
  text-align: right;
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
