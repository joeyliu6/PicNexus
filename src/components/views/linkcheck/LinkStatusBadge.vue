<script setup lang="ts">
import type { CheckLinkResult } from '../../../types/linkCheck';

const props = defineProps<{
  result?: CheckLinkResult;
}>();

function getStatusInfo(result?: CheckLinkResult) {
  if (!result) return { color: 'var(--text-muted)', label: '未检测', icon: 'pi-minus' };

  if (result.error_type === 'suspicious') {
    return { color: 'var(--yellow-500, #eab308)', label: '疑似异常', icon: 'pi-exclamation-triangle' };
  }

  if (result.is_valid) {
    return { color: 'var(--green-500, #22c55e)', label: '有效', icon: 'pi-check-circle' };
  }

  switch (result.error_type) {
    case 'http_4xx':
      return { color: 'var(--red-500, #ef4444)', label: `失效 (${result.status_code || '4xx'})`, icon: 'pi-times-circle' };
    case 'http_5xx':
      return { color: 'var(--orange-500, #f97316)', label: '服务器错误', icon: 'pi-server' };
    case 'timeout':
      return { color: 'var(--yellow-500, #eab308)', label: '超时', icon: 'pi-clock' };
    case 'network':
      return { color: 'var(--text-muted)', label: '网络错误', icon: 'pi-wifi' };
    default:
      return { color: 'var(--text-muted)', label: '未知', icon: 'pi-question-circle' };
  }
}
</script>

<template>
  <span class="link-status-badge" :title="result?.suggestion || ''">
    <span class="status-dot" :style="{ background: getStatusInfo(result).color }"></span>
    <span class="status-text" :style="{ color: getStatusInfo(result).color }">
      {{ getStatusInfo(result).label }}
    </span>
    <i
      v-if="result?.browser_might_work"
      class="pi pi-globe browser-hint"
      title="浏览器可能可正常访问（防盗链限制）"
    ></i>
  </span>
</template>

<style scoped>
.link-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-text {
  font-size: 12px;
  font-weight: 500;
}

.browser-hint {
  font-size: 11px;
  color: var(--text-muted);
  cursor: help;
}
</style>
