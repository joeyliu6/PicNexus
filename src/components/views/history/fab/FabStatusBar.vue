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
    <span class="fab-status-badge">{{ selectedCount }}</span>
    <span class="fab-status-text">
      张图片<template v-if="serviceCount > 0"> · {{ serviceCount }} 个图床</template>
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
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-sm) var(--space-sm) var(--space-md);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
  border-top-left-radius: var(--radius-lg);
  border-top-right-radius: var(--radius-lg);
}

.fab-status-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 var(--space-2xs);
  border-radius: var(--radius-full);
  background: var(--primary);
  color: var(--text-on-primary);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.fab-status-text {
  flex: 1;
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  user-select: none;
}

.fab-status-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: var(--hover-overlay);
  color: var(--text-muted);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.fab-status-close:hover {
  background: var(--hover-overlay-md, var(--hover-overlay));
  color: var(--text-primary);
}

.fab-status-close i {
  font-size: var(--text-2xs);
}
</style>
