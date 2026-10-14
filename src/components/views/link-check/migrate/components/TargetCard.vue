<script setup lang="ts">
/**
 * 单个迁移目标卡片
 */
import { computed } from 'vue';
import { formatNumber, healthLabels } from '@/components/views/link-check/migrate/utils';
import { mayTruncateServiceName } from '@/utils/serviceNameFit';
import ServiceLogo from '@/components/common/ServiceLogo.vue';

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
const backedUpLine = computed(() =>
  props.backedUpCount > 0 ? `${formatNumber(props.backedUpCount)} 张已经存在这里，不用再补` : undefined,
);
const cardTooltip = computed(() => {
  const lines = [
    // 名字只在放不下时放第一行：.target-name 截断后，整卡被 .target-card-tooltip-hitbox
    // 盖住，这里是看完整 profile 名的唯一入口；放得下时卡片本身已经显示了，不重复。
    mayTruncateServiceName(props.displayName) ? props.displayName : undefined,
    errorTooltip.value,
    props.noSourceSelected ? '没选来源图床' : undefined,
    backedUpLine.value,
  ].filter((line): line is string => Boolean(line));
  return lines.length > 0 ? lines.join('\n') : undefined;
});
const cardAriaLabel = computed(() => {
  const parts = [
    props.displayName,
    props.noSourceSelected ? '没选来源图床' : `${formatNumber(props.pendingCount)} 张待备份`,
    backedUpLine.value,
  ].filter((part): part is string => Boolean(part));
  if (errorTooltip.value) parts.splice(1, 0, errorTooltip.value);
  return parts.join('，');
});
const countClass = computed((): string | undefined => {
  if (props.noSourceSelected) return 'target-count-stack--no-source';
  if (props.isRefiltering) return 'target-count-stack--stale';
  if (props.checked) return 'target-count-stack--active';
  if (props.pendingCount === 0) return 'target-count-stack--done';
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
    :aria-label="cardAriaLabel"
    @click="handleClick"
    @keydown.enter.prevent="handleClick"
    @keydown.space.prevent="handleClick"
  >
    <span class="target-card-tooltip-hitbox" v-tooltip.top="cardTooltip" aria-hidden="true" />
    <div class="target-card-top">
      <ServiceLogo :service-id="serviceId" class="target-icon" />
      <span class="target-name">{{ displayName }}</span>
      <span
        class="target-status-dot"
        :class="`dot--${healthStatus}`"
        v-tooltip.top="healthTooltip ?? badgeText"
      />
      <span class="target-check" aria-hidden="true"><i class="pi pi-check" /></span>
    </div>
    <div class="target-count-stack" :class="countClass">
      <template v-if="noSourceSelected">
        <span class="target-count">
          <span class="target-count-num">—</span>
          <span class="target-count-unit">没选来源图床</span>
        </span>
      </template>
      <template v-else-if="isDisabled">
        <span class="target-count target-count--error">连接异常，先去设置里检查</span>
      </template>
      <template v-else-if="pendingCount === 0 && !isRefiltering">
        <span class="target-count target-count--summary">
          <i class="pi pi-check-circle target-done-icon" aria-hidden="true" />
          <span class="target-count-unit">都已经存过了</span>
        </span>
      </template>
      <template v-else>
        <span class="target-count target-count--summary">
          <span class="target-count-num">{{ formatNumber(pendingCount) }}</span>
          <span class="target-count-unit">张待备份</span>
        </span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.target-card {
  position: relative;
  display: flex; flex-direction: column; gap: var(--space-sm);
  padding: var(--space-md-lg) var(--space-lg);
  background: transparent; border-radius: var(--radius-md);
  cursor: pointer;
  border: 1px solid var(--border-subtle);
  min-width: 0;
  transition:
    background var(--duration-normal) var(--ease-decelerate),
    border-color var(--duration-normal) var(--ease-decelerate),
    transform var(--duration-fast) var(--ease-decelerate);
  user-select: none;
}

.target-card-tooltip-hitbox {
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: inherit;
  cursor: inherit;
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

.target-card-top { display: flex; align-items: center; gap: var(--space-sm); min-width: 0; }

.target-icon { width: 16px; height: 16px; font-size: var(--text-lg); color: var(--text-secondary); }
.target-card--checked .target-icon { color: var(--primary); }

.target-name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
}

.target-status-dot {
  position: relative;
  z-index: 2;
  width: 8px; height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-muted);
  box-shadow: 0 0 0 1px var(--border-subtle);
  cursor: default;
}
.dot--verified { background: var(--success); }
.dot--pending  { background: var(--warning); }
.dot--error    { background: var(--error);   }

/* 勾选标记：未选是空心圆，选中填满——一眼看出这是可选的卡片 */
.target-check {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; margin-left: auto; flex-shrink: 0;
  border-radius: 50%;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1.5px 与拖放区虚线同一折中值，token 仅有 1/2/3px */
  border: 1.5px solid var(--border-subtle);
  color: transparent;
  transition: background var(--duration-fast), border-color var(--duration-fast), color var(--duration-fast);
}
.target-check .pi { font-size: var(--text-2xs); font-weight: var(--weight-bold); }
.target-card:not(.target-card--disabled):hover .target-check { border-color: var(--primary-alpha-50); }
.target-card--checked .target-check { background: var(--primary); border-color: var(--primary); color: var(--text-on-primary); }

.target-count--error { font-size: var(--text-xs); color: var(--error); }
.target-done-icon { font-size: var(--text-xs); color: var(--success); }
.target-count-stack--done .target-count-unit { color: var(--success); }

.target-count-stack { display: flex; align-items: baseline; min-width: 0; max-width: 100%; }

.target-count {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-2xs);
  min-width: 0;
  max-width: 100%;
}

.target-count--summary { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.target-count-num { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.target-count-unit { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: var(--text-xs); color: var(--text-muted); }

.target-count--summary .target-count-num,
.target-count--summary .target-count-unit { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); }

.target-count-stack--active .target-count--summary .target-count-num,
.target-count-stack--active .target-count--summary .target-count-unit { color: var(--primary); font-weight: var(--weight-semibold); }
.target-count-stack--no-source .target-count-num { color: var(--text-tertiary); font-variant-numeric: normal; }
.target-count-stack--no-source .target-count-unit { color: var(--text-tertiary); }
.target-count-stack--stale { opacity: 0.35; transition: opacity var(--duration-normal) var(--ease-decelerate); }
</style>
