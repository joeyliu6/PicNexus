<script setup lang="ts">
import ToggleSwitch from 'primevue/toggleswitch';

interface Props {
  title: string;
  description: string;
  enabled: boolean;
  expanded: boolean;
  /** 展开后内容区允许溢出（用于包含下拉框的场景） */
  allowOverflow?: boolean;
}

defineProps<Props>();

const emit = defineEmits<{
  'update:enabled': [value: boolean];
  'update:expanded': [value: boolean];
}>();
</script>

<template>
  <div class="collapsible-card" :class="{ expanded, 'allow-overflow': allowOverflow }">
    <button class="collapsible-card-header" @click="emit('update:expanded', !expanded)">
      <div class="header-left">
        <span
          class="status-dot"
          :class="enabled ? 'active' : ''"
          v-tooltip.top="enabled ? '已启用' : '未启用'"
        />
        <div class="header-info">
          <span class="header-title">{{ title }}</span>
          <span class="header-desc">{{ description }}</span>
        </div>
      </div>
      <div class="header-right">
        <ToggleSwitch
          :modelValue="enabled"
          @update:modelValue="(v: boolean) => emit('update:enabled', v)"
          @click.stop
        />
        <i class="expand-icon pi" :class="expanded ? 'pi-chevron-up' : 'pi-chevron-down'" />
      </div>
    </button>

    <div class="collapsible-card-content-wrapper">
      <div class="collapsible-card-content">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
@import '../../styles/settings-shared.css';

.collapsible-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--settings-card-radius, 12px);
  overflow: hidden;
  transition: border-color 0.2s ease;
}

.collapsible-card:hover {
  border-color: var(--primary);
}

.collapsible-card.expanded {
  border-color: var(--primary);
}

.collapsible-card.allow-overflow {
  overflow: visible;
}

.collapsible-card-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-primary);
  text-align: left;
  transition: background 0.15s;
}

.collapsible-card-header:hover {
  background: var(--hover-overlay-subtle);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
  transition: all 0.2s ease;
  box-shadow: 0 0 0 2px var(--bg-card);
}

.status-dot.active {
  background: var(--success);
  box-shadow: 0 0 0 2px var(--bg-card), 0 0 6px var(--success-border);
}

.header-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.header-title {
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.3;
}

.header-desc {
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.3;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.expand-icon {
  font-size: 0.875rem;
  color: var(--text-muted);
  transition: color 0.2s ease;
}

.collapsible-card:hover .expand-icon {
  color: var(--text-secondary);
}

.collapsible-card.expanded .expand-icon {
  color: var(--primary);
}

/* CSS Grid 展开动画 */
.collapsible-card-content-wrapper {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.25s ease;
}

.collapsible-card.expanded .collapsible-card-content-wrapper {
  grid-template-rows: 1fr;
}

.collapsible-card-content {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

@keyframes show-overflow {
  to { overflow: visible; }
}

.collapsible-card.allow-overflow.expanded .collapsible-card-content {
  animation: show-overflow 0s 0.25s forwards;
}

.collapsible-card-content > :deep(:first-child) {
  border-top: 1px solid var(--border-subtle);
}
</style>
