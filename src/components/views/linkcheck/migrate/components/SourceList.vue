<script setup lang="ts">
/**
 * 迁移来源列表 — 左栏
 */
import { computed } from 'vue';
import Checkbox from 'primevue/checkbox';
import Select from 'primevue/select';
import { getServiceIcon } from '../../../../../utils/icons';
import { formatNumber, isPublicService, filterThresholds } from '../utils';

interface SourceItem {
  id: string;
  displayName: string;
  count: number;
}

const props = defineProps<{
  sources: SourceItem[];
  selectedIds: string[];
  showAdvancedFilter: boolean;
  maxSuccessCount: number;
}>();

const emit = defineEmits<{
  toggle: [serviceId: string];
  clearFilter: [];
  'update:showAdvancedFilter': [value: boolean];
  'update:maxSuccessCount': [value: number];
}>();

const totalImages = computed(() =>
  props.sources.reduce((sum, s) => sum + s.count, 0),
);

</script>

<template>
  <div class="split-left">
    <div class="source-list">
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
        <span class="source-count">{{ formatNumber(src.count) }} 张</span>
        <span v-if="isPublicService(src.id)" class="tag-public">公共</span>
      </div>
    </div>
    <span class="source-summary">
      <template v-if="selectedIds.length > 0 && selectedIds.length === sources.length">
        已选全部来源，<span class="source-summary-action" role="button" tabindex="0" @click="emit('clearFilter')" @keydown.enter.prevent="emit('clearFilter')">点击取消筛选</span>
      </template>
      <template v-else-if="selectedIds.length > 0">
        已选 {{ selectedIds.length }} 个来源，<span class="source-summary-action" role="button" tabindex="0" @click="emit('clearFilter')" @keydown.enter.prevent="emit('clearFilter')">点击取消筛选</span>
      </template>
      <template v-else>
        共 {{ formatNumber(totalImages) }} 张，分布在 {{ sources.length }} 个图床
      </template>
    </span>

    <!-- 高级筛选 -->
    <button
      class="filter-toggle"
      @click="emit('update:showAdvancedFilter', !showAdvancedFilter)"
    >
      <i class="pi pi-sliders-h" />
      <span>高级筛选</span>
      <i
        class="pi pi-chevron-down filter-arrow"
        :class="{ 'filter-arrow--open': showAdvancedFilter }"
      />
    </button>
    <div v-if="showAdvancedFilter" class="filter-body">
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
  width: 320px; flex-shrink: 0; padding-right: var(--space-lg);
  border-right: 1px solid var(--border-subtle);
  display: flex; flex-direction: column; overflow-y: auto;
}

.source-list { display: flex; flex-direction: column; gap: var(--space-xs-sm); flex: 1; }

.source-row {
  display: flex; align-items: center; gap: var(--space-sm);
  padding: var(--space-sm) var(--space-sm-md); background: transparent; border-radius: var(--radius-sm-md); font-size: var(--text-sm);
  cursor: pointer; transition: background var(--duration-fast), border-color var(--duration-fast);
  border: 1px solid transparent;
}
.source-row:hover { background: var(--bg-surface-low); }
.source-row--selected { background: var(--primary-alpha-8); border-color: var(--primary-alpha-15); }
.source-row--selected .source-name { color: var(--primary); font-weight: var(--weight-semibold); }
.source-row--selected .source-icon { color: var(--primary); }

.source-checkbox { flex-shrink: 0; }
:deep(.source-checkbox .p-checkbox-box) { width: 16px; height: 16px; border-radius: var(--radius-sm); }

.source-icon { width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--text-secondary); }
.source-icon :deep(svg) { width: 14px; height: 14px; }
.source-name { font-weight: var(--weight-medium); color: var(--text-primary); }
.source-count { font-size: var(--text-xs); color: var(--text-tertiary); font-variant-numeric: tabular-nums; margin-left: auto; }

.tag-public { font-size: var(--text-2xs); font-weight: var(--weight-medium); padding: var(--space-2xs) var(--space-xs-sm); border-radius: var(--radius-sm); background: var(--warning-alpha-10); color: var(--warning); flex-shrink: 0; }

.source-summary { font-size: var(--text-xs); color: var(--text-tertiary); margin-top: var(--space-md); padding-top: var(--space-sm); border-top: 1px solid var(--border-subtle); }
.source-summary-action { color: var(--primary); cursor: pointer; transition: opacity var(--duration-fast); }
.source-summary-action:hover { opacity: 0.8; }

/* 高级筛选 */
.filter-toggle {
  display: flex; align-items: center; gap: var(--space-xs-sm);
  width: 100%; background: none; cursor: pointer;
  font-size: var(--text-xs); color: var(--text-tertiary);
  padding: var(--space-sm) 0; margin-top: var(--space-xs);
  font-family: inherit; border: none;
  transition: color var(--duration-fast);
}
.filter-toggle:hover { color: var(--text-secondary); }
.filter-toggle i:first-child { font-size: var(--text-xs); width: 14px; text-align: center; }
.filter-arrow { font-size: var(--text-2xs) !important; margin-left: auto; transition: transform var(--duration-fast); }
.filter-arrow--open { transform: rotate(180deg); }

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
