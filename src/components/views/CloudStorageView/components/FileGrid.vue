<script setup lang="ts">
import { computed } from 'vue';
import ProgressSpinner from 'primevue/progressspinner';
import Message from 'primevue/message';
import VirtualGrid from './VirtualGrid.vue';
import FileGridItem from './FileGridItem.vue';
import EmptyState from './EmptyState.vue';
import type { StorageObject } from '../types';

const props = defineProps<{
  /** 对象列表 */
  items: StorageObject[];
  /** 选中的 key 集合 */
  selectedKeys: Set<string>;
  /** 是否加载中 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 是否有更多数据 */
  hasMore: boolean;
  /** 是否正在拖拽 */
  isDragging?: boolean;
}>();

const emit = defineEmits<{
  select: [item: StorageObject, event: MouseEvent];
  preview: [item: StorageObject];
  copyLink: [item: StorageObject];
  delete: [item: StorageObject];
  open: [item: StorageObject];
  loadMore: [];
  upload: [];
}>();

// 检查项目是否选中
const isSelected = (item: StorageObject) => props.selectedKeys.has(item.key);
</script>

<template>
  <div class="file-grid-wrapper" :class="{ dragging: isDragging }">
    <!-- 拖拽提示 -->
    <div v-if="isDragging" class="drag-overlay">
      <i class="pi pi-cloud-upload drag-icon"></i>
      <p>放开以上传文件</p>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading && items.length === 0" class="loading-state">
      <ProgressSpinner />
      <p>加载中...</p>
    </div>

    <!-- 错误状态 -->
    <Message v-else-if="error && items.length === 0" severity="error" :closable="false">
      {{ error }}
    </Message>

    <!-- 空状态 -->
    <EmptyState
      v-else-if="items.length === 0"
      icon="pi-inbox"
      title="暂无文件"
      description="上传图片到云存储后将在此显示"
      actionLabel="上传文件"
      actionIcon="pi-upload"
      @action="emit('upload')"
    />

    <!-- 文件网格 -->
    <VirtualGrid
      v-else
      :items="items"
      :item-width="180"
      :item-height="200"
      :gap="16"
      @scroll-end="emit('loadMore')"
    >
      <template #default="{ item }">
        <FileGridItem
          :item="item"
          :selected="isSelected(item)"
          @select="(i, e) => emit('select', i, e)"
          @preview="(i) => emit('preview', i)"
          @copy-link="(i) => emit('copyLink', i)"
          @delete="(i) => emit('delete', i)"
          @open="(i) => emit('open', i)"
        />
      </template>
    </VirtualGrid>

    <!-- 加载更多指示器 -->
    <div v-if="loading && items.length > 0" class="loading-more">
      <ProgressSpinner style="width: 24px; height: 24px" />
      <span>加载更多...</span>
    </div>
  </div>
</template>

<style scoped>
.file-grid-wrapper {
  position: relative;
  height: 100%;
  background: var(--bg-card);
  border-radius: 12px;
  overflow: hidden;
}

/* 拖拽状态 */
.file-grid-wrapper.dragging {
  border: 2px dashed var(--primary);
}

.drag-overlay {
  position: absolute;
  inset: 0;
  background: rgba(59, 130, 246, 0.1);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 100;
  backdrop-filter: blur(4px);
}

.drag-icon {
  font-size: 4rem;
  color: var(--primary);
  margin-bottom: 16px;
}

.drag-overlay p {
  font-size: 1.1rem;
  font-weight: 500;
  color: var(--primary);
}

/* 加载状态 */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  gap: 16px;
}

.loading-state p {
  color: var(--text-secondary);
  margin: 0;
}

/* 加载更多 */
.loading-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px;
  color: var(--text-secondary);
  font-size: 0.9rem;
}
</style>
