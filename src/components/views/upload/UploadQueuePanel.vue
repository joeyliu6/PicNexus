<script setup lang="ts">
// 上传队列面板组件

import { ref } from 'vue';
import UploadQueue from '../../UploadQueue.vue';

// ==================== Props ====================

interface Props {
  hasFailedItems: boolean;
  hasCompletedItems: boolean;
  hasQueueItems: boolean;
  hasActiveItems: boolean;
  isBatchRetrying: boolean;
  queueTotal: number;
  queueDone: number;
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
function setRetryCallback(callback: (itemId: string, serviceId?: string) => Promise<void>) {
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
      <h3 class="queue-title" :class="{ 'has-items': queueTotal > 0 }">
        <i class="pi pi-list"></i>
        <span>上传队列</span>
        <span v-if="queueTotal > 0" class="queue-count">{{ queueDone }}/{{ queueTotal }}</span>
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
          :disabled="hasActiveItems"
          :title="hasActiveItems ? '上传进行中，完成后再清空列表' : undefined"
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
  border-radius: var(--radius-lg);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 19px 无精确 spacing token */
  padding: 19px var(--space-xl) var(--space-xl);
  flex: 1;
}

.queue-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-lg);
}

.queue-title {
  display: flex;
  align-items: center;
  gap: var(--space-sm-md);
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
}

.queue-title i {
  color: var(--text-secondary);
  font-size: var(--text-lg);
  transition: color var(--duration-normal) ease;
}

.queue-title.has-items i {
  color: var(--primary);
}

.queue-count {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-muted);
  margin-left: var(--space-2xs);
}

/* 队列操作按钮区域 */
.queue-actions {
  display: flex;
  gap: var(--space-sm);
}

.queue-action-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs-sm);
  padding: var(--space-xs-sm) var(--space-md);
  border: none;
  border-radius: var(--radius-sm-md);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: all var(--duration-normal) ease;
  background: transparent;
}

.queue-action-btn i {
  font-size: var(--text-base);
}

/* 重试按钮 */
.queue-action-btn.retry-btn {
  color: var(--warning);
}

.queue-action-btn.retry-btn:hover:not(:disabled) {
  background: var(--warning-alpha-10);
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
  background: var(--error-alpha-10);
}

.queue-action-btn.clear-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.queue-action-btn.clear-btn:hover:disabled {
  color: var(--text-muted);
  background: transparent;
}

/* 清空已完成按钮 */
.queue-action-btn.clear-completed-btn {
  color: var(--text-muted);
}

.queue-action-btn.clear-completed-btn:hover {
  color: var(--success);
  background: var(--success-alpha-8);
}
</style>
