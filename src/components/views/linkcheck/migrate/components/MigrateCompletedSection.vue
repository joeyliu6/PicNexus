<script setup lang="ts">
/**
 * 已完成折叠区（进行中 + 终态共用）
 * 默认收起；展开后展示成功/跳过/失败项列表
 */
import { computed, ref } from 'vue';
import type { MigrateItemStatus } from '../../../../../types/batchMigrate';

interface Props {
  items: MigrateItemStatus[];
  /** 失败数（用于徽章切换） */
  failureCount: number;
  /** 默认是否展开 */
  defaultExpanded?: boolean;
}

const props = withDefaults(defineProps<Props>(), { defaultExpanded: false });
const expanded = ref(props.defaultExpanded);

const count = computed(() => props.items.length);

function toggle() { expanded.value = !expanded.value; }

defineExpose({ expand: () => { expanded.value = true; } });
</script>

<template>
  <section v-if="count > 0" class="done-section" :class="{ 'done-section--open': expanded }">
    <button class="ds-head" @click="toggle">
      <i class="pi pi-chevron-down ds-chev" :class="{ 'ds-chev--open': expanded }" />
      <span class="ds-title">已完成 ({{ count }})</span>
      <span class="ds-spacer" />
      <span v-if="failureCount > 0" class="ds-badge ds-badge--fail">
        <i class="pi pi-times-circle" /> {{ failureCount }} 失败
      </span>
      <span v-else-if="count > 0" class="ds-status ds-status--ok">
        <span class="ds-dot" />
        全部成功
      </span>
    </button>

    <div v-show="expanded" class="ds-list">
      <div
        v-for="item in items"
        :key="item.historyId"
        class="ds-row"
        :class="`ds-row--${item.status}`"
      >
        <span class="ds-rdot" />
        <span class="ds-name">{{ item.fileName }}</span>
        <span v-if="item.status === 'failed' && item.error" class="ds-err">{{ item.error }}</span>
        <span v-else-if="item.status === 'skipped'" class="ds-meta">已存在</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.done-section {
  display: flex; flex-direction: column; min-height: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-input);
  flex-shrink: 0;
  overflow: hidden;
}

.done-section--open {
  /* 展开后占据可用空间，用 min/max 控住高度，避免把底栏顶出视口 */
  flex: 1 1 auto;
  background: var(--bg-card);
  max-height: min(60vh, 480px);
}

.ds-head {
  display: flex; align-items: center; gap: var(--space-sm);
  padding: var(--space-lg);
  width: 100%; background: transparent; border: none; cursor: pointer;
  font-family: inherit; color: var(--text-primary);
  font-size: var(--text-lg); font-weight: var(--weight-bold);
  transition: background var(--duration-fast);
}
.ds-head:hover { background: var(--hover-overlay-subtle); }

.ds-chev {
  font-size: var(--text-sm); color: var(--text-tertiary);
  transform: rotate(-90deg);
  transition: transform var(--duration-fast) var(--ease-standard);
}
.ds-chev--open { transform: rotate(0deg); }
.ds-title { color: var(--text-main); }
.ds-spacer { flex: 1; }

.ds-status {
  display: inline-flex; align-items: center; gap: var(--space-sm);
  font-size: var(--text-sm); font-weight: var(--weight-regular);
  color: var(--text-muted);
}

.ds-dot {
  width: 8px; height: 8px;
  border-radius: var(--radius-full);
  background: var(--success);
}

.ds-badge {
  display: inline-flex; align-items: center; gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-xs-sm);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs); font-weight: var(--weight-medium);
}
.ds-badge--fail { background: var(--error-alpha-10); color: var(--error); }

.ds-list {
  flex: 1; min-height: 0; overflow-y: auto;
  border-top: 1px solid var(--border-subtle);
}

.ds-row {
  display: flex; align-items: center; gap: var(--space-sm-md);
  height: 48px;
  padding: 0 var(--space-lg);
  font-size: var(--text-sm);
  border-bottom: 1px solid var(--primary-alpha-5);
  transition: background var(--duration-micro);
}
.ds-row:last-child { border-bottom: none; }
.ds-row:hover { background: var(--hover-overlay-subtle); }

.ds-rdot {
  width: 6px; height: 6px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}
.ds-row--success .ds-rdot { background: var(--success); }
.ds-row--failed .ds-rdot { background: var(--error); }
.ds-row--skipped .ds-rdot { background: var(--text-tertiary); }

.ds-name {
  flex: 1; min-width: 0;
  font-family: var(--font-mono, monospace);
  font-size: var(--text-sm); font-weight: var(--weight-medium);
  color: var(--text-main);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ds-row--skipped .ds-name { color: var(--text-tertiary); font-weight: var(--weight-regular); }
.ds-err { color: var(--error); font-size: var(--text-xs); flex-shrink: 0; }
.ds-meta { color: var(--text-tertiary); font-size: var(--text-xs); flex-shrink: 0; }
</style>
