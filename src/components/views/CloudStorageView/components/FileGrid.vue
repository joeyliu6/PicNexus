<script setup lang="ts">
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
    <Transition name="fade">
      <div v-if="isDragging" class="drag-overlay">
        <div class="drag-content">
          <div class="drag-icon-wrapper">
            <i class="pi pi-cloud-upload drag-icon"></i>
          </div>
          <p class="drag-title">放开以上传文件</p>
          <p class="drag-hint">支持批量上传图片</p>
        </div>
      </div>
    </Transition>

    <!-- 骨架屏加载状态 -->
    <div v-if="loading && items.length === 0" class="skeleton-grid">
      <div v-for="i in 8" :key="i" class="skeleton-card">
        <div class="skeleton-thumbnail"></div>
        <div class="skeleton-info">
          <div class="skeleton-name"></div>
          <div class="skeleton-size"></div>
        </div>
      </div>
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
      :item-height="220"
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
      <ProgressSpinner style="width: 20px; height: 20px" />
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
  background: rgba(59, 130, 246, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  backdrop-filter: blur(8px);
}

.drag-content {
  text-align: center;
}

.drag-icon-wrapper {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: rgba(59, 130, 246, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 20px;
}

.drag-icon {
  font-size: 2.5rem;
  color: var(--primary);
}

.drag-title {
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--primary);
  margin: 0 0 8px;
}

.drag-hint {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
}

/* 骨架屏 */
.skeleton-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
  padding: 16px;
}

.skeleton-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  overflow: hidden;
}

.skeleton-thumbnail {
  aspect-ratio: 1;
  background: linear-gradient(
    90deg,
    var(--bg-app) 25%,
    var(--bg-secondary) 50%,
    var(--bg-app) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.skeleton-info {
  padding: 12px;
  border-top: 1px solid var(--border-subtle);
}

.skeleton-name {
  height: 14px;
  width: 80%;
  background: var(--bg-app);
  border-radius: 4px;
  margin-bottom: 8px;
  animation: shimmer 1.5s infinite;
}

.skeleton-size {
  height: 10px;
  width: 40%;
  background: var(--bg-app);
  border-radius: 4px;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

/* 加载更多 */
.loading-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px;
  color: var(--text-secondary);
  font-size: 13px;
}

/* 淡入淡出动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
