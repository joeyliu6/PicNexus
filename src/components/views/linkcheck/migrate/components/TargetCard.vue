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
  backedUpCount: number;
  checked: boolean;
  healthStatus: 'verified' | 'pending' | 'error';
  healthTooltip?: string;
  noSourceSelected?: boolean;
  isRefiltering?: boolean;
}>();

const emit = defineEmits<{ toggle: [] }>();

const badgeText = computed(() => healthLabels[props.healthStatus] ?? '已配置');
const isDisabled = computed(() => props.healthStatus === 'error');
const errorTooltip = computed(() => isDisabled.value ? '图床异常，请先检查配置' : undefined);
const countClass = computed((): string | undefined => {
  if (props.noSourceSelected) return 'target-count-stack--no-source';
  if (props.isRefiltering) return 'target-count-stack--stale';
  if (props.checked) return 'target-count-stack--active';
  return undefined;
});

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
        class="target-status-dot"
        :class="`dot--${healthStatus}`"
        v-tooltip.top="healthTooltip ?? badgeText"
      />
    </div>
    <div class="target-count-stack" :class="countClass">
      <template v-if="noSourceSelected">
        <span class="target-count">
          <span class="target-count-num">—</span>
          <span class="target-count-unit">请先选择来源</span>
        </span>
      </template>
      <template v-else>
        <span class="target-count target-count--summary">
          <span class="target-count-part target-count--pending">
            <span class="target-count-num">{{ formatNumber(pendingCount) }}</span>
            <span class="target-count-unit">张待迁移</span>
          </span>
          <span class="target-count-separator">，</span>
          <span class="target-count-part target-count--backed-up">
            <span class="target-count-num">{{ formatNumber(backedUpCount) }}</span>
            <span class="target-count-unit">张已备份</span>
          </span>
        </span>
      </template>
    </div>
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

.target-card:not(.target-card--checked, .target-card--disabled):hover .target-name { color: var(--primary); }
.target-card:not(.target-card--checked, .target-card--disabled):hover .target-icon { color: var(--primary); }

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

.target-status-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-left: auto;
  background: var(--text-muted);
  box-shadow: 0 0 0 1px var(--border-subtle);
  cursor: help;
}
.dot--verified { background: var(--success); }
.dot--pending  { background: var(--warning); }
.dot--error    { background: var(--error);   }

.target-count-stack { display: flex; align-items: baseline; min-width: 0; }
.target-count { display: inline-flex; align-items: baseline; gap: var(--space-2xs); min-width: 0; }
.target-count--summary { gap: 0; white-space: nowrap; }
.target-count-part { display: inline-flex; align-items: baseline; gap: var(--space-2xs); }
.target-count-separator { font-size: var(--text-xs); color: var(--text-muted); }
.target-count-num { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.target-count-unit { font-size: var(--text-xs); color: var(--text-muted); }

.target-count--summary .target-count-num,
.target-count--summary .target-count-unit,
.target-count--summary .target-count-separator { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); }

.target-count-stack--active .target-count--summary .target-count-num,
.target-count-stack--active .target-count--summary .target-count-unit,
.target-count-stack--active .target-count--summary .target-count-separator { color: var(--primary); font-weight: var(--weight-semibold); }
.target-count-stack--no-source .target-count-num { color: var(--text-tertiary); font-style: italic; font-variant-numeric: normal; }
.target-count-stack--no-source .target-count-unit { color: var(--text-tertiary); font-style: italic; }
.target-count-stack--stale { opacity: 0.35; transition: opacity var(--duration-normal) var(--ease-decelerate); }
</style>
