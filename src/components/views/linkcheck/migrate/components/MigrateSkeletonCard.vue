<script setup lang="ts">
/**
 * 迁移「正在处理」骨架屏
 *
 * 仅在真·初始化（phase='migrating' 且首批尚未进槽位）时显示。
 * 有了 useActiveSlots 跨批次延续机制后，批次边界不会再进入此空态。
 */
</script>

<template>
  <div class="skeleton-card" aria-hidden="true">
    <div class="skeleton-thumb" />
    <div class="skeleton-body">
      <div class="skeleton-line skeleton-line--name" />
      <div class="skeleton-pills">
        <div class="skeleton-pill" />
        <div class="skeleton-pill" />
        <div class="skeleton-pill" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.skeleton-card {
  display: flex; gap: var(--space-md); align-items: center;
  padding: var(--space-md) var(--space-lg);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
}

.skeleton-thumb {
  width: 56px; height: 56px; flex-shrink: 0;
  border-radius: var(--radius-sm-md);
  background: var(--bg-input);
  animation: skeleton-shimmer var(--duration-breathe) ease-in-out infinite;
}

.skeleton-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-sm); }

.skeleton-line {
  height: 12px; border-radius: var(--radius-xs);
  background: var(--bg-input);
  animation: skeleton-shimmer var(--duration-breathe) ease-in-out infinite;
}
.skeleton-line--name { width: 60%; }

.skeleton-pills { display: flex; gap: var(--space-xs-sm); }

.skeleton-pill {
  width: 64px; height: 20px;
  border-radius: var(--radius-full);
  background: var(--bg-input);
  animation: skeleton-shimmer var(--duration-breathe) ease-in-out infinite;
}

@keyframes skeleton-shimmer {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
</style>
