<script setup lang="ts">
import type { MoreMenuItem, MoreMenuKind } from '../../../../composables/link-check/useCheckStrategy';

withDefaults(defineProps<{
  items: MoreMenuItem[];
  isActionLocked: boolean;
  scopeLabel?: string;
  buttonLabel?: string;
  tooltipLabel?: string;
}>(), {
  scopeLabel: '',
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
        <div v-if="scopeLabel" class="overflow-dropdown-scope">
          <i class="pi pi-filter"></i>
          <span>{{ scopeLabel }}</span>
        </div>

        <div
          v-for="item in items"
          :key="item.kind"
          class="overflow-dropdown-item"
          :class="{ 'overflow-dropdown-item--danger': item.danger }"
          @click="runAction(item.kind)"
        >
          <i class="pi" :class="item.icon"></i>
          <span class="overflow-dropdown-item__label">{{ item.label }}</span>
          <span class="overflow-dropdown-item__count">{{ item.count.toLocaleString() }}</span>
        </div>
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
  min-width: 240px;
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: var(--space-xs) 0;
  box-shadow: var(--shadow-float);
  z-index: var(--z-dropdown);
  border: 1px solid var(--border-subtle);
  overflow: hidden;
}

.overflow-dropdown-scope {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-md) var(--space-xs-sm);
  margin-bottom: var(--space-xs);
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-weight: var(--weight-medium);
  user-select: none;
}

.overflow-dropdown-scope i {
  font-size: var(--text-2xs);
}

.overflow-dropdown-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  height: 36px;
  padding: 0 var(--space-md);
  font-size: var(--text-base);
  color: var(--text-main);
  cursor: pointer;
  transition: background var(--duration-micro), color var(--duration-micro);
}

.overflow-dropdown-item i {
  font-size: var(--text-sm);
  color: var(--text-muted);
  width: 16px;
  text-align: center;
}

.overflow-dropdown-item__label {
  flex: 1;
  font-weight: var(--weight-medium);
}

.overflow-dropdown-item__count {
  flex-shrink: 0;
  padding: var(--space-2xs) var(--space-xs-sm);
  background: var(--bg-input);
  color: var(--text-tertiary);
  border-radius: var(--radius-sm-md);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  transition: background var(--duration-micro), color var(--duration-micro);
}

.overflow-dropdown-item:hover {
  background: var(--hover-overlay-subtle);
}

.overflow-dropdown-item--danger:not(:first-child) {
  position: relative;
  margin-top: var(--space-xs);
}

.overflow-dropdown-item--danger:not(:first-child)::before {
  content: '';
  position: absolute;
  top: calc(-1 * var(--space-xs) / 2);
  left: 0;
  right: 0;
  height: 1px;
  background: var(--border-subtle);
}

.overflow-dropdown-item--danger i {
  color: var(--error);
}

.overflow-dropdown-item--danger .overflow-dropdown-item__count {
  background: var(--state-error-bg-soft);
  color: var(--error);
  font-weight: var(--weight-semibold);
}

.overflow-dropdown-item--danger:hover {
  background: var(--error-alpha-8);
}

.overflow-dropdown-item--danger:hover .overflow-dropdown-item__count {
  background: var(--state-error-bg);
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
