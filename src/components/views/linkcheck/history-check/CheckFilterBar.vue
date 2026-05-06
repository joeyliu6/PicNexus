<script setup lang="ts">
import { ref, watch } from 'vue';
import Skeleton from 'primevue/skeleton';
import { getServiceDisplayName } from '../../../../constants/serviceNames';
import type { CheckStatsResult } from '../../../../composables/link-check/useCheckStats';
import type { StatusFilter } from '../../../../types/linkCheck';
import { getServiceIcon } from '../../../../utils/icons';

const props = defineProps<{
  stats: CheckStatsResult;
  serviceList: { id: string; count: number }[];
  isLoading: boolean;
  isChecking: boolean;
  isPhase2Loading: boolean;
  phase2Duration: number;
}>();

const animatedValid = ref(props.stats.valid);
const animatedTotal = ref(props.stats.total);
const animatedUnchecked = ref(props.stats.unchecked);

function countUp(to: number, target: typeof animatedValid, durationMs: number): void {
  if (durationMs <= 0) {
    target.value = to;
    return;
  }

  const from = target.value;
  const start = performance.now();
  const step = (now: number) => {
    const progress = Math.min((now - start) / durationMs, 1);
    const eased = 1 - (1 - progress) ** 3;
    target.value = Math.round(from + (to - from) * eased);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

watch(() => props.isPhase2Loading, (loading) => {
  if (loading) return;
  const duration = props.phase2Duration < 300 ? 0 : 500;
  countUp(props.stats.valid, animatedValid, duration);
  countUp(props.stats.total, animatedTotal, duration);
  countUp(props.stats.unchecked, animatedUnchecked, duration);
});

watch(
  () => props.stats,
  (stats) => {
    if (props.isPhase2Loading) return;
    animatedValid.value = stats.valid;
    animatedTotal.value = stats.total;
    animatedUnchecked.value = stats.unchecked;
  },
  { immediate: true },
);

const statusFilter = defineModel<StatusFilter>('statusFilter', { required: true });
const selectedServiceId = defineModel<string | null>('selectedServiceId', { required: true });
const showServiceMenu = defineModel<boolean>('showServiceMenu', { required: true });
const searchInput = defineModel<string>('searchInput', { required: true });
const searchQuery = defineModel<string>('searchQuery', { required: true });
const searchFocused = defineModel<boolean>('searchFocused', { required: true });

const serviceTotal = () => props.stats.total;

function selectStatusFilter(filter: StatusFilter): void {
  if (statusFilter.value === filter) return;
  statusFilter.value = filter;
}
</script>

<template>
  <div class="chip-bar" :aria-busy="isChecking || isPhase2Loading">
    <div class="chip-group">
      <template v-if="isLoading && stats.total === 0">
        <Skeleton width="52px" height="24px" border-radius="20px" />
        <Skeleton width="65px" height="24px" border-radius="20px" />
        <Skeleton width="75px" height="24px" border-radius="20px" />
        <Skeleton width="52px" height="24px" border-radius="20px" />
        <Skeleton width="52px" height="24px" border-radius="20px" />
      </template>

      <template v-else>
        <button
          v-if="stats.problems > 0"
          class="filter-chip chip--problems"
          :class="{ active: statusFilter === 'problems' }"
          :aria-pressed="statusFilter === 'problems'"
          @click="selectStatusFilter('problems')"
        >
          <span class="chip-dot problem-dot"></span>
          问题
          {{ stats.problems }}
        </button>

        <button
          class="filter-chip chip--error"
          :class="{ active: statusFilter === 'invalid' }"
          :aria-pressed="statusFilter === 'invalid'"
          @click="selectStatusFilter('invalid')"
        >
          <span class="chip-dot" style="background: var(--error)"></span>
          失效
          {{ stats.invalid }}
        </button>

        <button
          v-if="stats.suspicious > 0"
          class="filter-chip chip--suspicious"
          :class="{ active: statusFilter === 'suspicious' }"
          :aria-pressed="statusFilter === 'suspicious'"
          @click="selectStatusFilter('suspicious')"
        >
          <span class="chip-dot" style="background: var(--pending)"></span>
          可疑
          {{ stats.suspicious }}
        </button>

        <button
          v-if="stats.timeout > 0"
          class="filter-chip chip--timeout"
          :class="{ active: statusFilter === 'timeout' }"
          :aria-pressed="statusFilter === 'timeout'"
          @click="selectStatusFilter('timeout')"
        >
          <span class="chip-dot" style="background: var(--warning)"></span>
          超时
          {{ stats.timeout }}
        </button>

        <button
          v-if="isPhase2Loading || stats.unchecked > 0"
          class="filter-chip chip--unchecked"
          :class="{ active: statusFilter === 'unchecked', 'chip--phase2': isPhase2Loading }"
          :aria-pressed="statusFilter === 'unchecked'"
          :disabled="isPhase2Loading"
          @click="selectStatusFilter('unchecked')"
        >
          <span class="chip-dot" style="background: var(--text-tertiary)"></span>
          未检测
          <span v-if="isPhase2Loading" class="chip-loading-placeholder"></span>
          <template v-else>{{ animatedUnchecked.toLocaleString() }}</template>
        </button>

        <button
          class="filter-chip chip--valid"
          :class="{ active: statusFilter === 'valid', 'chip--phase2': isPhase2Loading }"
          :aria-pressed="statusFilter === 'valid'"
          :disabled="isPhase2Loading"
          @click="selectStatusFilter('valid')"
        >
          <span class="chip-dot" style="background: var(--success)"></span>
          正常
          <span v-if="isPhase2Loading" class="chip-loading-placeholder"></span>
          <template v-else>{{ animatedValid.toLocaleString() }}</template>
        </button>

        <button
          class="filter-chip chip--all"
          :class="{ active: statusFilter === 'all', 'chip--phase2': isPhase2Loading }"
          :aria-pressed="statusFilter === 'all'"
          :disabled="isPhase2Loading"
          @click="selectStatusFilter('all')"
        >
          全部
          <span v-if="isPhase2Loading" class="chip-loading-placeholder"></span>
          <template v-else>{{ animatedTotal.toLocaleString() }}</template>
        </button>
      </template>
    </div>

    <div class="chip-spacer"></div>

    <div v-if="serviceList.length > 1" class="service-filter" @click.stop>
      <button class="filter-chip" :class="{ active: !!selectedServiceId }" @click="showServiceMenu = !showServiceMenu">
        <template v-if="selectedServiceId">
          <span class="badge-icon" v-html="getServiceIcon(selectedServiceId)"></span>
          {{ getServiceDisplayName(selectedServiceId) }}
        </template>
        <template v-else>
          <i class="pi pi-images" style="font-size: var(--text-2xs)"></i>
          全部图床
        </template>
        <i class="pi pi-chevron-down" style="font-size: var(--text-2xs); margin-left: var(--space-2xs)"></i>
      </button>

      <Transition name="dropdown">
        <div v-if="showServiceMenu" class="service-dropdown">
          <div
            class="service-dropdown-item"
            :class="{ active: !selectedServiceId }"
            @click="selectedServiceId = null; showServiceMenu = false"
          >
            <span class="sdi-label">全部图床</span>
            <span class="sdi-count">{{ serviceTotal().toLocaleString() }}</span>
          </div>

          <div
            v-for="service in serviceList"
            :key="service.id"
            class="service-dropdown-item"
            :class="{ active: selectedServiceId === service.id }"
            @click="selectedServiceId = service.id; showServiceMenu = false"
          >
            <span class="sdi-label">
              <span class="badge-icon" v-html="getServiceIcon(service.id)"></span>
              {{ getServiceDisplayName(service.id) }}
            </span>
            <span class="sdi-count">{{ service.count.toLocaleString() }}</span>
          </div>
        </div>
      </Transition>
    </div>

    <div class="search-field" :class="{ focused: searchFocused }">
      <i class="pi pi-search search-field-icon"></i>
      <input
        v-model="searchInput"
        type="text"
        class="search-field-input"
        placeholder="搜索文件名..."
        aria-label="搜索链接文件名"
        @focus="searchFocused = true"
        @blur="searchFocused = false"
      />
      <i
        v-show="searchInput"
        class="pi pi-times search-field-clear"
        @click="searchInput = ''; searchQuery = ''"
      ></i>
    </div>
  </div>
</template>

<style scoped>
.chip-bar {
  display: flex;
  align-items: center;
  gap: var(--space-sm-md);
  flex-shrink: 0;
  padding-right: var(--space-xl);
}

.chip-group {
  display: flex;
  gap: var(--space-xs-sm);
  flex-wrap: wrap;
}

.chip-spacer {
  flex: 1;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 5px chip icon spacing has no exact token */
  gap: 5px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 26px chip height matches existing monitor controls */
  height: 26px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 10px horizontal chip padding has no exact token */
  padding: 0 10px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 13px pill radius preserves current chip silhouette */
  border-radius: 13px;
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
  background: var(--bg-input);
  color: var(--text-muted);
  border: 1px solid transparent;
  transition: background var(--duration-fast), color var(--duration-fast), border-color var(--duration-fast);
  white-space: nowrap;
}

.filter-chip:hover {
  background: var(--hover-overlay);
  border-color: var(--border-subtle);
}

.filter-chip.chip--problems.active {
  background: var(--error-alpha-10);
  color: var(--error);
  border-color: var(--error-alpha-15);
}

.problem-dot {
  background: linear-gradient(135deg, var(--error) 0%, var(--warning) 100%);
}

.filter-chip.chip--error.active {
  background: var(--error-alpha-15);
  color: var(--error);
  border-color: var(--error-alpha-15);
}

.filter-chip.chip--suspicious.active {
  background: var(--pending-alpha-8);
  color: var(--pending);
  border-color: var(--pending-alpha-8);
}

.filter-chip.chip--timeout.active {
  background: var(--warning-alpha-8);
  color: var(--warning);
  border-color: var(--warning-alpha-8);
}

.filter-chip.chip--unchecked.active {
  background: var(--bg-input);
  color: var(--text-main);
  border-color: var(--border-subtle);
}

.filter-chip.chip--valid.active {
  background: var(--success-alpha-10);
  color: var(--success);
  border-color: var(--success-alpha-10);
}

.filter-chip.chip--all.active {
  background: var(--primary-alpha-10);
  color: var(--primary);
  border-color: var(--primary-alpha-10);
}

.chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.chip-loading-placeholder {
  display: inline-block;
  width: 16px;
  height: 2px;
  background: currentcolor;
  opacity: 0.4;
  vertical-align: middle;
  animation: k-pulse var(--duration-breathe) ease-in-out infinite;
}

.filter-chip.chip--phase2 {
  pointer-events: none;
  opacity: 0.6;
  cursor: default;
}

.service-filter {
  position: relative;
  flex-shrink: 0;
}

.service-filter .filter-chip {
  gap: var(--space-xs);
}

.service-filter .filter-chip.active {
  background: var(--primary-alpha-10);
  color: var(--primary);
  border-color: var(--primary-alpha-10);
}

.service-filter .badge-icon {
  width: 12px;
  height: 12px;
  display: inline-flex;
}

.service-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 180px;
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: var(--space-xs) 0;
  box-shadow: var(--shadow-float);
  z-index: var(--z-dropdown);
  border: 1px solid var(--border-subtle);
  overflow: hidden;
}

.service-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md-lg);
  cursor: pointer;
  transition: background var(--duration-micro);
}

