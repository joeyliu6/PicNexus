<script setup lang="ts">
// 文档修复 idle 态的「最近打开」列表
// 最多显示 5 行，点击即触发 pick 事件（父组件负责分发加载 + analyzeFile）

import { computed, ref, onMounted } from 'vue';
import { homeDir } from '@tauri-apps/api/path';
import {
  useMdRescueMru,
  clearAllMruEntries,
  type MruEntry,
} from '../../../../composables/md-rescue/useMdRescueMru';
import { formatRelativeTime } from '../../../../utils/formatters';

defineProps<{ disabled?: boolean }>();

const emit = defineEmits<{
  (e: 'pick', entry: MruEntry): void;
}>();

const MAX_VISIBLE = 5;
const { entries } = useMdRescueMru();

const home = ref<string>('');

onMounted(async () => {
  try {
    const h = await homeDir();
    home.value = h.replace(/\\/g, '/').replace(/\/$/, '');
  } catch {
    home.value = '';
  }
});

const visible = computed(() => entries.value.slice(0, MAX_VISIBLE));

function displayName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length === 0 ? path : parts[parts.length - 1];
}

function prettyPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  if (home.value && normalized.startsWith(home.value)) {
    return '~' + normalized.slice(home.value.length);
  }
  return normalized;
}

function handleClearAll() {
  clearAllMruEntries();
}
</script>

<template>
  <section class="recent-list" aria-label="最近打开">
    <div class="recent-list__header">
      <span class="recent-list__title">最近打开</span>
      <button
        v-if="visible.length > 0"
        v-tooltip.top="'清空记录'"
        type="button"
        class="recent-list__clear"
        aria-label="清空最近打开"
        :disabled="disabled"
        @click="handleClearAll"
      >
        <i class="pi pi-trash" />
      </button>
    </div>
    <ul v-if="visible.length > 0" class="recent-list__items">
      <li v-for="entry in visible" :key="entry.path">
        <button
          type="button"
          class="recent-item"
          :disabled="disabled"
          v-tooltip.top="'点击重新扫描并检测'"
          @click="emit('pick', entry)"
        >
          <i
            class="recent-item__icon"
            :class="entry.kind === 'folder' ? 'pi pi-folder' : 'pi pi-file'"
          />
          <div class="recent-item__meta">
            <span class="recent-item__name">{{ displayName(entry.path) }}</span>
            <span class="recent-item__path">{{ prettyPath(entry.path) }}</span>
          </div>
          <span class="recent-item__time">{{ formatRelativeTime(entry.ts) }}</span>
          <i class="recent-item__chevron pi pi-chevron-right" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.recent-list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.recent-list__header {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 0 var(--space-sm);
}

.recent-list__title {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.02em;
}

.recent-list__clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-2xs);
  background: transparent;
  border: 0;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: color var(--duration-fast) var(--ease-standard);
}

.recent-list__clear i {
  font-size: var(--text-2xs);
}

.recent-list__clear:hover:not(:disabled) { color: var(--error); }
.recent-list__clear:disabled { opacity: 0.3; cursor: not-allowed; }
.recent-list__clear:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }

.recent-list__items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.recent-item {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  width: 100%;
  padding: var(--space-xs-sm) var(--space-sm);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm-md);
  cursor: pointer;
  text-align: left;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);
}

.recent-item:hover:not(:disabled) {
  background: var(--hover-overlay-subtle);
  border-color: var(--border-subtle);
}

.recent-item:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}

.recent-item:disabled { opacity: 0.5; cursor: not-allowed; }

.recent-item__icon {
  font-size: var(--text-lg);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.recent-item__meta {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  flex: 1;
  min-width: 0;
}

.recent-item__name {
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  color: var(--text-main);
  line-height: var(--leading-tight);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-item__path {
  font-size: var(--text-xs);
  color: var(--text-muted);
  line-height: var(--leading-tight);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-item__time {
  font-size: var(--text-xs);
  color: var(--text-muted);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.recent-item__chevron {
  font-size: var(--text-2xs);
  color: var(--text-muted);
  opacity: 0;
  transform: translateX(-4px);
  flex-shrink: 0;
  transition:
    opacity var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.recent-item:hover:not(:disabled) .recent-item__chevron {
  opacity: 1;
  transform: translateX(0);
  color: var(--primary);
}
</style>
