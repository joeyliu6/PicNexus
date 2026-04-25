<script setup lang="ts">
/**
 * 运行状态 pill —— 批量迁移与链接监控共用
 *
 * - running：呼吸绿点（检测/迁移进行中）
 * - pausing：暖色 tone + spinner（已点暂停但在途条目未落定，链接监控当前不用）
 * - paused：中性灰（已暂停，可恢复）
 * - cancelling：红色 tone + spinner（已点取消但未落定）
 */

export type StatePillTone = 'running' | 'pausing' | 'paused' | 'cancelling';
export interface StatePill {
  tone: StatePillTone;
  /** PrimeIcons class（running 态会被替换为自带圆点，无需传） */
  icon?: string;
  label: string;
}

defineProps<{ pill: StatePill | null }>();
</script>

<template>
  <span v-if="pill" class="bm-state-pill" :class="`bm-state-pill--${pill.tone}`">
    <span v-if="pill.tone === 'running'" class="bm-state-pill__dot" />
    <i v-else-if="pill.icon" :class="pill.icon" aria-hidden="true" />
    {{ pill.label }}
  </span>
</template>

<style scoped>
.bm-state-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 4px/10px pill 内边距无对应 spacing token */
  padding: 4px 10px;
  border-radius: var(--radius-full);
  font-size: var(--text-2xs);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  flex-shrink: 0;
}

.bm-state-pill i { font-size: var(--text-2xs); }

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
