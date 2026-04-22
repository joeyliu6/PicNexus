<script setup lang="ts">
/**
 * 批量迁移 · 单状态 chip
 *
 * 替代原三段 pipeline，每行只渲染一个 chip。
 * 视觉对齐链接监控 `.filter-chip`（26px 高，药丸轮廓）。
 * tone 驱动背景/文字色：active 用 primary，success/warning/error 各自色系。
 */
import { computed } from 'vue';
import { getStatusChipMeta } from '../../composables/useStatusChip';
import type { MigrateItemStatus } from '../../../../../../types/batchMigrate';

interface Props {
  item: Pick<MigrateItemStatus, 'status' | 'errorType' | 'convertedFormat'>;
  /** dense 用于 done 行等更紧凑的场景，22px 高 */
  dense?: boolean;
}

const props = withDefaults(defineProps<Props>(), { dense: false });

const meta = computed(() => getStatusChipMeta(props.item));
</script>

<template>
  <span
    class="m-status-chip"
    :class="[`m-status-chip--${meta.tone}`, { 'm-status-chip--dense': dense }]"
    :data-variant="meta.variant"
    role="status"
  >
    <i class="m-status-chip-ic" :class="meta.icon" aria-hidden="true" />
    <span class="m-status-chip-label">{{ meta.label }}</span>
  </span>
</template>

<style scoped>
.m-status-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 5px chip icon spacing matches link-check .filter-chip */
  gap: 5px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 26px chip height matches link-check .filter-chip */
  height: 26px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 10px chip horizontal padding matches link-check */
  padding: 0 10px;

  /* 稳定宽度：覆盖"处理中…/已完成/已转 WEBP"等状态文案长度，避免切换时挤动右侧按钮 */
  min-width: 6em;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 13px pill radius matches link-check silhouette */
  border-radius: 13px;
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  border: 1px solid transparent;
  white-space: nowrap;
  transition: background var(--duration-fast), color var(--duration-fast), border-color var(--duration-fast);
}

.m-status-chip--dense {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 22px dense variant for done rows */
  height: 22px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 8px dense padding */
  padding: 0 8px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 11px pill radius for dense chip */
  border-radius: 11px;
}

.m-status-chip-ic { font-size: var(--text-2xs); flex-shrink: 0; }
.m-status-chip-label { line-height: 1; }

.m-status-chip--pending {
  background: var(--bg-input);
  color: var(--text-tertiary);
}

.m-status-chip--active {
  background: var(--primary-alpha-12);
  color: var(--primary);
  border-color: var(--primary-alpha-10);
}

.m-status-chip--success {
  background: var(--success-alpha-10);
  color: var(--success);
  border-color: var(--success-alpha-10);
}

.m-status-chip--warning {
  background: var(--warning-alpha-8);
  color: var(--warning);
  border-color: var(--warning-alpha-8);
}

.m-status-chip--error {
  background: var(--error-alpha-10);
  color: var(--error);
  border-color: var(--error-alpha-10);
}
</style>
