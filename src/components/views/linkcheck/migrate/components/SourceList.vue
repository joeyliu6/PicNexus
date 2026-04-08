<script setup lang="ts">
/**
 * 迁移来源列表 — 左栏
 */
import { computed } from 'vue';
import Checkbox from 'primevue/checkbox';
import { getServiceIcon } from '../../../../../utils/icons';
import { formatNumber, isPublicService } from '../utils';

interface SourceItem {
  id: string;
  displayName: string;
  count: number;
}

const props = defineProps<{
  sources: SourceItem[];
  selectedIds: string[];
}>();

const emit = defineEmits<{ toggle: [serviceId: string] }>();

const totalImages = computed(() =>
  props.sources.reduce((sum, s) => sum + s.count, 0),
);

const selectedNames = computed(() =>
  props.selectedIds
    .map(id => props.sources.find(s => s.id === id)?.displayName ?? id)
    .join('、'),
);
</script>

<template>
  <div class="split-left">
    <span class="split-label">迁移来源</span>
    <div class="source-list">
      <div
        v-for="src in sources"
        :key="src.id"
        class="source-row"
        :class="{ 'source-row--selected': selectedIds.includes(src.id) }"
        @click="emit('toggle', src.id)"
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
      <template v-if="selectedIds.length > 0 && selectedIds.length < sources.length">
        已选 {{ selectedNames }}，点击取消筛选
      </template>
      <template v-else-if="selectedIds.length === sources.length">
        已选全部来源（{{ sources.length }} 个图床），点击取消筛选
      </template>
      <template v-else>
        共 {{ formatNumber(totalImages) }} 张图片，分布在 {{ sources.length }} 个图床
      </template>
    </span>
  </div>
</template>

<style scoped>
.split-left {
  width: 320px; flex-shrink: 0; padding: var(--space-lg);
  border-right: 1px solid var(--border-subtle);
  display: flex; flex-direction: column; overflow-y: auto;
}

.split-label { font-size: var(--text-sm); font-weight: 600; color: var(--text-muted); margin-bottom: var(--space-md); display: block; }

.source-list { display: flex; flex-direction: column; gap: var(--space-xs-sm); flex: 1; }

.source-row {
  display: flex; align-items: center; gap: var(--space-sm);
  padding: var(--space-sm) var(--space-sm-md); background: transparent; border-radius: var(--radius-sm-md); font-size: var(--text-sm);
  cursor: pointer; transition: background var(--duration-fast), border-color var(--duration-fast);
  border: 1px solid transparent;
}
.source-row:hover { background: var(--bg-surface-low); }
.source-row--selected { background: var(--primary-alpha-8); border-color: var(--primary-alpha-15); }
.source-row--selected .source-name { color: var(--primary); font-weight: 600; }
.source-row--selected .source-icon { color: var(--primary); }

.source-checkbox { flex-shrink: 0; }
:deep(.source-checkbox .p-checkbox-box) { width: 16px; height: 16px; border-radius: var(--radius-sm); }

.source-icon { width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--text-secondary); }
.source-icon :deep(svg) { width: 14px; height: 14px; }
.source-name { font-weight: 500; color: var(--text-primary); }
.source-count { font-size: var(--text-xs); color: var(--text-tertiary); font-variant-numeric: tabular-nums; margin-left: auto; }

.tag-public { font-size: var(--text-2xs); font-weight: 500; padding: var(--space-2xs) var(--space-xs-sm); border-radius: var(--radius-sm); background: var(--warning-alpha-10); color: var(--warning); flex-shrink: 0; }

.source-summary { font-size: var(--text-xs); color: var(--text-tertiary); margin-top: var(--space-md); padding-top: var(--space-sm); border-top: 1px solid var(--border-subtle); }
</style>
