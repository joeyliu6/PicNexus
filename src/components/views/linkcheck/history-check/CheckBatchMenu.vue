<script setup lang="ts">
withDefaults(defineProps<{
  targetLabel: string;
  filterCount: number;
  isActionLocked: boolean;
  showRecheck?: boolean;
  isSkippedMode?: boolean;
}>(), {
  showRecheck: true,
  isSkippedMode: false,
});

const emit = defineEmits<{
  (e: 'recheck'): void;
  (e: 'skip'): void;
  (e: 'copy'): void;
  (e: 'delete'): void;
}>();

const showMenu = defineModel<boolean>('showMenu', { required: true });

function runAction(action: 'recheck' | 'skip' | 'copy' | 'delete'): void {
  showMenu.value = false;
  emit(action);
}
</script>

<template>
  <div class="batch-btn-group">
    <span class="action-divider"></span>

    <button
      v-tooltip.top="`对当前 ${filterCount} 条${targetLabel}批量执行`"
      class="btn-ghost batch-toggle"
      :class="{ 'is-open': showMenu }"
      :disabled="isActionLocked"
      @click="showMenu = !showMenu"
    >
      <i class="pi pi-sliders-h"></i>
      批量
      <i class="pi pi-chevron-down chevron" style="font-size: var(--text-2xs)"></i>
    </button>

    <Transition name="dropdown">
      <div v-if="showMenu" class="batch-dropdown">
        <div class="batch-dropdown-head">
          对 <strong>{{ filterCount.toLocaleString() }}</strong> 条{{ targetLabel }}执行
        </div>
        <div v-if="showRecheck" class="batch-dropdown-item" @click="runAction('recheck')">
          <i class="pi pi-refresh"></i>
          <span>重检这 {{ filterCount }} 条</span>
        </div>
        <div class="batch-dropdown-item" @click="runAction('skip')">
          <i :class="isSkippedMode ? 'pi pi-eye' : 'pi pi-eye-slash'"></i>
          <span>{{ isSkippedMode ? '恢复检测' : '不再检测' }}</span>
        </div>
        <div class="batch-dropdown-item" @click="runAction('copy')">
          <i class="pi pi-copy"></i>
          <span>复制链接</span>
        </div>
        <div class="batch-dropdown-item batch-dropdown-item--danger" @click="runAction('delete')">
          <i class="pi pi-trash"></i>
          <span>删除</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.action-divider {
  width: 1px;
  height: 16px;
  background: var(--border-subtle);
  flex-shrink: 0;
}

.batch-btn-group {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs-sm);
  position: relative;
}

.batch-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  transition: background var(--duration-micro), color var(--duration-micro);
}

.batch-toggle .chevron {
  transition: transform var(--duration-micro);
}

.batch-toggle.is-open {
  background: var(--primary-alpha-8);
  color: var(--primary);
}

.batch-toggle.is-open .chevron {
  transform: rotate(180deg);
}

.batch-dropdown {
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

.batch-dropdown-head {
  padding: var(--space-xs-sm) var(--space-md-lg);
  font-size: var(--text-xs);
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-subtle);
}

.batch-dropdown-head strong {
  color: var(--text-main);
  font-weight: var(--weight-semibold);
}

.batch-dropdown-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs-sm) var(--space-md-lg);
  font-size: var(--text-sm);
  color: var(--text-main);
  cursor: pointer;
  transition: background var(--duration-micro), color var(--duration-micro);
}

.batch-dropdown-item i {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.batch-dropdown-item:hover {
  background: var(--hover-overlay-subtle);
}

.batch-dropdown-item--danger {
  color: var(--error);
}

.batch-dropdown-item--danger i {
  color: var(--error);
}

.batch-dropdown-item--danger:hover {
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
