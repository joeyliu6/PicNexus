<script setup lang="ts">
import type { CompressResult } from '../../../composables/useCompressionTask';

interface Props {
  /** 压缩结果（父侧 v-if 保证非空） */
  result: CompressResult;
  /** 节省百分比 */
  saved: number;
  /** 是否体积增大 */
  isLarger: boolean;
  /** 字节 → 人类可读字符串（由 useCompressionTask 提供） */
  formatSize: (bytes: number) => string;
}

defineProps<Props>();
</script>

<template>
  <div class="cpd-info-bar">
    <div class="cpd-info-left">
      <span class="cpd-size-badge original">{{ formatSize(result.originalSize) }}</span>
      <i class="pi pi-arrow-right cpd-arrow" />
      <span class="cpd-size-badge compressed">{{ formatSize(result.compressedSize) }}</span>
      <span class="cpd-ratio-badge" :class="isLarger ? 'larger' : 'saved'">
        {{ isLarger ? '体积增大' : `节省 ${saved}%` }}
      </span>
    </div>
    <span class="cpd-dims">{{ result.width }} × {{ result.height }} · {{ result.format.toUpperCase() }}</span>
  </div>
</template>

<style scoped>
.cpd-info-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-sm-md) var(--space-xl) 0;
  font-size: var(--text-sm);
  flex-wrap: wrap;
  flex-shrink: 0;
}

.cpd-info-left {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.cpd-size-badge {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  padding: var(--space-2xs) var(--space-sm-md);
  border-radius: var(--radius-sm-md);
}

.cpd-size-badge.original {
  color: var(--text-secondary);
  background: var(--hover-overlay-subtle);
}

.cpd-size-badge.compressed {
  color: var(--primary);
  background: var(--primary-alpha-8);
}

.cpd-arrow {
  font-size: var(--text-2xs);
  color: var(--text-muted);
}

.cpd-ratio-badge {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  padding: var(--space-2xs) var(--space-sm-md);
  border-radius: var(--radius-sm-md);
}

.cpd-ratio-badge.saved {
  color: var(--success);
  background: var(--success-soft);
}

.cpd-ratio-badge.larger {
  color: var(--warning);
  background: var(--warning-soft);
}

.cpd-dims {
  color: var(--text-muted);
  font-size: var(--text-xs);
}
</style>
