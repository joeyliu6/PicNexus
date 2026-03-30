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
    <button class="card-header" @click="emit('update:expanded', !expanded)">
      <div class="header-left">
        <span
          class="status-dot"
          :class="enabled ? 'active' : ''"
          v-tooltip.top="enabled ? '已启用' : '未启用'"
        />
        <div class="header-info">
          <span class="card-title">{{ title }}</span>
          <span class="card-description">{{ description }}</span>
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

    <div class="card-content-wrapper">
      <div class="card-content">
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

.collapsible-card:hover .expand-icon {
  color: var(--text-secondary);
}

.collapsible-card.expanded .expand-icon {
  color: var(--primary);
}

.collapsible-card.expanded .card-content-wrapper {
  grid-template-rows: 1fr;
}

.card-content {
  display: flex;
  flex-direction: column;
}

@keyframes show-overflow {
  to { overflow: visible; }
}

.collapsible-card.allow-overflow.expanded .card-content {
  animation: show-overflow 0s 0.25s forwards;
}

.card-content > :deep(:first-child) {
  border-top: 1px solid var(--border-subtle);
}
</style>
