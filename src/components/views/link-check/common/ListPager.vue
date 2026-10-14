<script setup lang="ts">
/**
 * 维护页列表底部的翻页：只有一页时不出现
 */
defineProps<{
  totalPages: number;
}>();

const page = defineModel<number>('page', { required: true });
</script>

<template>
  <div v-if="totalPages > 1" class="list-pager">
    <button type="button" class="pager-btn" :disabled="page <= 1" aria-label="上一页" @click="page--">
      <i class="pi pi-chevron-left" aria-hidden="true"></i>
    </button>
    <span class="pager-info">{{ page }} / {{ totalPages }}</span>
    <button type="button" class="pager-btn" :disabled="page >= totalPages" aria-label="下一页" @click="page++">
      <i class="pi pi-chevron-right" aria-hidden="true"></i>
    </button>
  </div>
</template>

<style scoped>
.list-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  padding: var(--space-md) 0 var(--space-xs);
}

.pager-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm-md);
  background: var(--bg-input);
  color: var(--text-muted);
  cursor: pointer;
}

.pager-btn:hover:not(:disabled) {
  background: var(--hover-overlay);
  color: var(--text-main);
}

.pager-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pager-info {
  min-width: 56px;
  text-align: center;
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
