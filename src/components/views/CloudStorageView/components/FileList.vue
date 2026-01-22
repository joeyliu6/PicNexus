<script setup lang="ts">
import { computed } from 'vue';
import Message from 'primevue/message';
import Checkbox from 'primevue/checkbox';
import FileListItem from './FileListItem.vue';
import EmptyState from './EmptyState.vue';
import type { StorageObject } from '../types';

const props = defineProps<{
  items: StorageObject[];
  selectedKeys: Set<string>;
  loading: boolean;
  error: string | null;
  isDragging?: boolean;
  allSelected?: boolean;
}>();

const emit = defineEmits<{
  select: [item: StorageObject, event: MouseEvent];
  preview: [item: StorageObject];
  copyLink: [item: StorageObject];
  delete: [item: StorageObject];
  open: [item: StorageObject];
  upload: [];
  showDetail: [item: StorageObject];
  selectAll: [checked: boolean];
}>();

const isSelected = (item: StorageObject) => props.selectedKeys.has(item.key);

// 全选状态（考虑部分选中）
const isIndeterminate = computed(() => {
  const selectedCount = props.selectedKeys.size;
  return selectedCount > 0 && selectedCount < props.items.length;
});

// 统一视图状态：骨架屏 / 错误 / 空状态 / 内容
type ViewState = 'skeleton' | 'error' | 'empty' | 'content';
const viewState = computed<ViewState>(() => {
  if (props.loading && props.items.length === 0) return 'skeleton';
  if (props.error && props.items.length === 0) return 'error';
  if (props.items.length === 0) return 'empty';
  return 'content';
});

const handleSelectAll = (checked: boolean) => {
  emit('selectAll', checked);
};
</script>

<template>
  <div class="file-list-wrapper" :class="{ dragging: isDragging }">
    <!-- 拖拽上传遮罩 -->
    <Transition name="fade">
      <div v-if="isDragging" class="drag-overlay">
        <div class="drag-content">
          <div class="drag-icon-wrapper">
            <i class="pi pi-cloud-upload drag-icon"></i>
          </div>
          <p class="drag-title">释放以上传文件</p>
          <p class="drag-hint">支持批量上传图片</p>
        </div>
      </div>
    </Transition>

    <!-- 统一过渡：骨架屏 / 错误 / 空状态 / 内容（互斥渲染，避免重叠闪烁） -->
    <Transition name="fade" mode="out-in">
      <!-- 骨架屏加载状态 -->
      <div v-if="viewState === 'skeleton'" key="skeleton" class="skeleton-list">
        <div class="skeleton-header">
          <div class="skeleton-checkbox"></div>
          <div class="skeleton-header-name"></div>
          <div class="skeleton-header-type"></div>
          <div class="skeleton-header-size"></div>
          <div class="skeleton-header-time"></div>
        </div>
        <div class="skeleton-row">
          <div class="skeleton-checkbox"></div>
          <div class="skeleton-name" style="width: 45%"></div>
          <div class="skeleton-type"></div>
          <div class="skeleton-size"></div>
          <div class="skeleton-time"></div>
        </div>
      </div>

      <!-- 错误状态 -->
      <Message v-else-if="viewState === 'error'" key="error" severity="error" :closable="false">
        {{ error }}
      </Message>

      <!-- 空状态 -->
      <EmptyState
        v-else-if="viewState === 'empty'"
        key="empty"
        icon="pi-cloud-upload"
        title="暂无文件"
      />

      <!-- 文件列表 -->
      <div v-else key="content" class="list-container">
        <div class="list-header">
          <div class="header-checkbox">
            <Checkbox
              :modelValue="allSelected"
              :indeterminate="isIndeterminate"
              @update:modelValue="handleSelectAll"
              binary
            />
          </div>
          <div class="header-name">文件名</div>
          <div class="header-type">类型</div>
          <div class="header-meta">
            <span class="header-size">大小</span>
            <span class="header-time">修改时间</span>
          </div>
        </div>

        <div class="list-content">
          <FileListItem
            v-for="item in items"
            :key="item.key"
            :item="item"
            :selected="isSelected(item)"
            @select="(i, e) => emit('select', i, e)"
            @preview="(i) => emit('preview', i)"
            @copy-link="(i) => emit('copyLink', i)"
            @delete="(i) => emit('delete', i)"
            @open="(i) => emit('open', i)"
            @show-detail="(i) => emit('showDetail', i)"
          />
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.file-list-wrapper {
  position: relative;
  height: 100%;
  overflow: hidden;
}

