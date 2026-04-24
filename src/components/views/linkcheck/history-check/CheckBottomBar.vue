<script setup lang="ts">
import Skeleton from 'primevue/skeleton';
import CheckBatchMenu from './CheckBatchMenu.vue';
import type { CheckStatsResult } from '../../../../composables/link-check/useCheckStats';
import type { MoreMenuItem, MoreMenuKind } from '../../../../composables/link-check/useCheckStrategy';

interface DropdownItem {
  label: string;
  desc: string;
  icon: string;
  action: () => void;
}

defineProps<{
  isChecking: boolean;
  isActionLocked: boolean;
  progressSource: 'monitor' | 'rescue' | null;
  progressPercent: number;
  progressTooltip: string;
  hasSelection: boolean;
  selectedCount: number;
  isAllSelected: boolean;
  totalPages: number;
  bottomSummary: string;
  isLoading: boolean;
  stats: CheckStatsResult;
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
  (e: 'cancel-check'): void;
  (e: 'page-input', event: Event): void;
  (e: 'more-action', kind: MoreMenuKind): void;
}>();

const currentPage = defineModel<number>('currentPage', { required: true });
const pageInput = defineModel<string>('pageInput', { required: true });
const showCheckMenu = defineModel<boolean>('showCheckMenu', { required: true });
const showOverflowMenu = defineModel<boolean>('showOverflowMenu', { required: true });
</script>

<template>
  <div class="bottom">
    <div
      v-if="isChecking && progressSource !== 'rescue'"
      class="progress-bar"
      role="progressbar"
      :aria-valuenow="progressPercent"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="progressTooltip"
    >
      <div class="progress-bar-inner">
        <div class="progress-bar-fill" :style="{ width: progressPercent + '%' }"></div>
      </div>
    </div>

    <div class="bottom-main">
      <template v-if="hasSelection && !isChecking">
        <div class="pagination">
          <button class="page-btn" :disabled="currentPage <= 1 || isActionLocked" @click="currentPage--">
            <i class="pi pi-chevron-left"></i>
          </button>

          <span class="page-info">
            <input
              v-model="pageInput"
              class="page-input"
              type="text"
              :disabled="isActionLocked"
              @keydown.enter="emit('page-input', $event)"
              @blur="emit('page-input', $event)"
              @focus="($event.target as HTMLInputElement).select()"
            />
            / {{ totalPages }}
          </span>

          <button class="page-btn" :disabled="currentPage >= totalPages || isActionLocked" @click="currentPage++">
            <i class="pi pi-chevron-right"></i>
          </button>
        </div>

        <div class="bottom-actions" @click.stop>
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
        </div>
      </template>

      <template v-else>
        <template v-if="!isChecking">
          <div class="pagination">
            <button class="page-btn" :disabled="currentPage <= 1 || isActionLocked" @click="currentPage--">
              <i class="pi pi-chevron-left"></i>
            </button>

            <span class="page-info">
              <input
                v-model="pageInput"
                class="page-input"
                type="text"
                :disabled="isActionLocked"
                @keydown.enter="emit('page-input', $event)"
                @blur="emit('page-input', $event)"
                @focus="($event.target as HTMLInputElement).select()"
              />
              / {{ totalPages }}
            </span>

            <button class="page-btn" :disabled="currentPage >= totalPages || isActionLocked" @click="currentPage++">
              <i class="pi pi-chevron-right"></i>
            </button>
          </div>

          <span class="page-summary">
            <template v-if="isLoading && stats.total === 0">
              <Skeleton width="64px" height="14px" border-radius="4px" />
            </template>
            <template v-else>
              {{ bottomSummary }}
            </template>
          </span>
        </template>

        <span v-else class="check-progress-text">{{ progressTooltip }}</span>

        <div class="bottom-actions" @click.stop>
          <template v-if="!isChecking">
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

          <button v-else class="btn-danger" @click="emit('cancel-check')">
            <i class="pi pi-stop"></i>
            取消
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.action-divider {
  width: 1px;
  height: 16px;
  background: var(--border-subtle);
  flex-shrink: 0;
}

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

.selection-chip:hover:not(:disabled) {
  background: var(--hover-overlay-subtle);
  color: var(--text-main);
}

.selection-chip .pi {
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
  transition: color var(--duration-micro);
}

.selection-chip:hover:not(:disabled) .pi {
  color: var(--error);
}

.selection-chip:disabled {
  opacity: 0.5;
  cursor: default;
}

.check-btn-group {
  display: flex;
  position: relative;
}

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

.check-dropdown-item:hover {
  background: var(--hover-overlay-subtle);
}

.dropdown-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.dropdown-label {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-main);
}

.dropdown-desc {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.progress-bar {
  width: 100%;
  flex-shrink: 0;
  cursor: default;
  padding: var(--space-xs) 0;
  position: relative;
}

.progress-bar-inner {
  width: 100%;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 3px progress track height has no radius token */
  height: 3px;
  background: var(--bg-input);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1.5px progress rounding has no token */
  border-radius: 1.5px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary), var(--primary-hover));
  transition: width var(--duration-slower) var(--ease-standard);
  position: relative;
  overflow: hidden;
}

.progress-bar-fill::after {
  content: '';
  position: absolute;
  inset: 0;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- translucent highlight is intentional for sweep effect */
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 40%), transparent);
  animation: k-sweep var(--duration-shimmer) ease-in-out infinite;
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

.bottom {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  flex-shrink: 0;
  padding-right: var(--space-xl);
}

.bottom-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.page-summary {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.check-progress-text {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.pagination {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-right: var(--space-sm-md);
}

.page-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 26px square pager button matches existing bottom-bar controls */
  width: 26px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 26px square pager button matches existing bottom-bar controls */
  height: 26px;
  border: none;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 5px pager rounding has no exact token */
  border-radius: 5px;
  background: var(--bg-input);
  color: var(--text-muted);
  cursor: pointer;
  transition: background var(--duration-micro), color var(--duration-micro);
  font-size: var(--text-xs);
}

.page-btn:hover:not(:disabled) {
  background: var(--primary-alpha-8);
  color: var(--primary);
}

.page-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.page-info {
  font-size: var(--text-xs);
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  margin: 0 var(--space-xs);
}

.page-input {
  width: 32px;
  height: 22px;
  text-align: center;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-main);
  font-size: var(--text-xs);
  outline: none;
}

.page-input::placeholder {
  color: var(--text-main);
  opacity: 0.6;
}

.page-input:focus {
  border-color: var(--primary);
}
</style>
