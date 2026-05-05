<script setup lang="ts">
import type { TrayMenuItem } from '../../services/trayMenu';

interface CommandEntry {
  id: string;
  text: string;
  icon?: string;
  enabled?: boolean;
  items?: TrayMenuItem[];
}

const props = defineProps<{
  items: TrayMenuItem[];
  flyoutOpen: boolean;
}>();

const emit = defineEmits<{
  command: [id: string];
  openFlyout: [];
}>();

const COMMAND_ICONS: Record<string, string> = {
  open_window: 'pi-window-maximize',
  upload_clipboard: 'pi-clipboard',
  select_upload_files: 'pi-images',
  current_service: 'pi-cloud',
  open_history: 'pi-history',
  toggle_theme: 'pi-sun',
  quit: 'pi-power-off',
};

function isSeparator(item: TrayMenuItem): item is { item: 'Separator' } {
  return 'item' in item && item.item === 'Separator';
}

function asCommand(item: TrayMenuItem): CommandEntry {
  return item as CommandEntry;
}

function isDanger(item: TrayMenuItem): boolean {
  return !isSeparator(item) && (item as CommandEntry).id === 'quit';
}

function hasSubmenu(item: TrayMenuItem): boolean {
  return !isSeparator(item) && 'items' in item;
}

function isActive(item: TrayMenuItem): boolean {
  return !isSeparator(item) && (item as CommandEntry).id === 'current_service' && props.flyoutOpen;
}

function handleClick(item: TrayMenuItem): void {
  if (isSeparator(item)) return;
  const cmd = asCommand(item);
  if (cmd.id === 'current_service') {
    emit('openFlyout');
  } else {
    emit('command', cmd.id);
  }
}
</script>

<template>
  <div class="menu-list" role="menu" aria-label="PicNexus 快捷操作">
    <template v-for="(item, index) in props.items" :key="isSeparator(item) ? `sep-${index}` : asCommand(item).id">
      <div v-if="isSeparator(item)" class="menu-separator" />
      <button
        v-else
        type="button"
        class="menu-row"
        :class="{
          active: isActive(item),
          'menu-row--danger': isDanger(item),
        }"
        :disabled="asCommand(item).enabled === false"
        role="menuitem"
        @click="handleClick(item)"
      >
        <i
          class="pi menu-icon"
          :class="[asCommand(item).icon ?? COMMAND_ICONS[asCommand(item).id] ?? 'pi-circle', { 'menu-icon--danger': isDanger(item) }]"
          aria-hidden="true"
        />
        <span class="menu-label">{{ asCommand(item).text }}</span>
        <i v-if="hasSubmenu(item)" class="pi pi-chevron-right menu-arrow" aria-hidden="true" />
      </button>
    </template>
  </div>
</template>

<style scoped>
.menu-list {
  display: flex;
  flex-direction: column;
  padding: var(--space-xs) 0;
}

.menu-separator {
  height: 0;
  margin: var(--space-2xs) 0;
  background: transparent;
}

.menu-row {
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

.menu-row:hover,
.menu-row.active,
.menu-row:focus-visible {
  background: var(--hover-overlay);
  outline: none;
}

.menu-row:disabled {
  color: var(--text-muted);
  opacity: 0.5;
}

.menu-row--danger {
  color: var(--error);
}

.menu-row--danger:hover {
  background: var(--hover-overlay);
}

.menu-icon {
  width: 16px;
  flex: 0 0 16px;
  color: var(--text-muted);
  font-size: var(--text-sm);
  text-align: center;
}

.menu-row:hover .menu-icon,
.menu-row.active .menu-icon {
  color: var(--text-primary);
}

.menu-icon--danger {
  color: var(--error) !important;
}

.menu-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.menu-arrow {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.menu-row:hover .menu-arrow,
.menu-row.active .menu-arrow {
  color: var(--text-primary);
}
</style>
