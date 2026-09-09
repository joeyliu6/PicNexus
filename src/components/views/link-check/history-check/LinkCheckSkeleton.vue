<script setup lang="ts">
withDefaults(defineProps<{
  embedded?: boolean;
}>(), {
  embedded: false,
});
</script>

<template>
  <div
    class="lc-skeleton-panel"
    :class="{ 'lc-skeleton-panel--embedded': embedded }"
    aria-busy="true"
    aria-live="polite"
  >
    <div class="lc-sk-filterbar">
      <div class="lc-sk-chips">
        <div class="lc-sk-chip lc-sk-chip--error" />
        <div class="lc-sk-chip lc-sk-chip--suspicious" />
        <div class="lc-sk-chip lc-sk-chip--unchecked" />
        <div class="lc-sk-chip lc-sk-chip--valid" />
        <div class="lc-sk-chip lc-sk-chip--all" />
      </div>
      <div class="lc-sk-service-filter" />
      <div class="lc-sk-searchbox" />
    </div>

    <div class="lc-sk-link-list">
      <div v-for="i in 12" :key="'r' + i" class="lc-sk-link-row">
        <div class="lc-sk-dot" />
        <div class="lc-sk-line lc-sk-line--name" />
        <div class="lc-sk-service-badge">
          <div class="lc-sk-badge-icon" />
          <div class="lc-sk-badge-label" />
        </div>
        <div class="lc-sk-status-badge" />
        <div class="lc-sk-actions">
          <div class="lc-sk-recheck-slot">
            <div class="lc-sk-action" />
          </div>
          <div class="lc-sk-action" />
        </div>
      </div>
    </div>

    <div class="lc-sk-bottombar">
      <div class="lc-sk-pagination">
        <div class="lc-sk-page-btn" />
        <div class="lc-sk-page-input" />
        <div class="lc-sk-page-text" />
        <div class="lc-sk-page-btn" />
      </div>
      <div class="lc-sk-bottom-info">
        <div class="lc-sk-summary" />
      </div>
      <div class="lc-sk-bottom-actions">
        <div class="lc-sk-more-btn" />
        <span class="lc-sk-action-divider" />
        <div class="lc-sk-primary-btn" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.lc-skeleton-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: var(--space-md-lg);
  padding: var(--space-lg-xl) 0 var(--space-lg-xl) var(--space-xl);
  overflow: hidden;
}

.lc-skeleton-panel--embedded {
  padding: 0;
}

.lc-skeleton-panel :where(
  .lc-sk-chip,
  .lc-sk-service-filter,
  .lc-sk-searchbox,
  .lc-sk-line,
  .lc-sk-dot,
  .lc-sk-badge-icon,
  .lc-sk-badge-label,
  .lc-sk-status-badge,
  .lc-sk-action,
  .lc-sk-page-btn,
  .lc-sk-page-input,
  .lc-sk-page-text,
  .lc-sk-summary,
  .lc-sk-more-btn,
  .lc-sk-primary-btn
) {
  background: linear-gradient(90deg, var(--border-subtle-light) 25%, var(--bg-card) 50%, var(--border-subtle-light) 75%);
  background-size: 200% 100%;
  animation: k-shimmer var(--duration-shimmer) ease-in-out infinite;
  border-radius: var(--radius-sm);
}

.lc-sk-filterbar {
  display: flex;
  align-items: center;
  gap: var(--space-sm-md);
  min-height: 32px;
  padding: 0 var(--space-xl) 0 0;
}

.lc-sk-chips {
  display: flex;
  gap: var(--space-xs-sm);
  flex-wrap: nowrap;
  min-width: 0;
  flex-shrink: 0;
}

.lc-sk-chip {
  height: 26px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 13px pill radius mirrors CheckFilterBar .filter-chip */
  border-radius: 13px;
  flex-shrink: 0;
}

.lc-sk-chip--error { width: 66px; }
.lc-sk-chip--suspicious { width: 70px; }
.lc-sk-chip--unchecked { width: 92px; }
.lc-sk-chip--valid { width: 82px; }
.lc-sk-chip--all { width: 78px; }

.lc-sk-service-filter {
  width: 102px;
  height: 26px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 13px pill radius mirrors CheckFilterBar .filter-chip */
  border-radius: 13px;
  margin-left: auto;
  flex-shrink: 0;
}

.lc-sk-searchbox {
  width: 260px;
  min-width: 180px;
  height: 32px;
  border-radius: var(--radius-xl);
  flex-shrink: 1;
}

.lc-sk-link-list {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.lc-sk-link-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm-md);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 11px left inset aligns with CheckLinkList .link-row */
  padding: 0 var(--space-lg) 0 11px;
  height: 40px;
  border-bottom: 1px solid var(--primary-alpha-5);
}

.lc-sk-link-row:last-child {
  border-bottom: none;
}

.lc-sk-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.lc-sk-line--name {
  flex: 1;
  max-width: 542px;
  height: 11px;
}

.lc-sk-service-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  width: 76px;
  height: 20px;
  padding: 0 var(--space-xs);
  flex-shrink: 0;
  margin-left: auto;
}

.lc-sk-badge-icon {
  width: 14px;
  height: 14px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.lc-sk-badge-label {
  width: 38px;
  height: 9px;
  flex-shrink: 0;
}

.lc-sk-status-badge {
  width: 36px;
  height: 20px;
  border-radius: var(--space-xs);
  flex-shrink: 0;
}

.lc-sk-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
}

.lc-sk-recheck-slot {
  width: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.lc-sk-action {
  width: 24px;
  height: 24px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 5px radius mirrors CheckLinkList row action buttons */
  border-radius: 5px;
  flex-shrink: 0;
  opacity: 0.22;
}

.lc-sk-bottombar {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  min-height: 28px;
  padding: 0 var(--space-xl) 0 0;
}

.lc-sk-pagination {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
}

.lc-sk-bottom-info {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.lc-sk-bottom-actions {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-shrink: 0;
}

.lc-sk-action-divider {
  width: 1px;
  height: 16px;
  background: var(--border-subtle);
  flex-shrink: 0;
}

.lc-sk-page-btn {
  width: 26px;
  height: 26px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 5px radius mirrors CheckBottomBar page buttons */
  border-radius: 5px;
  flex-shrink: 0;
}

.lc-sk-page-input {
  width: 32px;
  height: 22px;
  flex-shrink: 0;
}

.lc-sk-page-text {
  width: 22px;
  height: 10px;
  flex-shrink: 0;
}

.lc-sk-summary {
  width: 64px;
  height: 10px;
  flex-shrink: 0;
}

.lc-sk-more-btn {
  width: 92px;
  height: 28px;
  border-radius: var(--radius-sm-md);
  flex-shrink: 0;
}

.lc-sk-primary-btn {
  width: 132px;
  height: 28px;
  border-radius: var(--radius-sm-md);
  flex-shrink: 0;
}
</style>
