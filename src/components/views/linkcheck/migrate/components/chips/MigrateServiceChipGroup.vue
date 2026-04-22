<script setup lang="ts">
/**
 * 批量迁移 · 服务 chip 组
 *
 * 展示前 max 个服务为独立 chip，溢出收成 `+N` chip，hover tooltip 展开剩余服务名。
 * 两行紧凑布局没有竖向空间做点开展开，沿用 tooltip 模式。
 */
import { computed } from 'vue';
import { getServiceDisplayName } from '../../../../../../constants/serviceNames';
import MigrateServiceChip from './MigrateServiceChip.vue';

interface Props {
  services: string[];
  variant?: 'source' | 'target' | 'muted';
  /** 展示上限，超过用 +N 收纳 */
  max?: number;
}

const props = withDefaults(defineProps<Props>(), { variant: 'target', max: 2 });

const visible = computed(() => props.services.slice(0, props.max));
const overflowCount = computed(() => Math.max(0, props.services.length - props.max));
const overflowTooltip = computed(() =>
  props.services
    .slice(props.max)
    .map(id => getServiceDisplayName(id) || id)
    .join('\n'),
);
</script>

<template>
  <span v-if="services.length > 0" class="m-svc-group">
    <MigrateServiceChip
      v-for="id in visible"
      :key="id"
      :service-id="id"
      :variant="variant"
    />
    <span
      v-if="overflowCount > 0"
      class="m-svc-overflow"
      :class="`m-svc-overflow--${variant}`"
      v-tooltip.top="overflowTooltip"
    >+{{ overflowCount }}</span>
  </span>
</template>

<style scoped>
.m-svc-group {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  flex-wrap: wrap;
  min-width: 0;
}

.m-svc-overflow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-2xs) var(--space-xs-sm);
  border-radius: var(--space-xs);
  font-size: var(--text-2xs);
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  cursor: help;
}

.m-svc-overflow--source,
.m-svc-overflow--muted {
  background: var(--bg-input);
  color: var(--text-muted);
}

.m-svc-overflow--target {
  background: var(--primary-alpha-8);
  color: var(--primary);
}
</style>
