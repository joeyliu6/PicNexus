<script setup lang="ts">
defineProps<{
  selectedCount: number;
  serviceCount: number;
}>();

defineEmits<{
  (e: 'close'): void;
}>();
</script>

<template>
  <div class="fab-status-bar">
    <span class="fab-status-text">
      已选 <strong>{{ selectedCount }}</strong> 张
      <template v-if="serviceCount > 0"> · {{ serviceCount }} 个图床</template>
    </span>
    <button
      class="fab-status-close"
      aria-label="取消选择"
      title="取消选择"
      @click.stop="$emit('close')"
    >
      <i class="pi pi-times" />
    </button>
  </div>
</template>

<style scoped>
.fab-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm) var(--space-xs) var(--space-md);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
  border-top-left-radius: var(--radius-lg);
  border-top-right-radius: var(--radius-lg);
}

.fab-status-text {
  font-size: var(--text-xs);
  color: var(--text-muted);
  user-select: none;
}

.fab-status-text strong {
  color: var(--text-primary);
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
}

.fab-status-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.fab-status-close:hover {
  background: var(--hover-overlay);
  color: var(--text-primary);
}

.fab-status-close i {
  font-size: var(--text-xs);
}
</style>
