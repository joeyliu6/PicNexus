<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';

const props = defineProps<{
  error: string;
  retrying?: boolean;
}>();

const emit = defineEmits<{
  retry: [];
  goToSettings: [];
}>();

const errorHints = computed<string[]>(() => {
  const msg = props.error.toLowerCase();
  if (msg.includes('timeout') || msg.includes('超时') || msg.includes('timed out')) {
    return ['网络连接超时，请检查网络状况', '目标服务可能暂时不可用', '如使用代理，请确认代理设置正确'];
  }
  if (msg.includes('access') || msg.includes('denied') || msg.includes('unauthorized') || msg.includes('403')) {
    return ['Access Key 或 Secret Key 可能错误', '检查 API 凭证是否已过期', '确认密钥拥有存储桶的读写权限'];
  }
  if (msg.includes('bucket') || msg.includes('nosuchbucket') || msg.includes('不存在')) {
    return ['Bucket / 存储桶名称可能拼写错误', '存储桶可能已被删除', '检查存储桶所在的地域是否正确'];
  }
  return ['Access Key 或 Secret Key 错误', 'Bucket 名称不存在', '网络连接超时'];
});
</script>

<template>
  <div class="error-state">
    <div class="error-card">
      <div class="error-icon-wrapper">
        <i class="pi pi-exclamation-triangle error-icon"></i>
      </div>
      <h3 class="error-title">连接失败</h3>
      <p class="error-message">{{ error }}</p>

      <div class="error-actions">
        <Button
          label="重试"
          icon="pi pi-refresh"
          :loading="retrying"
          @click="emit('retry')"
        />
        <Button
          label="检查设置"
          icon="pi pi-cog"
          severity="secondary"
          @click="emit('goToSettings')"
        />
      </div>

      <div class="error-hints">
        <p class="hints-title">常见原因</p>
        <ul class="hints-list">
          <li v-for="(hint, i) in errorHints" :key="i">{{ hint }}</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.error-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 400px;
  padding: 40px 20px;
}

.error-card {
  text-align: center;
  max-width: 420px;
}

.error-icon-wrapper {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(var(--error-rgb, 239, 68, 68), 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
}

.error-icon {
  font-size: 1.75rem;
  color: var(--error, #ef4444);
}

.error-title {
  margin: 0 0 8px;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
}

.error-message {
  margin: 0 0 24px;
  font-size: 13px;
  color: var(--error, #ef4444);
  background: rgba(var(--error-rgb, 239, 68, 68), 0.06);
  border: 1px solid rgba(var(--error-rgb, 239, 68, 68), 0.15);
  border-radius: 6px;
  padding: 10px 14px;
  line-height: 1.5;
  word-break: break-word;
}

.error-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-bottom: 32px;
}

.error-hints {
  text-align: left;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle-light);
  border-radius: 8px;
  padding: 16px 20px;
}

.hints-title {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.hints-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.8;
}
</style>
