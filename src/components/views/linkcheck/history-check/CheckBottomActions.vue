<script setup lang="ts">
import CheckBatchMenu from './CheckBatchMenu.vue';
import type { MoreMenuItem, MoreMenuKind } from '../../../../composables/link-check/useCheckStrategy';

defineProps<{
  isChecking: boolean;
  isPaused: boolean;
  hasSelection: boolean;
  isAllSelected: boolean;
  selectedCount: number;
  isActionLocked: boolean;
  smartCheckLabel: string;
  smartCheckTooltip: string;
  moreMenuItems: MoreMenuItem[];
  moreMenuScopeLabel: string;
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

const showOverflowMenu = defineModel<boolean>('showOverflowMenu', { required: true });
</script>

<template>
  <div class="bottom-actions" @click.stop>
    <!-- 检测中：暂停/继续 + 取消 -->
    <template v-if="isChecking">
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

    <!-- 空闲态：选中辅助（清空 + 全选）→ 更多 → 智能检测主按钮 -->
    <template v-else>
      <template v-if="hasSelection">
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
          :disabled="isActionLocked"
          @click="emit('toggle-select-all')"
        >
          {{ isAllSelected ? '取消全选' : '全选' }}
        </button>
        <span class="action-divider"></span>
      </template>

      <CheckBatchMenu
        :items="moreMenuItems"
        :scope-label="moreMenuScopeLabel"
        :is-action-locked="isActionLocked"
        v-model:show-menu="showOverflowMenu"
        @action="(kind) => emit('more-action', kind)"
      />

      <span class="action-divider"></span>
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
</style>
