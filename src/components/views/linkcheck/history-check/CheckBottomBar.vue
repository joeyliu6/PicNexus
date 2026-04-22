<script setup lang="ts">
import Skeleton from 'primevue/skeleton';
import CheckBatchMenu from './CheckBatchMenu.vue';
import type { CheckStatsResult } from '../../../../composables/link-check/useCheckStats';

interface DropdownItem {
  label: string;
  desc: string;
  icon: string;
  action: () => void;
}

defineProps<{
  isChecking: boolean;
  isActionLocked: boolean;
  disableCheckActions: boolean;
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
  batchFilterLabel: string | null;
  batchFilterCount: number;
}>();

const emit = defineEmits<{
  (e: 'toggle-select-all'): void;
  (e: 'export-csv'): void;
  (e: 'export-csv-selected'): void;
  (e: 'smart-check'): void;
  (e: 'cancel-check'): void;
  (e: 'page-input', event: Event): void;
  (e: 'bulk-recheck'): void;
  (e: 'bulk-skip'): void;
  (e: 'bulk-copy'): void;
  (e: 'bulk-delete'): void;
}>();

const currentPage = defineModel<number>('currentPage', { required: true });
const pageInput = defineModel<string>('pageInput', { required: true });
const showCheckMenu = defineModel<boolean>('showCheckMenu', { required: true });
const showBatchMenu = defineModel<boolean>('showBatchMenu', { required: true });

function runBulkAction(action: 'recheck' | 'skip' | 'copy' | 'delete'): void {
  showBatchMenu.value = false;
  if (action === 'recheck') emit('bulk-recheck');
  else if (action === 'skip') emit('bulk-skip');
  else if (action === 'copy') emit('bulk-copy');
  else emit('bulk-delete');
}
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
          <span class="batch-count">已选 {{ selectedCount }} 条</span>
          <button class="btn-ghost" :disabled="isActionLocked" @click="emit('toggle-select-all')">
            {{ isAllSelected ? '取消全选' : '全选' }}
          </button>
          <button class="btn-ghost" :disabled="isActionLocked" @click="emit('export-csv-selected')">
            <i class="pi pi-download"></i>
            导出选中
          </button>
          <CheckBatchMenu
            target-label="已选记录"
            :filter-count="selectedCount"
            :is-action-locked="isActionLocked"
            :show-recheck="!disableCheckActions"
            :is-skipped-mode="disableCheckActions"
            v-model:show-menu="showBatchMenu"
            @recheck="runBulkAction('recheck')"
            @skip="runBulkAction('skip')"
            @copy="runBulkAction('copy')"
            @delete="runBulkAction('delete')"
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
            <template v-if="isLoading && stats.total === 0 && stats.skipped === 0">
              <Skeleton width="64px" height="14px" border-radius="4px" />
            </template>
            <template v-else>
              {{ bottomSummary }}
            </template>
          </span>
        </template>

        <span v-else class="check-progress-text">{{ progressTooltip }}</span>

        <div class="bottom-actions" @click.stop>
          <button
            v-tooltip.top="'导出检测结果为 CSV 文件'"
            class="btn-ghost"
            :disabled="isActionLocked"
            @click="emit('export-csv')"
          >
            <i class="pi pi-download"></i>
            导出
          </button>

          <CheckBatchMenu
            v-if="batchFilterLabel && !isChecking && !disableCheckActions"
            :target-label="batchFilterLabel"
            :filter-count="batchFilterCount"
            :is-action-locked="isActionLocked"
            v-model:show-menu="showBatchMenu"
            @recheck="runBulkAction('recheck')"
            @skip="runBulkAction('skip')"
            @copy="runBulkAction('copy')"
            @delete="runBulkAction('delete')"
          />

          <span v-if="!disableCheckActions || isChecking" class="action-divider"></span>

          <div
            v-if="!isChecking && !disableCheckActions"
            class="check-btn-group"
            :class="{ 'has-dropdown': showDropdownArrow }"
          >
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
                  <div class="dropdown-text">
                    <span class="dropdown-label">{{ item.label }}</span>
                    <span class="dropdown-desc">{{ item.desc }}</span>
                  </div>
                </div>
              </div>
            </Transition>
          </div>

          <button v-else-if="isChecking" class="btn-danger" @click="emit('cancel-check')">
            <i class="pi pi-stop"></i>
            取消
          </button>

          <span v-else class="skip-hint">已跳过链接不会参与检测</span>
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

.check-dropdown-item:not(:last-child) {
  border-bottom: 1px solid var(--border-subtle);
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

.batch-count,
.skip-hint {
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-weight: var(--weight-medium);
}

.skip-hint {
  color: var(--warning);
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
