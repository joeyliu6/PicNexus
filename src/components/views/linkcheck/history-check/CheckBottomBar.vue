<script setup lang="ts">
import Skeleton from 'primevue/skeleton';
import CheckBottomActions from './CheckBottomActions.vue';
import StatePill, { type StatePill as StatePillType } from '../common/StatePill.vue';
import type { CheckStatsResult } from '../../../../composables/link-check/useCheckStats';
import type { MoreMenuItem, MoreMenuKind } from '../../../../composables/link-check/useCheckStrategy';

defineProps<{
  isChecking: boolean;
  isPaused: boolean;
  statePill: StatePillType | null;
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
  moreMenuItems: MoreMenuItem[];
  moreMenuScopeLabel: string;
}>();

const emit = defineEmits<{
  (e: 'toggle-select-all'): void;
  (e: 'clear-selection'): void;
  (e: 'smart-check'): void;
  (e: 'cancel-check'): void;
  (e: 'pause-check'): void;
  (e: 'resume-check'): void;
  (e: 'page-input', event: Event): void;
  (e: 'more-action', kind: MoreMenuKind): void;
}>();

const currentPage = defineModel<number>('currentPage', { required: true });
const pageInput = defineModel<string>('pageInput', { required: true });
const showOverflowMenu = defineModel<boolean>('showOverflowMenu', { required: true });
</script>

<template>
  <div class="bottom" :class="{ 'is-checking': isChecking && progressSource !== 'rescue' }">
    <div class="bottom-main">
      <!-- 左：分页（始终常驻） -->
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

      <!-- 中：summary / pill —— 检测中显示进度文字 + pill；空闲显示总数 -->
      <div class="bottom-info">
        <span v-if="isLoading && stats.total === 0" class="page-summary">
          <Skeleton width="64px" height="14px" border-radius="4px" />
        </span>
        <template v-else-if="isChecking && progressSource !== 'rescue'">
          <span class="page-summary">{{ progressTooltip }}</span>
          <StatePill :pill="statePill" />
        </template>
        <span v-else class="page-summary">{{ bottomSummary }}</span>
      </div>

      <!-- 右：动作区 -->
      <CheckBottomActions
        :is-checking="isChecking && progressSource !== 'rescue'"
        :is-paused="isPaused"
        :has-selection="hasSelection"
        :is-all-selected="isAllSelected"
        :selected-count="selectedCount"
        :is-action-locked="isActionLocked"
        :smart-check-label="smartCheckLabel"
        :smart-check-tooltip="smartCheckTooltip"
        :more-menu-items="moreMenuItems"
        :more-menu-scope-label="moreMenuScopeLabel"
        v-model:show-overflow-menu="showOverflowMenu"
        @toggle-select-all="emit('toggle-select-all')"
        @clear-selection="emit('clear-selection')"
        @smart-check="emit('smart-check')"
        @pause-check="emit('pause-check')"
        @resume-check="emit('resume-check')"
        @cancel-check="emit('cancel-check')"
        @more-action="(kind) => emit('more-action', kind)"
      />
    </div>

    <!-- 底沿薄进度条：仅监控自身检测中显示 -->
    <div
      v-if="isChecking && progressSource !== 'rescue'"
      class="progress-strip"
      role="progressbar"
      :aria-valuenow="progressPercent"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="progressTooltip"
    >
      <div class="progress-strip-fill" :style="{ width: progressPercent + '%' }"></div>
    </div>
  </div>
</template>

<style scoped>
.bottom {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  flex-shrink: 0;
  padding-right: var(--space-xl);
}

.bottom-main {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.bottom-info {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex: 1;
  min-width: 0;
}

.page-summary {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.pagination {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
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

.page-btn:hover:not(:disabled) { background: var(--primary-alpha-8); color: var(--primary); }
.page-btn:disabled { opacity: 0.3; cursor: default; }

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

.page-input::placeholder { color: var(--text-main); opacity: 0.6; }
.page-input:focus { border-color: var(--primary); }

/* 底沿薄进度条：贴底 1.5px，检测中可见 */
.progress-strip {
  position: absolute;
  left: 0;
  right: var(--space-xl);
  bottom: calc(var(--space-sm) * -1);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1.5px progress strip height has no token */
  height: 1.5px;
  background: var(--bg-input);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1.5px progress rounding has no token */
  border-radius: 1.5px;
  overflow: hidden;
  pointer-events: none;
}

.progress-strip-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary), var(--primary-hover));
  transition: width var(--duration-slower) var(--ease-standard);
  position: relative;
  overflow: hidden;
}

.progress-strip-fill::after {
  content: '';
  position: absolute;
  inset: 0;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- translucent highlight is intentional for sweep effect */
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 40%), transparent);
  animation: k-sweep var(--duration-shimmer) ease-in-out infinite;
}
</style>
