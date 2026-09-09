<script setup lang="ts">
import { computed } from 'vue';

/**
 * 运行状态 pill —— 批量迁移与链接检测共用
 *
 * - running：呼吸绿点（检测/迁移进行中）
 * - pausing：暖色 tone + spinner（已点暂停但在途条目未落定，链接检测当前不用）
 * - paused：中性灰（已暂停，可恢复）
 * - cancelling：红色 tone + spinner（已点取消但未落定）
 */

export type StatePillTone = 'running' | 'pausing' | 'paused' | 'cancelling';

export type StatePillTooltipTone = 'neutral' | 'success' | 'danger' | 'warning' | 'muted';

export interface StatePillTooltipItem {
  label: string;
  value: string;
  tone?: StatePillTooltipTone;
}

export interface StatePillTooltip {
  title: string;
  items?: StatePillTooltipItem[];
  notes?: string[];
}

export interface StatePill {
  tone: StatePillTone;
  /** PrimeIcons class（running 态会被替换为自带圆点，无需传） */
  icon?: string;
  label: string;
  /** 仅保留为上游进度语义，不再渲染底栏圆环 */
  progressPercent?: number;
  /** 兼容旧调用：首行作为标题，后续行作为提示文本 */
  progressLabel?: string;
  tooltip?: StatePillTooltip;
}

const props = defineProps<{ pill: StatePill | null }>();

const tooltip = computed<StatePillTooltip | null>(() => {
  if (!props.pill) return null;
  if (props.pill.tooltip) return props.pill.tooltip;
  if (!props.pill.progressLabel) return null;

  const lines = props.pill.progressLabel.split('\n').filter(Boolean);
  if (lines.length === 0) return null;
  return {
    title: lines[0],
    notes: lines.slice(1),
  };
});
</script>

<template>
  <span
    v-if="pill"
    class="bm-state-pill"
    :class="`bm-state-pill--${pill.tone}`"
    :tabindex="tooltip ? 0 : undefined"
  >
    <span v-if="pill.tone === 'running'" class="bm-state-pill__dot" />
    <i v-else-if="pill.icon" :class="pill.icon" aria-hidden="true" />
    <span class="bm-state-pill__label">{{ pill.label }}</span>
    <span v-if="tooltip" class="bm-state-pill__tooltip" role="tooltip">
      <span class="bm-state-pill__tooltip-title">{{ tooltip.title }}</span>
      <span v-if="tooltip.items?.length" class="bm-state-pill__tooltip-grid">
        <template v-for="item in tooltip.items" :key="`${item.label}-${item.value}`">
          <span class="bm-state-pill__tooltip-key">{{ item.label }}</span>
          <span class="bm-state-pill__tooltip-value" :class="item.tone ? `is-${item.tone}` : undefined">
            {{ item.value }}
          </span>
        </template>
      </span>
      <span v-if="tooltip.notes?.length" class="bm-state-pill__tooltip-notes">
        <span v-for="note in tooltip.notes" :key="note" class="bm-state-pill__tooltip-note">
          {{ note }}
        </span>
      </span>
    </span>
  </span>
</template>

<style scoped>
.bm-state-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 4px/10px pill 内边距无对应 spacing token */
  padding: 4px 10px 4px 8px;
  border-radius: var(--radius-full);
  font-size: var(--text-2xs);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  flex-shrink: 0;
  cursor: help;
  outline: none;
}

.bm-state-pill i { font-size: var(--text-2xs); }

.bm-state-pill:focus-visible {
  box-shadow: 0 0 0 2px var(--primary-alpha-15);
}

.bm-state-pill__tooltip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + var(--space-sm));
  z-index: var(--z-tooltip);
  width: max-content;
  min-width: 230px;
  max-width: 320px;
  padding: var(--space-sm-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  color: var(--text-secondary);
  box-shadow: var(--shadow-float);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  line-height: var(--leading-normal);
  text-align: left;
  white-space: normal;
  pointer-events: none;
  opacity: 0;
  transform: translateX(-50%) translateY(var(--space-2xs));
  transition:
    opacity var(--duration-micro) ease,
    transform var(--duration-micro) ease;
}

.bm-state-pill__tooltip::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 100%;
  width: var(--space-sm);
  height: var(--space-sm);
  border-right: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-card);
  transform: translate(-50%, calc(-1 * var(--space-xs))) rotate(45deg);
}

.bm-state-pill:hover .bm-state-pill__tooltip,
.bm-state-pill:focus-within .bm-state-pill__tooltip {
  opacity: 1;
  transform: translateX(-50%);
}

.bm-state-pill__tooltip-title {
  display: block;
  margin-bottom: var(--space-sm);
  color: var(--text-main);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-tight);
}

.bm-state-pill__tooltip-grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-xs) var(--space-md);
}

.bm-state-pill__tooltip-key {
  color: var(--text-tertiary);
  white-space: nowrap;
}

.bm-state-pill__tooltip-value {
  justify-self: end;
  color: var(--text-main);
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
}

.bm-state-pill__tooltip-value.is-success { color: var(--success); }
.bm-state-pill__tooltip-value.is-danger { color: var(--error); }
.bm-state-pill__tooltip-value.is-warning { color: var(--warning); }
.bm-state-pill__tooltip-value.is-muted { color: var(--text-muted); }

.bm-state-pill__tooltip-notes {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  margin-top: var(--space-sm);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-subtle);
}

.bm-state-pill__tooltip-note {
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}

.bm-state-pill--running {
  background: var(--state-success-bg);
  color: var(--state-success-text);
}

.bm-state-pill__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--state-success-text);
  animation: bm-pulse var(--duration-breathe) ease-in-out infinite;
}

@keyframes bm-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.bm-state-pill--pausing {
  background: var(--state-warn-bg);
  color: var(--state-warn-text);
}

.bm-state-pill--paused {
  background: var(--bg-secondary);
  color: var(--text-muted);
}

.bm-state-pill--cancelling {
  background: var(--state-error-bg);
  color: var(--state-error-text);
}
</style>
