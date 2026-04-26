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
export interface StatePill {
  tone: StatePillTone;
  /** PrimeIcons class（running 态会被替换为自带圆点，无需传） */
  icon?: string;
  label: string;
  progressPercent?: number;
  progressLabel?: string;
}

const props = defineProps<{ pill: StatePill | null }>();

const progressPercent = computed(() => {
  const value = props.pill?.progressPercent;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
});

const progressStyle = computed(() => {
  if (progressPercent.value === null) return undefined;
  return { '--pill-progress': `${progressPercent.value}%` };
});
</script>

<template>
  <span
    v-if="pill"
    class="bm-state-pill"
    :class="`bm-state-pill--${pill.tone}`"
  >
    <span
      v-if="progressPercent !== null"
      class="bm-state-pill__progress"
      :style="progressStyle"
      role="progressbar"
      :aria-valuenow="progressPercent"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="pill.progressLabel || `${progressPercent}%`"
    >
      <span class="bm-state-pill__progress-core" />
    </span>
    <span v-else-if="pill.tone === 'running'" class="bm-state-pill__dot" />
    <i v-else-if="pill.icon" :class="pill.icon" aria-hidden="true" />
    {{ pill.label }}
    <span v-if="pill.progressLabel" class="bm-state-pill__tooltip" role="tooltip">
      {{ pill.progressLabel }}
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
}

.bm-state-pill i { font-size: var(--text-2xs); }

.bm-state-pill__tooltip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + var(--space-sm));
  z-index: var(--z-tooltip);
  width: max-content;
  max-width: 260px;
  padding: var(--space-sm) var(--space-sm-md);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  color: var(--text-secondary);
  box-shadow: var(--shadow-float);
  font-size: var(--text-2xs);
  font-weight: var(--weight-regular);
  line-height: var(--leading-normal);
  text-align: left;
  white-space: pre-line;
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

.bm-state-pill__progress {
  width: 18px;
  height: 18px;
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background:
    conic-gradient(currentcolor var(--pill-progress, 0%), transparent 0),
    color-mix(in srgb, currentcolor 18%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, currentcolor 10%, transparent);
}

.bm-state-pill__progress-core {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  background: var(--bg-secondary);
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

.bm-state-pill--paused .bm-state-pill__progress-core {
  background: var(--bg-primary);
}

.bm-state-pill--cancelling {
  background: var(--state-error-bg);
  color: var(--state-error-text);
}
</style>