.service-dropdown-item:hover {
  background: var(--hover-overlay);
}

.service-dropdown-item.active {
  background: var(--primary-alpha-10);
}

.sdi-label {
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-main);
  white-space: nowrap;
}

.sdi-label .badge-icon {
  width: 14px;
  height: 14px;
  color: var(--text-muted);
}

.sdi-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
}

.badge-icon {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--text-muted);
}

.badge-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.search-field {
  display: flex;
  align-items: center;
  background: var(--bg-input);
  border-radius: var(--radius-xl);
  height: 32px;
  padding: 0 var(--space-sm) 0 var(--space-sm-md);
  min-width: 140px;
  max-width: 260px;
  flex: 1;
  border: 1px solid transparent;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
  flex-shrink: 0;
}

.search-field.focused {
  border-color: var(--primary);
}

.search-field-icon {
  color: var(--text-secondary);
  font-size: var(--text-xs);
  flex-shrink: 0;
  opacity: 0.5;
  margin-right: var(--space-xs-sm);
  transition: opacity var(--duration-fast), color var(--duration-fast);
}

.search-field.focused .search-field-icon {
  opacity: 0.8;
  color: var(--primary);
}

.search-field-input {
  flex: 1;
  background: transparent;
  border: none;
  box-shadow: none;
  outline: none;
  color: var(--text-primary);
  font-size: var(--text-sm);
  padding: 0;
  height: 100%;
  min-width: 0;
}

.search-field-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.5;
}

.search-field-clear {
  color: var(--text-secondary);
  font-size: var(--text-2xs);
  cursor: pointer;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-fast);
  opacity: 0.5;
}

.search-field-clear:hover {
  color: var(--text-primary);
  background: var(--hover-overlay);
  opacity: 1;
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition: all var(--duration-normal) ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
