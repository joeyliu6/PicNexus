<script setup lang="ts">
/**
 * 单个迁移目标卡片
 */
import { computed } from 'vue';
import { getServiceIcon } from '../../../../../utils/icons';
import { formatNumber, healthLabels } from '../utils';

const props = defineProps<{
  serviceId: string;
  displayName: string;
  pendingCount: number;
  checked: boolean;
  healthStatus: 'verified' | 'pending' | 'error';
  healthTooltip?: string;
}>();

const emit = defineEmits<{ toggle: [] }>();

const badgeText = computed(() => healthLabels[props.healthStatus] ?? '已配置');
const badgeClass = computed(() => `badge--${props.healthStatus}`);
const isDisabled = computed(() => props.healthStatus === 'error');
const errorTooltip = computed(() => isDisabled.value ? '图床异常，请先检查配置' : undefined);

function handleClick() {
  if (!isDisabled.value) emit('toggle');
}
</script>

<template>
  <div
    class="target-card"
    :class="{
      'target-card--checked': checked,
      'target-card--disabled': isDisabled,
    }"
    tabindex="0"
    role="checkbox"
    :aria-checked="checked"
    :aria-disabled="isDisabled"
    v-tooltip.top="errorTooltip"
    @click="handleClick"
    @keydown.enter.prevent="handleClick"
    @keydown.space.prevent="handleClick"
  >
    <div class="target-card-top">
      <span class="target-icon" v-html="getServiceIcon(serviceId)" />
      <span class="target-name">{{ displayName }}</span>
      <span
        class="target-badge"
        :class="badgeClass"
        v-tooltip.top="healthTooltip"
      >
        {{ badgeText }}
      </span>
    </div>
    <span class="target-count" :class="{ 'target-count--active': checked }">
      <span class="target-count-num">{{ formatNumber(pendingCount) }}</span>
      <span class="target-count-unit">张待迁移</span>
    </span>
  </div>
</template>

<style scoped>
.target-card {
  display: flex; flex-direction: column; gap: var(--space-sm);
  padding: var(--space-md-lg) var(--space-lg);
  background: transparent; border-radius: var(--radius-md);
  cursor: pointer;
  border: 1px solid var(--border-subtle);
  transition:
    background var(--duration-normal) var(--ease-decelerate),
    border-color var(--duration-normal) var(--ease-decelerate),
    transform var(--duration-fast) var(--ease-decelerate);
  user-select: none;
}

.target-card:hover {
  background: var(--hover-overlay-subtle);
  border-color: var(--primary-alpha-40);
}

.target-card--checked,
.target-card--checked:hover {
  background: var(--primary-alpha-8);
  border-color: var(--primary);
  box-shadow: inset 0 0 0 1px var(--primary);
}

.target-card--checked:hover {
  background: var(--primary-alpha-12);
}
.target-card--checked .target-name { color: var(--primary); }
.target-card--disabled { opacity: 0.5; cursor: not-allowed; }
.target-card--disabled:hover { background: transparent; border-color: var(--border-subtle); }

.target-card-top { display: flex; align-items: center; gap: var(--space-sm); }

.target-icon { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--text-secondary); }
.target-icon :deep(svg) { width: 16px; height: 16px; }
.target-card--checked .target-icon { color: var(--primary); }

.target-name { font-size: var(--text-base); font-weight: var(--weight-semibold); color: var(--text-primary); letter-spacing: -0.01em; }

.target-badge {
  font-size: var(--text-2xs); font-weight: var(--weight-medium);
  padding: var(--space-2xs) var(--space-xs-sm);
  border-radius: var(--radius-sm-md);
  margin-left: auto;
  letter-spacing: 0.02em;
}
.badge--verified { color: var(--success); background: var(--success-alpha-10); }
.badge--pending { color: var(--warning); background: var(--warning-alpha-10); }
.badge--error { color: var(--error); background: var(--error-alpha-10); }

.target-count { display: inline-flex; align-items: baseline; gap: var(--space-2xs); }
.target-count-num { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.target-count-unit { font-size: var(--text-xs); color: var(--text-muted); }
.target-count--active .target-count-num { color: var(--primary); font-weight: var(--weight-semibold); }
.target-count--active .target-count-unit { color: var(--primary); opacity: 0.7; }
</style>
