<script setup lang="ts">
import PnIcon from '@/components/pn/PnIcon.vue';
import type { CompressionStatus } from '@/composables/image/useCompressionTask';

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
      <svg class="cpd-spinner" width="24" height="24" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="2" /><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="10 37.7" stroke-linecap="round" /></svg>
    </div>
    <span class="cpd-state-text">{{ fileName ? '压缩中...' : '选择图片...' }}</span>
    <span v-if="fileName" class="cpd-state-hint">{{ fileName }}</span>
  </div>

  <!-- 错误状态 -->
  <div v-else-if="status === 'error'" class="cpd-state">
    <div class="cpd-error-icon">
      <PnIcon name="failRound" :size="24" />
    </div>
    <span class="cpd-state-text error">压缩失败</span>
    <span class="cpd-state-hint">{{ errorMsg }}</span>
    <button class="cpd-retry-btn" @click="emit('retry')">
      <PnIcon name="recheck" :size="14" />
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
  gap: var(--space-sm-md);
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
  color: var(--primary);
}

.cpd-spinner { animation: k-spin var(--duration-spinner) linear infinite; }

.cpd-error-icon {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--error-soft);
  color: var(--error);
}

.cpd-state-text {
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
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
  margin-top: var(--space-xs);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 7px 无对应 spacing token */
  padding: 7px var(--space-lg);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--duration-fast);
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs-sm);
}

.cpd-retry-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-alpha-8);
}
</style>
