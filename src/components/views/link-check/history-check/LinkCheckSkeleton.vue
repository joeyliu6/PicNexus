<script setup lang="ts">
/**
 * 链接检测首次加载的骨架：轮廓与真实布局一一对应（结论卡 → 工具条 → 一张图一行），
 * 数据到了直接换上，不跳版。
 */
</script>

<template>
  <div class="lc-skeleton-panel" aria-busy="true" aria-live="polite">
    <div class="lc-sk-card">
      <div class="lc-sk-icon" />
      <div class="lc-sk-text">
        <div class="lc-sk-line lc-sk-line--title" />
        <div class="lc-sk-line lc-sk-line--subtitle" />
      </div>
      <div class="lc-sk-button" />
    </div>

    <div class="lc-sk-toolbar">
      <div class="lc-sk-switch" />
      <div class="lc-sk-search" />
    </div>

    <div class="lc-sk-list">
      <div v-for="i in 8" :key="i" class="lc-sk-row">
        <div class="lc-sk-thumb" />
        <div class="lc-sk-text">
          <div class="lc-sk-line lc-sk-line--name" />
          <div class="lc-sk-line lc-sk-line--status" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lc-skeleton-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  height: 100%;
  padding: var(--space-lg-xl) var(--space-xl) 0;
  overflow: hidden;
}

.lc-skeleton-panel :where(
  .lc-sk-icon,
  .lc-sk-line,
  .lc-sk-button,
  .lc-sk-switch,
  .lc-sk-search,
  .lc-sk-thumb
) {
  background: linear-gradient(90deg, var(--border-subtle-light) 25%, var(--bg-card) 50%, var(--border-subtle-light) 75%);
  background-size: 200% 100%;
  animation: k-shimmer var(--duration-shimmer) ease-in-out infinite;
  border-radius: var(--radius-sm);
}

/* 与 SummaryCard 同尺寸 */
.lc-sk-card {
  display: flex;
  align-items: center;
  gap: var(--space-md-lg);
  padding: var(--space-lg) var(--space-lg-xl);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  flex-shrink: 0;
}

.lc-sk-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex-shrink: 0;
}

.lc-sk-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.lc-sk-line {
  height: 12px;
}

.lc-sk-line--title {
  width: 160px;
  height: 16px;
}

.lc-sk-line--subtitle {
  width: 280px;
}

.lc-sk-button {
  width: 96px;
  height: 32px;
  border-radius: var(--radius-md);
  flex-shrink: 0;
}

/* 与 CheckToolbar 同尺寸 */
.lc-sk-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.lc-sk-switch {
  width: 150px;
  height: 30px;
  border-radius: var(--radius-md);
}

.lc-sk-search {
  width: 240px;
  height: 30px;
  border-radius: var(--radius-full);
}

/* 与 CheckImageRow 同尺寸 */
.lc-sk-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.lc-sk-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  min-height: 56px;
  padding: var(--space-xs) var(--space-sm);
}

.lc-sk-thumb {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm-md);
  flex-shrink: 0;
}

.lc-sk-row .lc-sk-text {
  gap: var(--space-xs-sm);
}

.lc-sk-line--name {
  width: 180px;
}

.lc-sk-line--status {
  width: 260px;
  height: 10px;
}

@media (prefers-reduced-motion: reduce) {
  .lc-skeleton-panel :where(.lc-sk-icon, .lc-sk-line, .lc-sk-button, .lc-sk-switch, .lc-sk-search, .lc-sk-thumb) {
    animation: none;
  }
}
</style>
