<script setup lang="ts">
/**
 * E1 选择阶段 — 左栏来源 + 右栏目标（双列网格 + 统计卡片）
 */
import { computed, inject } from 'vue';
import Select from 'primevue/select';
import EmptyState from '../../../common/EmptyState.vue';
import { emit as tauriEmit } from '@tauri-apps/api/event';
import { formatNumber, filterThresholds } from './utils';
import { MIGRATE_KEY } from './keys';
import SourceList from './components/SourceList.vue';
import TargetCard from './components/TargetCard.vue';

const ctx = inject(MIGRATE_KEY)!;

const {
  isInitialized, isFilterApplied, maxSuccessCount, sourceServiceFilter,
  availableSourceServices, showAdvancedFilter, configuredServices,
  unconfiguredServices, checkedTargets, totalPending, allBackedUp,
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

const totalSourceImages = computed(() =>
  availableSourceServices.value.reduce((sum, s) => sum + s.count, 0),
);

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
        @toggle="toggleSourceFilter"
      />

      <!-- 右栏：迁移目标 -->
      <div class="split-right">
        <span class="split-label">迁移目标</span>

        <div v-if="allBackedUp" class="backed-up-banner">
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

        <!-- 统计卡片 -->
        <div class="migrate-stats">
          <div class="stat-item">
            <span class="stat-value">{{ formatNumber(totalSourceImages) }}</span>
            <span class="stat-label">总图片数</span>
          </div>
          <div class="stat-item">
            <span
              class="stat-value"
              :class="totalPending > 0 ? 'stat-primary' : 'stat-muted'"
            >{{ formatNumber(totalPending) }}</span>
            <span class="stat-label">待迁移</span>
          </div>
          <div class="stat-item">
            <span
              class="stat-value"
              :class="checkedTargets.length > 0 ? 'stat-success' : 'stat-muted'"
            >{{ checkedTargets.length }}</span>
            <span class="stat-label">目标图床</span>
          </div>
        </div>

        <!-- 未配置入口 -->
        <div
          v-if="unconfiguredServices.length > 0"
          class="unconfigured-bar"
          @click="navigateToSettings"
        >
          <div class="unconfigured-left">
            <i class="pi pi-external-link" />
            <span>其他 {{ unconfiguredServices.length }} 个图床（未配置）</span>
          </div>
          <span class="unconfigured-link">去设置 →</span>
        </div>

        <!-- 高级筛选 -->
        <button class="filter-toggle" @click="showAdvancedFilter = !showAdvancedFilter">
          <i class="pi pi-sliders-h" />
          <span>高级筛选</span>
          <i class="pi pi-chevron-down filter-arrow" :class="{ 'filter-arrow--open': showAdvancedFilter }" />
        </button>
        <div v-if="showAdvancedFilter" class="filter-body">
          <div class="filter-row">
            <span class="filter-label">仅处理备份不足</span>
            <Select
              v-model="maxSuccessCount"
              :options="filterThresholds"
              optionLabel="label"
              optionValue="value"
              class="filter-select"
            />
            <span class="filter-label">份的图片</span>
          </div>
        </div>
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
@import './migrate-shared.css';

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
.split-label { font-size: var(--text-sm); font-weight: 600; color: var(--text-muted); margin-bottom: var(--space-md); display: block; }

/* 右栏 */
.split-right {
  flex: 1; min-width: 0; padding: var(--space-lg);
  display: flex; flex-direction: column; overflow-y: auto;
}

.backed-up-banner {
  display: flex; align-items: center; gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md); border-radius: var(--radius-sm-md); margin-bottom: var(--space-sm);
  background: var(--success-alpha-10); font-size: var(--text-xs); color: var(--success);
}
.backed-up-banner i { font-size: var(--text-base); flex-shrink: 0; }

.target-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-sm); }

/* 统计卡片 */
.migrate-stats {
  display: flex; justify-content: space-around; align-items: center;
  padding: var(--space-lg) var(--space-lg-xl);
  border-radius: var(--radius-md); border: 1px solid var(--border-subtle);
  margin-top: var(--space-md);
}
.stat-item { display: flex; flex-direction: column; align-items: center; gap: var(--space-xs); }
.stat-value { font-size: var(--text-xl); font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.stat-primary { color: var(--primary); }
.stat-success { color: var(--success); }
.stat-muted { color: var(--text-muted); }
.stat-label { font-size: var(--text-xs); color: var(--text-muted); }

/* 未配置入口 */
.unconfigured-bar { display: flex; align-items: center; justify-content: space-between; padding: var(--space-sm) var(--space-md); margin-top: var(--space-sm); cursor: pointer; transition: background var(--duration-fast); border-radius: var(--radius-sm-md); }
.unconfigured-bar:hover { background: var(--bg-surface-low); }
.unconfigured-left { display: flex; align-items: center; gap: var(--space-xs-sm); font-size: var(--text-xs); color: var(--text-tertiary); }
.unconfigured-left i { font-size: var(--text-2xs); }
.unconfigured-link { font-size: var(--text-xs); font-weight: 500; color: var(--primary); }

/* 高级筛选 */
.filter-toggle { display: flex; align-items: center; gap: var(--space-xs-sm); width: 100%; background: none; cursor: pointer; font-size: var(--text-xs); color: var(--text-tertiary); padding: var(--space-sm) 0; margin-top: var(--space-sm); font-family: inherit; border: none; transition: color var(--duration-fast); }
.filter-toggle:hover { color: var(--text-secondary); }
.filter-toggle i:first-child { font-size: var(--text-xs); }
.filter-arrow { font-size: var(--text-2xs) !important; margin-left: auto; transition: transform var(--duration-fast); }
.filter-arrow--open { transform: rotate(180deg); }

.filter-body { display: flex; flex-direction: column; gap: var(--space-sm); padding: var(--space-sm-md) var(--space-md); border-radius: var(--radius-sm-md); background: transparent; font-size: var(--text-sm); color: var(--text-secondary); }
.filter-row { display: flex; align-items: center; gap: var(--space-sm); }
.filter-label { white-space: nowrap; font-size: var(--text-xs); }

:deep(.filter-select.p-select) { height: 28px; min-width: 60px; border-radius: var(--radius-sm-md); border: none; outline: 1px solid var(--outline-ghost); background: var(--bg-card); font-size: var(--text-sm); }
:deep(.filter-select.p-select:focus-within) { outline: 2px solid var(--primary-alpha-40); }
:deep(.filter-select .p-select-label) { padding: var(--space-xs) var(--space-sm); font-size: var(--text-sm); }

/* 底栏追加 */
.bottom-hl { color: var(--primary); font-weight: 600; }
</style>
