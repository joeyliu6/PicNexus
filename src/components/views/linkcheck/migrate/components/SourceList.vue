<script setup lang="ts">
/**
 * 迁移来源列表 — 左栏
 *
 * 筛选入口（备份数 / 时间范围）通过具名 slot `filter-trigger`
 * 由父组件 MigrateSelectPhase 注入 MigrateFilterPopover，保证 SourceList 只管渲染列表。
 */
import Checkbox from 'primevue/checkbox';
import InlineEmptyState from '../../../../common/InlineEmptyState.vue';
import { getServiceIcon } from '../../../../../utils/icons';
import { formatNumber, isPublicService } from '../utils';

interface SourceItem {
  id: string;
  displayName: string;
  count: number;
}

defineProps<{
  sources: SourceItem[];
  selectedIds: string[];
}>();

const emit = defineEmits<{
  toggle: [serviceId: string];
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

    <!-- 栏目标签 + 来源列表（与右栏「到这里」呼应，暗示从左到右迁移方向） -->
    <div v-else class="column-label">
      <span class="column-label-text">从这里</span>
      <span class="column-label-trigger">
        <slot name="filter-trigger" />
      </span>
    </div>
    <div v-if="sources.length > 0" class="source-list">
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
  </div>
</template>

<style scoped>
.split-left {
  flex: 0 0 42%; min-width: 0;
  display: flex; flex-direction: column; overflow-y: auto;
}

.column-label {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-weight: var(--weight-regular);
  margin-bottom: var(--space-sm);
  letter-spacing: 0.02em;
}

.column-label-text { flex-shrink: 0; }

.column-label-trigger {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
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
</style>