.file-list-wrapper.dragging {
  border: 2px dashed var(--primary);
}

/* 拖拽遮罩 */
.drag-overlay {
  position: absolute;
  inset: 0;
  background: rgba(var(--primary-rgb, 59, 130, 246), 0.08);
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
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: rgba(var(--primary-rgb, 59, 130, 246), 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 24px;
  animation: breathe 2s ease-in-out infinite;
}

@keyframes breathe {
  0%, 100% { transform: scale(1); opacity: 0.8; }
  50% { transform: scale(1.05); opacity: 1; }
}

.drag-icon {
  font-size: 3rem;
  color: var(--primary);
}

.drag-title {
  font-size: 1.25rem;
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
.skeleton-list {
  padding: 8px;
}

.skeleton-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: 6px;
}

.skeleton-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.skeleton-checkbox {
  width: 32px;
  height: 18px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.skeleton-checkbox::after {
  content: '';
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--bg-app) 25%, var(--bg-secondary) 50%, var(--bg-app) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.skeleton-header-name {
  flex: 1;
  height: 12px;
  width: 40px;
  max-width: 40px;
  background: linear-gradient(90deg, var(--bg-app) 25%, var(--bg-secondary) 50%, var(--bg-app) 75%);
  background-size: 200% 100%;
  border-radius: 4px;
  animation: shimmer 1.5s infinite;
}

.skeleton-header-type {
  width: 60px;
  height: 12px;
  flex-shrink: 0;
  background: linear-gradient(90deg, var(--bg-app) 25%, var(--bg-secondary) 50%, var(--bg-app) 75%);
  background-size: 200% 100%;
  border-radius: 4px;
  animation: shimmer 1.5s infinite;
}

.skeleton-header-size {
  width: 80px;
  height: 12px;
  flex-shrink: 0;
  background: linear-gradient(90deg, var(--bg-app) 25%, var(--bg-secondary) 50%, var(--bg-app) 75%);
  background-size: 200% 100%;
  border-radius: 4px;
  animation: shimmer 1.5s infinite;
}

.skeleton-header-time {
  width: 90px;
  height: 12px;
  flex-shrink: 0;
  background: linear-gradient(90deg, var(--bg-app) 25%, var(--bg-secondary) 50%, var(--bg-app) 75%);
  background-size: 200% 100%;
  border-radius: 4px;
  animation: shimmer 1.5s infinite;
}

.skeleton-name {
  flex: 1;
  height: 14px;
  min-width: 100px;
  background: linear-gradient(90deg, var(--bg-app) 25%, var(--bg-secondary) 50%, var(--bg-app) 75%);
  background-size: 200% 100%;
  border-radius: 4px;
  animation: shimmer 1.5s infinite;
}

.skeleton-type {
  width: 40px;
  height: 12px;
  flex-shrink: 0;
  background: linear-gradient(90deg, var(--bg-app) 25%, var(--bg-secondary) 50%, var(--bg-app) 75%);
  background-size: 200% 100%;
  border-radius: 4px;
  animation: shimmer 1.5s infinite;
}

.skeleton-size {
  width: 50px;
  height: 12px;
  flex-shrink: 0;
  background: linear-gradient(90deg, var(--bg-app) 25%, var(--bg-secondary) 50%, var(--bg-app) 75%);
  background-size: 200% 100%;
  border-radius: 4px;
  animation: shimmer 1.5s infinite;
}

.skeleton-time {
  width: 70px;
  height: 12px;
  flex-shrink: 0;
  background: linear-gradient(90deg, var(--bg-app) 25%, var(--bg-secondary) 50%, var(--bg-app) 75%);
  background-size: 200% 100%;
  border-radius: 4px;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

/* 列表容器 */
.list-container {
  height: 100%;
  overflow-y: auto;
  padding: 8px;
}

/* 列表表头 */
.list-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
  position: sticky;
  top: -8px;
  z-index: 10;
  margin: -8px -8px 6px -8px;
}

.header-checkbox {
  width: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-name {
  flex: 1;
  min-width: 0;
}

.header-type {
  width: 60px;
  flex-shrink: 0;
  text-align: center;
}

.header-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
}

.header-size {
  width: 80px;
  text-align: right;
}

.header-time {
  width: 90px;
  text-align: right;
}

.list-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 -8px;
}

/* 滚动条 */
.list-container::-webkit-scrollbar {
  width: 6px;
}

.list-container::-webkit-scrollbar-track {
  background: transparent;
}

.list-container::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 3px;
}

.list-container::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}

/* 动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
