<script setup lang="ts">
/**
 * 迁移来源列表 — 左栏
 */
import Checkbox from 'primevue/checkbox';
import Select from 'primevue/select';
import InlineEmptyState from '../../../../common/InlineEmptyState.vue';
import { getServiceIcon } from '../../../../../utils/icons';
import { formatNumber, isPublicService, filterThresholds } from '../utils';

interface SourceItem {
  id: string;
  displayName: string;
  count: number;
}

defineProps<{
  sources: SourceItem[];
  selectedIds: string[];
  maxSuccessCount: number;
}>();

const emit = defineEmits<{
  toggle: [serviceId: string];
  'update:maxSuccessCount': [value: number];
}>();


</script>

<template>
  <div class="split-left">
    <!-- 空状态 -->
    <InlineEmptyState
      v-if="sources.length === 0"
      icon="pi pi-inbox"
      title="暂无可迁移的图片"
      hint="历史记录中没有符合条件的图片"
    />

    <!-- 来源列表 -->
    <div v-else class="source-list">
      <div
        v-for="src in sources"
        :key="src.id"
        class="source-row"
        :class="{ 'source-row--selected': selectedIds.includes(src.id) }"
        tabindex="0"
        role="checkbox"
        :aria-checked="selectedIds.includes(src.id)"
        @click="emit('toggle', src.id)"
        @keydown.enter.prevent="emit('toggle', src.id)"
        @keydown.space.prevent="emit('toggle', src.id)"
      >
        <Checkbox
          :modelValue="selectedIds.includes(src.id)"
          :binary="true"
          @click.stop
          @update:modelValue="emit('toggle', src.id)"
          class="source-checkbox"
        />
        <span class="source-icon" v-html="getServiceIcon(src.id)" />
        <span class="source-name">{{ src.displayName }}</span>
        <span class="source-count">
          <span class="source-count-num">{{ formatNumber(src.count) }}</span>
          <span class="source-count-unit">张</span>
        </span>
        <span v-if="isPublicService(src.id)" class="tag-neutral">公共</span>
        <span v-else class="tag-neutral tag-neutral--muted">私有</span>
      </div>
    </div>
    <!-- 高级筛选（常驻） -->
    <div v-if="sources.length > 0" class="filter-body">
      <div class="filter-row">
        <span class="filter-label">仅处理备份不足</span>
        <Select
          :modelValue="maxSuccessCount"
          :options="filterThresholds"
          optionLabel="label"
          optionValue="value"
          class="filter-select"
          @update:modelValue="emit('update:maxSuccessCount', $event)"
        />
        <span class="filter-label">份的图片</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.split-left {
  flex: 0 0 42%; min-width: 0;
  display: flex; flex-direction: column; overflow-y: auto;
}

.source-list { display: flex; flex-direction: column; gap: var(--space-2xs); flex: 1; }

.source-row {
  display: flex; align-items: center; gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: transparent; border-radius: var(--radius-sm-md);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background var(--duration-normal) var(--ease-decelerate), color var(--duration-normal) var(--ease-decelerate);
}
.source-row:hover { background: var(--hover-overlay-subtle); }

.source-row--selected,
.source-row--selected:hover { background: var(--primary-alpha-8); }
.source-row--selected .source-name { color: var(--primary); }
.source-row--selected .source-icon { color: var(--primary); }

.source-checkbox { flex-shrink: 0; }
:deep(.source-checkbox .p-checkbox-box) { width: 16px; height: 16px; border-radius: var(--radius-sm); }

.source-icon { width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--text-secondary); }
.source-icon :deep(svg) { width: 14px; height: 14px; }
.source-name { font-weight: var(--weight-medium); color: var(--text-primary); }
.source-count { display: inline-flex; align-items: baseline; gap: var(--space-2xs); margin-left: auto; flex-shrink: 0; }
.source-count-num { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.source-count-unit { font-size: var(--text-xs); color: var(--text-muted); }
.source-row--selected .source-count-num { color: var(--primary); }

.tag-neutral {
  font-size: var(--text-2xs); font-weight: var(--weight-medium);
  padding: var(--space-2xs) var(--space-xs-sm);
  border-radius: var(--radius-sm-md);
  background: var(--hover-overlay-subtle);
  color: var(--text-secondary);
  flex-shrink: 0;
  letter-spacing: 0.02em;
}
.tag-neutral--muted { color: var(--text-muted); }

/* 高级筛选 */

.filter-body {
  display: flex; flex-direction: column; gap: var(--space-sm);
  padding: var(--space-sm-md) 0;
  font-size: var(--text-sm); color: var(--text-secondary);
}
.filter-row { display: flex; align-items: center; gap: var(--space-sm); }
.filter-label { white-space: nowrap; font-size: var(--text-xs); }

:deep(.filter-select.p-select) { height: 28px; min-width: 60px; border-radius: var(--radius-sm-md); border: none; outline: 1px solid var(--outline-ghost); background: var(--bg-card); font-size: var(--text-sm); }
:deep(.filter-select.p-select:focus-within) { outline: 2px solid var(--primary-alpha-40); }
:deep(.filter-select .p-select-label) { padding: var(--space-xs) var(--space-sm); font-size: var(--text-sm); }
</style>
