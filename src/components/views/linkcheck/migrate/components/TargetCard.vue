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
      {{ formatNumber(pendingCount) }} 张待迁移
    </span>
  </div>
</template>

<style scoped>
.target-card {
  display: flex; flex-direction: column; gap: var(--space-sm);
  padding: var(--space-md) var(--space-md-lg); background: transparent; border-radius: var(--radius-md);
  cursor: pointer; border: 1.5px solid transparent;
  transition: background var(--duration-fast), border-color var(--duration-fast), transform var(--duration-fast);
  user-select: none;
}

.target-card:hover {
  background: var(--bg-surface-low);
  border-color: var(--primary-alpha-15);
}

.target-card--checked {
  background: var(--primary-alpha-8);
  border-color: var(--primary);
}

.target-card--checked:hover {
  transform: scale(1.01);
}
.target-card--checked .target-name { color: var(--primary); font-weight: 700; }
.target-card--disabled { opacity: 0.5; cursor: not-allowed; }
.target-card--disabled:hover { background: transparent; border-color: transparent; transform: none; }

.target-card-top { display: flex; align-items: center; gap: var(--space-sm); }

.target-icon { width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--text-secondary); }
.target-icon :deep(svg) { width: 14px; height: 14px; }
.target-card--checked .target-icon { color: var(--primary); }

.target-name { font-size: var(--text-sm); font-weight: 600; color: var(--text-primary); }

.target-badge { font-size: var(--text-2xs); font-weight: 500; padding: var(--space-2xs) var(--space-xs-sm); border-radius: var(--radius-sm); }
.badge--verified { color: var(--success); background: var(--success-alpha-10); }
.badge--pending { color: var(--warning); background: var(--warning-alpha-10); }
.badge--error { color: var(--error); background: var(--error-alpha-10); }

.target-count { font-size: var(--text-xs); color: var(--text-muted); }
.target-count--active { color: var(--primary); font-weight: 500; }
</style>
