<script setup lang="ts">
import type { TrayMenuItem } from '../../services/trayMenu';
import { getServiceIcon } from '../../utils/icons';

interface ServiceEntry {
  id: string;
  text: string;
  serviceId: string;
  checked?: boolean;
  enabled?: boolean;
}

const props = defineProps<{
  items: TrayMenuItem[];
  pendingServiceId: string | null;
}>();

const emit = defineEmits<{
  toggle: [serviceId: string];
}>();

function isSeparator(item: TrayMenuItem): item is { item: 'Separator' } {
  return 'item' in item && item.item === 'Separator';
}

function isServiceItem(item: TrayMenuItem): item is ServiceEntry {
  return !isSeparator(item) && typeof (item as ServiceEntry).serviceId === 'string';
}

function serviceIconFor(item: TrayMenuItem): string | undefined {
  return isServiceItem(item) ? getServiceIcon(item.serviceId) : undefined;
}

function handleClick(item: TrayMenuItem): void {
  if (isServiceItem(item)) {
    emit('toggle', item.serviceId);
  }
}
</script>

<template>
  <div class="service-flyout" role="menu" aria-label="图床选择">
    <template v-for="(item, index) in props.items" :key="isSeparator(item) ? `sep-${index}` : (item as ServiceEntry).id">
      <div v-if="isSeparator(item)" class="flyout-separator" />
      <button
        v-else
        type="button"
        class="flyout-row"
        :class="{ checked: isServiceItem(item) && item.checked }"
        :disabled="(item as ServiceEntry).enabled === false || props.pendingServiceId !== null"
        :role="isServiceItem(item) ? 'menuitemcheckbox' : 'menuitem'"
        :aria-checked="isServiceItem(item) && item.checked ? 'true' : 'false'"
        @click="handleClick(item)"
      >
        <span class="flyout-icon" aria-hidden="true">
          <span v-if="serviceIconFor(item)" class="icon-svg" v-html="serviceIconFor(item)" />
          <i v-else class="pi pi-cloud" />
        </span>
        <span class="flyout-label">{{ (item as ServiceEntry).text }}</span>
        <span class="check-slot" aria-hidden="true">
          <i v-if="isServiceItem(item) && item.checked" class="pi pi-check" />
        </span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.service-flyout {
  box-sizing: border-box;
  width: 180px;
  padding: var(--space-xs) 0;
}

.flyout-separator {
  height: 1px;
  margin: var(--space-2xs) var(--space-sm);
  background: var(--border-subtle);
}

.flyout-row {
  display: flex;
  align-items: center;
  width: 100%;
  height: 26px;
  gap: var(--space-xs-sm);
  padding: 0 var(--space-sm);
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: default;
  transition: background-color var(--duration-fast) var(--ease-standard);
}

.flyout-row:hover,
.flyout-row:focus-visible {
  background: var(--hover-overlay);
  outline: none;
}

.flyout-row:disabled {
  opacity: 0.5;
}

.flyout-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.icon-svg {
  display: inline-flex;
  width: 15px;
  height: 15px;
}

:deep(.icon-svg svg) {
  display: block;
  width: 15px;
  height: 15px;
}

.flyout-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.check-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  flex: 0 0 14px;
  color: var(--primary);
  font-size: var(--text-xs);
}
</style>
