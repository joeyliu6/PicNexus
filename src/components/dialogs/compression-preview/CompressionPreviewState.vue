<script setup lang="ts">
import type { CompressionStatus } from '../../../composables/useCompressionTask';

interface Props {
  /** 父侧 v-if 已保证仅在 'compressing' | 'error' 下渲染本组件 */
  status: CompressionStatus;
  fileName: string;
  errorMsg: string;
}

defineProps<Props>();
const emit = defineEmits<{
  retry: [];
}>();
</script>

<template>
  <!-- 加载状态 -->
  <div v-if="status === 'compressing'" class="cpd-state">
    <div class="cpd-loading-ring">
      <i class="pi pi-spin pi-spinner" />
    </div>
    <span class="cpd-state-text">{{ fileName ? '压缩中...' : '选择图片...' }}</span>
    <span v-if="fileName" class="cpd-state-hint">{{ fileName }}</span>
  </div>

  <!-- 错误状态 -->
  <div v-else-if="status === 'error'" class="cpd-state">
    <div class="cpd-error-icon">
      <i class="pi pi-times-circle" />
    </div>
    <span class="cpd-state-text error">压缩失败</span>
    <span class="cpd-state-hint">{{ errorMsg }}</span>
    <button class="cpd-retry-btn" @click="emit('retry')">
      <i class="pi pi-refresh" />
      重新选择
    </button>
  </div>
</template>

<style scoped>
.cpd-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: var(--bg-input);
}

.cpd-loading-ring {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--primary-alpha-8);
}

.cpd-loading-ring .pi {
  font-size: var(--text-2xl);
  color: var(--primary);
}

.cpd-error-icon {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--error-soft);
}

.cpd-error-icon .pi {
  font-size: var(--text-2xl);
  color: var(--error);
}

.cpd-state-text {
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text-secondary);
}

.cpd-state-text.error {
  color: var(--error);
}

.cpd-state-hint {
  font-size: var(--text-xs);
  color: var(--text-muted);
  max-width: 400px;
  text-align: center;
  word-break: break-all;
}

.cpd-retry-btn {
  margin-top: 4px;
  padding: 7px 18px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--duration-fast);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.cpd-retry-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-alpha-8);
}
</style>
