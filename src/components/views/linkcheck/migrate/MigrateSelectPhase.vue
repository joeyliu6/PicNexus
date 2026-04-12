<script setup lang="ts">
/**
 * E1 选择阶段 — 左栏来源 + 右栏目标（双列网格）
 */
import { computed, inject } from 'vue';
import EmptyState from '../../../common/EmptyState.vue';
import { emit as tauriEmit } from '@tauri-apps/api/event';
import { formatNumber } from './utils';
import { MIGRATE_KEY } from './keys';
import SourceList from './components/SourceList.vue';
import TargetCard from './components/TargetCard.vue';

const ctx = inject(MIGRATE_KEY)!;

const {
  isInitialized, isFilterApplied, maxSuccessCount, sourceServiceFilter,
  availableSourceServices, showAdvancedFilter, configuredServices,
  unconfiguredServices, checkedTargets, totalPending, isAllBackedUp,
  initError, initConfiguring, healthStatusMap, healthTooltipMap,
} = ctx;

const emit = defineEmits<{ start: [] }>();

function navigateToSettings() {
  tauriEmit('navigate-to', { view: 'settings', tab: 'hosting' });
}

function toggleSourceFilter(serviceId: string) {
  const idx = sourceServiceFilter.value.indexOf(serviceId);
  if (idx >= 0) {
    sourceServiceFilter.value = sourceServiceFilter.value.filter(id => id !== serviceId);
  } else {
    sourceServiceFilter.value = [...sourceServiceFilter.value, serviceId];
  }
}

const selectedSourceNames = computed(() => {
  if (sourceServiceFilter.value.length === 0) return '';
  return sourceServiceFilter.value
    .map(id => availableSourceServices.value.find(s => s.id === id)?.displayName ?? id)
    .join('、');
});

function getServiceHealthStatus(serviceId: string): 'verified' | 'pending' | 'error' {
  return (healthStatusMap.value[serviceId] as 'verified' | 'pending' | 'error') ?? 'pending';
}

function canStart(): boolean {
  return totalPending.value > 0 && checkedTargets.value.length > 0;
}

function checkedNames(): string {
  return checkedTargets.value.map(s => s.displayName).join('、');
}

function handleTargetToggle(serviceId: string) {
  const svc = configuredServices.value.find(s => s.serviceId === serviceId);
  if (svc) svc.checked = !svc.checked;
}
</script>

