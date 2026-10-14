<script setup lang="ts">
/**
 * 维护页（链接检测 / 文档修复 / 补充备份）顶部的结论卡
 *
 * 一句话说清现在怎么样，旁边放这一刻最该点的按钮。三个页面共用这一张卡，
 * 用户换个页面不用重新学「结论在哪、按钮在哪」。
 *
 * hero：还没有结果可看时（没开始检查 / 没选文件）居中放大，页面上只剩这一件事。
 * 按钮用 `summary-btn` + `summary-btn--primary | --ghost | --icon` 三种，放进 actions 插槽。
 */
import { computed } from 'vue';

export type SummaryTone = 'neutral' | 'ok' | 'warning' | 'error' | 'running' | 'paused';

const props = defineProps<{
  tone: SummaryTone;
  title: string;
  subtitle?: string;
  hero?: boolean;
  /** neutral 语气下用的图标（PrimeIcons class），其余语气有固定图标 */
  icon?: string;
  /** 0–100；给了就在卡片底边画一条细进度条 */
  progress?: number | null;
}>();

const TONE_ICON: Record<Exclude<SummaryTone, 'neutral'>, string> = {
  ok: 'pi pi-check-circle',
  warning: 'pi pi-exclamation-triangle',
  error: 'pi pi-exclamation-circle',
  running: 'pi pi-spin pi-spinner',
  paused: 'pi pi-pause',
};

const iconClass = computed(() =>
  props.tone === 'neutral' ? (props.icon ?? 'pi pi-info-circle') : TONE_ICON[props.tone],
);

const progressWidth = computed(() =>
  props.progress == null ? null : `${Math.max(0, Math.min(100, props.progress))}%`,
);
</script>

<template>
  <section
    class="summary-card"
    :class="[`summary-card--${tone}`, { 'summary-card--hero': hero }]"
    :aria-busy="tone === 'running'"
  >
    <div class="summary-icon" aria-hidden="true">
      <i :class="iconClass" />
    </div>

    <div class="summary-text">
      <h2 class="summary-title">{{ title }}</h2>
      <p v-if="subtitle" class="summary-subtitle">{{ subtitle }}</p>
      <slot name="extra" />
    </div>

    <div v-if="$slots.actions" class="summary-actions">
      <slot name="actions" />
    </div>

    <div
      v-if="progressWidth !== null"
      class="summary-progress"
      role="progressbar"
      :aria-valuenow="progress ?? undefined"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div class="summary-progress-fill" :style="{ width: progressWidth }" />
    </div>
  </section>
</template>

<style scoped>
.summary-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-md-lg);
  padding: var(--space-lg) var(--space-lg-xl);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  overflow: hidden;
  flex-shrink: 0;
}

.summary-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--primary-alpha-10);
  color: var(--primary);
  font-size: var(--text-lg);
}

.summary-card--ok .summary-icon {
  background: var(--state-success-bg);
  color: var(--success);
}

.summary-card--warning .summary-icon {
  background: var(--state-warn-bg);
  color: var(--warning);
}

.summary-card--error .summary-icon {
  background: var(--state-error-bg);
  color: var(--error);
}

.summary-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.summary-title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-tight);
  color: var(--text-main);
}

.summary-subtitle {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--text-muted);
}

.summary-actions {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-shrink: 0;
}

/* ---- 按钮：插槽内容，用 :slotted 才拿得到 ---- */
.summary-actions :slotted(.summary-btn) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs-sm);
  height: 32px;
  padding: 0 var(--space-md-lg);
  border: none;
  border-radius: var(--radius-md);
  font-family: inherit;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast), opacity var(--duration-fast);
}

.summary-actions :slotted(.summary-btn:disabled) {
  opacity: 0.45;
  cursor: not-allowed;
}

.summary-actions :slotted(.summary-btn--primary) {
  background: var(--primary);
  color: var(--text-on-primary);
}

.summary-actions :slotted(.summary-btn--primary:hover:not(:disabled)) {
  opacity: 0.9;
}

.summary-actions :slotted(.summary-btn--ghost) {
  background: var(--bg-input);
  color: var(--text-secondary);
}

.summary-actions :slotted(.summary-btn--ghost:hover:not(:disabled)) {
  background: var(--hover-overlay);
  color: var(--text-main);
}

.summary-actions :slotted(.summary-btn--icon) {
  width: 32px;
  padding: 0;
  background: transparent;
  color: var(--text-muted);
}

.summary-actions :slotted(.summary-btn--icon:hover:not(:disabled)) {
  background: var(--hover-overlay);
  color: var(--text-main);
}

/* ---- 细进度条：贴着卡片底边 ---- */
.summary-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: var(--primary-alpha-10);
}

.summary-progress-fill {
  height: 100%;
  background: var(--primary);
  transition: width var(--duration-slower) var(--ease-standard);
}

/* ---- hero：居中放大，页面上只剩这一件事 ---- */
.summary-card--hero {
  flex-direction: column;
  align-items: center;
  gap: var(--space-md);
  width: 100%;
  max-width: 520px;
  margin: auto;
  padding: var(--space-2xl) var(--space-xl);
  text-align: center;
}

.summary-card--hero .summary-icon {
  width: 56px;
  height: 56px;
  font-size: var(--text-2xl);
}

.summary-card--hero .summary-text {
  align-items: center;
  gap: var(--space-xs);
}

.summary-card--hero .summary-title {
  font-size: var(--text-xl);
}

.summary-card--hero .summary-actions {
  margin-top: var(--space-xs);
}

.summary-card--hero .summary-actions :slotted(.summary-btn--primary) {
  height: 36px;
  padding: 0 var(--space-xl);
  font-size: var(--text-base);
}

@media (prefers-reduced-motion: reduce) {
  .summary-progress-fill {
    transition: none;
  }
}
</style>
