<script setup lang="ts">
import type { MoreMenuItem, MoreMenuKind } from '../../../../composables/link-check/useCheckStrategy';

withDefaults(defineProps<{
  items: MoreMenuItem[];
  isActionLocked: boolean;
  buttonLabel?: string;
  tooltipLabel?: string;
}>(), {
  buttonLabel: '更多',
  tooltipLabel: '更多操作',
});

const emit = defineEmits<{
  (e: 'action', kind: MoreMenuKind): void;
}>();

const showMenu = defineModel<boolean>('showMenu', { required: true });

function runAction(kind: MoreMenuKind): void {
  showMenu.value = false;
  emit('action', kind);
}

function needsDivider(index: number, items: MoreMenuItem[]): boolean {
  if (index === 0) return false;
  const prev = items[index - 1];
  const curr = items[index];
  if (prev.kind === 'export' && curr.kind !== 'export') return true;
  if (curr.danger && !prev.danger) return true;
  return false;
}
</script>

<template>
  <div class="overflow-btn-group">
    <button
      v-tooltip.top="tooltipLabel"
      class="btn-ghost overflow-toggle"
      :class="{ 'is-open': showMenu }"
      :disabled="isActionLocked"
      @click="showMenu = !showMenu"
    >
      <i class="pi pi-ellipsis-h"></i>
      {{ buttonLabel }}
      <i class="pi pi-chevron-down chevron" style="font-size: var(--text-2xs)"></i>
    </button>

    <Transition name="dropdown">
      <div v-if="showMenu" class="overflow-dropdown">
        <template v-for="(item, index) in items" :key="item.kind">
          <div v-if="needsDivider(index, items)" class="overflow-dropdown-divider"></div>
          <div
            class="overflow-dropdown-item"
            :class="{ 'overflow-dropdown-item--danger': item.danger }"
            @click="runAction(item.kind)"
          >
            <i class="pi" :class="item.icon"></i>
            <span>{{ item.label }}</span>
          </div>
        </template>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.overflow-btn-group {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs-sm);
  position: relative;
}

.overflow-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  transition: background var(--duration-micro), color var(--duration-micro);
}

.overflow-toggle .chevron {
  transition: transform var(--duration-micro);
}

.overflow-toggle.is-open {
  background: var(--primary-alpha-8);
  color: var(--primary);
}

.overflow-toggle.is-open .chevron {
  transform: rotate(180deg);
}

.overflow-dropdown {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  min-width: 220px;
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: var(--space-xs) 0;
  box-shadow: var(--shadow-float);
  z-index: var(--z-dropdown);
  border: 1px solid var(--border-subtle);
  overflow: hidden;
}

.overflow-dropdown-divider {
  height: 1px;
  background: var(--border-subtle);
  margin: var(--space-xs) 0;
}

.overflow-dropdown-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs-sm) var(--space-md-lg);
  font-size: var(--text-sm);
  color: var(--text-main);
  cursor: pointer;
  transition: background var(--duration-micro), color var(--duration-micro);
}

.overflow-dropdown-item i {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.overflow-dropdown-item:hover {
  background: var(--hover-overlay-subtle);
}

.overflow-dropdown-item--danger {
  color: var(--error);
}

.overflow-dropdown-item--danger i {
  color: var(--error);
}

.overflow-dropdown-item--danger:hover {
  background: var(--error-alpha-8);
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition: all var(--duration-normal) ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(var(--space-sm));
}
</style>