<template>
  <div class="panel-body">
    <!-- 初始化错误 -->
    <EmptyState v-if="initError" icon="pi pi-exclamation-triangle" :title="initError">
      <button class="btn-primary btn-lg" @click="initConfiguring">重试</button>
    </EmptyState>

    <!-- 加载中 -->
    <div v-else-if="!isInitialized || !isFilterApplied" class="loading-state">
      <div v-for="i in 3" :key="i" class="skeleton-row">
        <div class="skeleton-icon" />
        <div class="skeleton-text">
          <div class="skeleton-line skeleton-line--short" />
          <div class="skeleton-line skeleton-line--long" />
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <EmptyState
      v-else-if="configuredServices.length === 0"
      icon="pi pi-cloud"
      title="暂无已配置的图床"
      description="请先在设置中配置至少一个图床"
    >
      <button class="btn-primary btn-lg" @click="navigateToSettings">去设置 →</button>
    </EmptyState>

    <!-- 分栏布局 -->
    <div v-else class="split-layout">
      <!-- 左栏：迁移来源 -->
      <SourceList
        :sources="availableSourceServices"
        :selectedIds="sourceServiceFilter"
        :showAdvancedFilter="showAdvancedFilter"
        :maxSuccessCount="maxSuccessCount"
        @toggle="toggleSourceFilter"
        @clearFilter="sourceServiceFilter = []"
        @update:showAdvancedFilter="showAdvancedFilter = $event"
        @update:maxSuccessCount="maxSuccessCount = $event"
      />

      <!-- 右栏：迁移目标 -->
      <div class="split-right">
        <div v-if="isAllBackedUp" class="backed-up-banner">
          <i class="pi pi-check-circle" />
          <span>当前条件下所有图片已备份</span>
        </div>

        <div class="target-grid">
          <TargetCard
            v-for="svc in configuredServices"
            :key="svc.serviceId"
            :serviceId="svc.serviceId"
            :displayName="svc.displayName"
            :pendingCount="svc.pendingCount"
            :checked="svc.checked"
            :healthStatus="getServiceHealthStatus(svc.serviceId)"
            :healthTooltip="healthTooltipMap[svc.serviceId]"
            @toggle="handleTargetToggle(svc.serviceId)"
          />
        </div>

        <!-- 未配置脚注 -->
        <span
          v-if="unconfiguredServices.length > 0"
          class="unconfigured-hint"
          @click="navigateToSettings"
        >
          还有 {{ unconfiguredServices.length }} 个图床未配置
          <span class="unconfigured-link">去设置 →</span>
        </span>
      </div>
    </div>
  </div>

  <!-- 底栏 -->
  <div class="bottom">
    <div class="bottom-main">
      <span class="bottom-stat">
        <template v-if="checkedTargets.length > 0 && sourceServiceFilter.length > 0 && sourceServiceFilter.length < availableSourceServices.length">
          从 <strong class="bottom-hl">{{ selectedSourceNames }}</strong> 迁移
          <strong class="bottom-hl">{{ formatNumber(totalPending) }}</strong> 张至
          <strong class="bottom-hl">{{ checkedNames() }}</strong>
        </template>
        <template v-else-if="checkedTargets.length > 0">
          <strong class="bottom-hl">{{ formatNumber(totalPending) }}</strong> 张图片将迁移至
          <strong class="bottom-hl">{{ checkedNames() }}</strong>
        </template>
        <template v-else>
          选择迁移目标，开始备份
        </template>
      </span>
      <div class="bottom-actions">
        <button class="btn-primary" :disabled="!canStart()" @click="emit('start')">
          <svg viewBox="0 0 16 16" fill="currentColor" width="10" height="10" style="flex-shrink:0;display:block"><path d="M3 2l10 6-10 6V2z"/></svg>
          开始迁移
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('./migrate-shared.css');

.panel-body {
  flex: 1; overflow-y: auto; padding: 0 var(--space-lg-xl) 0 0;
  display: flex; flex-direction: column;
}

/* 加载态 */
.loading-state { display: flex; flex-direction: column; gap: var(--space-md); }
.skeleton-row { display: flex; align-items: center; gap: var(--space-md-lg); padding: var(--space-md) var(--space-lg); border-radius: var(--radius-md); background: var(--bg-card); }
.skeleton-icon { width: 36px; height: 36px; border-radius: var(--radius-md); background: var(--bg-surface-low); flex-shrink: 0; animation: k-shimmer var(--duration-shimmer) infinite; }
.skeleton-text { flex: 1; display: flex; flex-direction: column; gap: var(--space-sm); }
.skeleton-line { border-radius: var(--radius-sm); background: var(--bg-surface-low); animation: k-shimmer var(--duration-shimmer) infinite; }
.skeleton-line--short { width: 40%; height: 14px; }
.skeleton-line--long { width: 60%; height: 12px; }

/* 分栏布局 */
.split-layout { display: flex; flex: 1; min-height: 0; }

/* 右栏 */
.split-right {
  flex: 1; min-width: 0; padding-left: var(--space-lg);
  display: flex; flex-direction: column; overflow-y: auto;
}

.backed-up-banner {
  display: flex; align-items: center; gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md); border-radius: var(--radius-sm-md); margin-bottom: var(--space-sm);
  background: var(--success-alpha-10); font-size: var(--text-xs); color: var(--success);
}
.backed-up-banner i { font-size: var(--text-base); flex-shrink: 0; }

.target-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-sm); }

/* 未配置脚注 */
.unconfigured-hint {
  display: inline-flex; align-items: center; gap: var(--space-xs);
  font-size: var(--text-2xs); color: var(--text-tertiary);
  margin-top: var(--space-md); cursor: pointer;
  transition: color var(--duration-fast);
}
.unconfigured-hint:hover { color: var(--text-secondary); }
.unconfigured-link { color: var(--primary); font-weight: var(--weight-medium); }

/* 底栏追加 */
.bottom-hl { color: var(--primary); font-weight: var(--weight-semibold); }
</style>
