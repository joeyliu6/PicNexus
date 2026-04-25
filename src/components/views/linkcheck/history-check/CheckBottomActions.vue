<script setup lang="ts">
import CheckBatchMenu from './CheckBatchMenu.vue';
import type { MoreMenuItem, MoreMenuKind } from '../../../../composables/link-check/useCheckStrategy';

interface DropdownItem {
  label: string;
  desc: string;
  icon: string;
  action: () => void;
}

defineProps<{
  isChecking: boolean;
  isPaused: boolean;
  hasSelection: boolean;
  isAllSelected: boolean;
  selectedCount: number;
  isActionLocked: boolean;
  smartCheckLabel: string;
  smartCheckTooltip: string;
  showDropdownArrow: boolean;
  dropdownItems: DropdownItem[];
  moreMenuItems: MoreMenuItem[];
}>();

const emit = defineEmits<{
  (e: 'toggle-select-all'): void;
  (e: 'clear-selection'): void;
  (e: 'smart-check'): void;
  (e: 'pause-check'): void;
  (e: 'resume-check'): void;
  (e: 'cancel-check'): void;
  (e: 'more-action', kind: MoreMenuKind): void;
}>();

const showCheckMenu = defineModel<boolean>('showCheckMenu', { required: true });
const showOverflowMenu = defineModel<boolean>('showOverflowMenu', { required: true });
</script>

<template>
  <div class="bottom-actions" @click.stop>
    <!-- 选择态：已选 chip + 全选 + 更多 -->
    <template v-if="hasSelection && !isChecking">
      <button
        class="selection-chip"
        :disabled="isActionLocked"
        aria-label="清空选择"
        v-tooltip.top="'点击清空选择'"
        @click="emit('clear-selection')"
      >
        <span>已选 {{ selectedCount.toLocaleString() }} 条</span>
        <i class="pi pi-times"></i>
      </button>
      <button
        class="btn-ghost"
        :disabled="isActionLocked || isAllSelected"
        @click="emit('toggle-select-all')"
      >
        全选
      </button>
      <span class="action-divider"></span>
      <button
        v-if="moreMenuItems.length === 1 && moreMenuItems[0].kind === 'export'"
        class="btn-ghost"
        :disabled="isActionLocked"
        @click="emit('more-action', 'export')"
      >
        <i class="pi pi-download"></i>
        {{ moreMenuItems[0].label }}
      </button>
      <CheckBatchMenu
        v-else
        :items="moreMenuItems"
        :is-action-locked="isActionLocked"
        v-model:show-menu="showOverflowMenu"
        @action="(kind) => emit('more-action', kind)"
      />
    </template>

    <!-- 检测中：暂停/继续 + 取消 -->
    <template v-else-if="isChecking">
      <button
        v-if="isPaused"
        class="btn-primary"
        type="button"
        @click="emit('resume-check')"
      >
        <i class="pi pi-play"></i>
        继续
      </button>
      <button
        v-else
        class="btn-ghost"
        type="button"
        @click="emit('pause-check')"
      >
        <i class="pi pi-pause"></i>
        暂停
      </button>
      <button class="btn-danger" type="button" @click="emit('cancel-check')">
        <i class="pi pi-stop"></i>
        取消
      </button>
    </template>

    <!-- 默认态：更多 + 智能检测下拉 -->
    <template v-else>
      <CheckBatchMenu
        :items="moreMenuItems"
        :is-action-locked="isActionLocked"
        v-model:show-menu="showOverflowMenu"
        @action="(kind) => emit('more-action', kind)"
      />

      <span class="action-divider"></span>
      <div class="check-btn-group" :class="{ 'has-dropdown': showDropdownArrow }">
        <button
          v-tooltip.top="smartCheckTooltip"
          class="btn-primary"
          :disabled="isActionLocked"
          @click="emit('smart-check')"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" width="10" height="10" style="flex-shrink: 0; display: block;">
            <path d="M3 2l10 6-10 6V2z" />
          </svg>
          {{ smartCheckLabel }}
        </button>

        <button
          v-if="showDropdownArrow"
          class="btn-primary check-toggle"
          :disabled="isActionLocked"
          @click="showCheckMenu = !showCheckMenu"
        >
          <i class="pi pi-chevron-down" style="font-size: var(--text-2xs)"></i>
        </button>

        <Transition name="dropdown">
          <div v-if="showCheckMenu && showDropdownArrow" class="check-dropdown">
            <div
              v-for="(item, index) in dropdownItems"
              :key="index"
              class="check-dropdown-item"
              @click="item.action()"
            >
              <i class="pi" :class="item.icon"></i>
              <div class="dropdown-text">
                <span class="dropdown-label">{{ item.label }}</span>
                <span class="dropdown-desc">{{ item.desc }}</span>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </template>
  </div>
</template>

<style scoped>
.bottom-actions {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-shrink: 0;
}

.action-divider { width: 1px; height: 16px; background: var(--border-subtle); flex-shrink: 0; }

.selection-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  background: var(--bg-input);
  border: none;
  border-radius: var(--radius-sm-md);
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: background var(--duration-micro), color var(--duration-micro);
}

.selection-chip:hover:not(:disabled) { background: var(--hover-overlay-subtle); color: var(--text-main); }
.selection-chip .pi { font-size: var(--text-2xs); color: var(--text-tertiary); transition: color var(--duration-micro); }
.selection-chip:hover:not(:disabled) .pi { color: var(--error); }
.selection-chip:disabled { opacity: 0.5; cursor: default; }

.check-btn-group { display: flex; position: relative; }

.bottom-actions .check-btn-group.has-dropdown .btn-primary:first-child {
  border-radius: var(--radius-sm-md) 0 0 var(--radius-sm-md);
}

.bottom-actions .check-toggle {
  border-radius: 0 var(--radius-sm-md) var(--radius-sm-md) 0;
  padding: 0 var(--space-xs-sm);
  border-left: 1px solid var(--primary-alpha-15);
}

.check-dropdown {
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

.check-dropdown-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs-sm) var(--space-md-lg);
  cursor: pointer;
  transition: background var(--duration-micro);
}

.check-dropdown-item > .pi {
  font-size: var(--text-xs);
  color: var(--text-muted);
  flex-shrink: 0;
}

.check-dropdown-item:hover { background: var(--hover-overlay-subtle); }

.dropdown-text { display: flex; flex-direction: column; gap: var(--space-2xs); }
.dropdown-label { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-main); }
.dropdown-desc { font-size: var(--text-xs); color: var(--text-tertiary); }

.dropdown-enter-active, .dropdown-leave-active { transition: all var(--duration-normal) ease; }
.dropdown-enter-from, .dropdown-leave-to { opacity: 0; transform: translateY(var(--space-sm)); }
</style>
