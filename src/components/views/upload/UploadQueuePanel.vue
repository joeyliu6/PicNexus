<script setup lang="ts">
// 上传队列面板组件

import { ref } from 'vue';
import UploadQueue from '../../UploadQueue.vue';
import type { ServiceType } from '../../../config/types';

// ==================== Props ====================

interface Props {
  hasFailedItems: boolean;
  hasCompletedItems: boolean;
  hasQueueItems: boolean;
  isBatchRetrying: boolean;
}

defineProps<Props>();

// ==================== Emits ====================

const emit = defineEmits<{
  'batch-retry': [];
  'clear-completed': [];
  'clear-queue': [];
}>();

// ==================== Refs & Expose ====================

const uploadQueueRef = ref<InstanceType<typeof UploadQueue>>();

/**
 * 设置重试回调（代理到内部的 UploadQueue 组件）
 */
function setRetryCallback(callback: (itemId: string, serviceId?: ServiceType) => Promise<void>) {
  if (uploadQueueRef.value) {
    uploadQueueRef.value.setRetryCallback(callback);
  }
}

defineExpose({
  setRetryCallback
});
</script>

<template>
  <div class="upload-queue-section">
    <div class="queue-header">
      <h3 class="queue-title">
        <i class="pi pi-list"></i>
        <span>上传队列</span>
      </h3>
      <div class="queue-actions">
        <button
          v-if="hasFailedItems"
          class="queue-action-btn retry-btn"
          :disabled="isBatchRetrying"
          @click="emit('batch-retry')"
        >
          <i class="pi" :class="isBatchRetrying ? 'pi-spin pi-spinner' : 'pi-refresh'"></i>
          <span>{{ isBatchRetrying ? '重传中...' : '批量重传' }}</span>
        </button>
        <button
          v-if="hasCompletedItems"
          class="queue-action-btn clear-completed-btn"
          @click="emit('clear-completed')"
        >
          <i class="pi pi-check-square"></i>
          <span>清空已完成</span>
        </button>
        <button
          v-if="hasQueueItems"
          class="queue-action-btn clear-btn"
          @click="emit('clear-queue')"
        >
          <i class="pi pi-trash"></i>
          <span>清空列表</span>
        </button>
      </div>
    </div>
    <UploadQueue ref="uploadQueueRef" />
  </div>
</template>

<style scoped>
/* 上传队列区域 */
.upload-queue-section {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 19px 24px 24px 24px;
  flex: 1;
}

.queue-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.queue-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.queue-title i {
  color: var(--primary);
  font-size: 1.3rem;
}

/* 队列操作按钮区域 */
.queue-actions {
  display: flex;
  gap: 8px;
}

.queue-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  background: transparent;
}

.queue-action-btn i {
  font-size: 14px;
}

/* 重试按钮 */
.queue-action-btn.retry-btn {
  color: var(--warning);
}

.queue-action-btn.retry-btn:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.1);
}

.queue-action-btn.retry-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 清空按钮 */
.queue-action-btn.clear-btn {
  color: var(--text-muted);
}

.queue-action-btn.clear-btn:hover {
  color: var(--error);
  background: rgba(239, 68, 68, 0.1);
}

/* 清空已完成按钮 */
.queue-action-btn.clear-completed-btn {
  color: var(--text-muted);
}

.queue-action-btn.clear-completed-btn:hover {
  color: var(--success);
  background: rgba(34, 197, 94, 0.1);
}
</style>
