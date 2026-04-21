<script setup lang="ts">
/**
 * E1 选择阶段 — 左栏来源 + 右栏目标（双列网格）
 */
import { computed, inject } from 'vue';
import EmptyState from '../../../common/EmptyState.vue';
import { emit as tauriEmit } from '@tauri-apps/api/event';
import { formatNumber, isPublicService } from './utils';
import { MIGRATE_KEY } from './keys';
import SourceList from './components/SourceList.vue';
import TargetCard from './components/TargetCard.vue';
import MigrateFilterPopover from './components/MigrateFilterPopover.vue';

const ctx = inject(MIGRATE_KEY)!;

const {
  isInitialized, isFilterApplied, isRefiltering, maxSuccessCount, sourceServiceFilter,
  availableSourceServices, configuredServices,
  unconfiguredServices, checkedTargets, totalPending, isAllBackedUp,
  initError, initConfiguring, healthStatusMap, healthTooltipMap,
  timestampAfterMs,
} = ctx;

const hasPublicTarget = computed(() =>
  checkedTargets.value.some(s => isPublicService(s.serviceId))
);

const noSourceSelected = computed(() =>
  availableSourceServices.value.length > 0 && sourceServiceFilter.value.length === 0
);

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

const displayedSourceList = computed(() => {
  return sourceServiceFilter.value.length === 0
    ? availableSourceServices.value.map(s => s.displayName)
    : sourceServiceFilter.value
        .map(id => availableSourceServices.value.find(s => s.id === id)?.displayName ?? id);
});

const displayedSourceNames = computed(() => displayedSourceList.value.join('、'));

const displayedSourceShort = computed(() => {
  const list = displayedSourceList.value;
  if (list.length <= 3) return list.join('、');
  return `${list.slice(0, 2).join('、')} 等 ${list.length} 个图床`;
});

const displayedTargetShort = computed(() => {
  const list = checkedTargets.value.map(s => s.displayName);
  if (list.length <= 3) return list.join('、');
  return `${list.slice(0, 2).join('、')} 等 ${list.length} 个`;
});

const bottomFullText = computed(() => {
  if (checkedTargets.value.length === 0) return '选择迁移目标，开始备份';
  return `从 ${displayedSourceNames.value} 迁移 ${formatNumber(totalPending.value)} 张至 ${checkedTargets.value.map(s => s.displayName).join('、')}`;
});

function getServiceHealthStatus(serviceId: string): 'verified' | 'pending' | 'error' {
  return (healthStatusMap.value[serviceId] as 'verified' | 'pending' | 'error') ?? 'pending';
}

function canStart(): boolean {
  if (noSourceSelected.value) return false;
  if (totalPending.value === 0 || checkedTargets.value.length === 0) return false;
  // 防止对健康检查异常（error）的目标硬发起迁移，避免连续失败空耗带宽
  return checkedTargets.value.every(s => getServiceHealthStatus(s.serviceId) !== 'error');
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
      <button class="btn-primary" @click="initConfiguring">重试</button>
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
      icon="pi pi-cog"
      title="暂无已配置的图床"
      description="请先在设置中配置至少一个图床"
    >
      <button class="btn-primary" @click="navigateToSettings">去设置 →</button>
    </EmptyState>

    <!-- 分栏布局 -->
    <div v-else class="split-layout">
      <!-- 左栏：迁移来源 -->
      <SourceList
        :sources="availableSourceServices"
        :selectedIds="sourceServiceFilter"
        @toggle="toggleSourceFilter"
      >
        <template #filter-trigger>
          <MigrateFilterPopover
            :maxSuccessCount="maxSuccessCount"
            :timestampAfterMs="timestampAfterMs"
            @update:maxSuccessCount="maxSuccessCount = $event"
            @update:timestampAfterMs="timestampAfterMs = $event"
          />
        </template>
      </SourceList>

      <!-- 两栏之间的方向引导 -->
      <div class="split-divider" aria-hidden="true">
        <i class="pi pi-arrow-right split-arrow" />
      </div>

      <!-- 右栏：迁移目标 -->
      <div class="split-right">
        <div v-if="configuredServices.length > 0" class="column-label">到这里</div>
        <div v-if="isAllBackedUp" class="backed-up-banner">
          <i class="pi pi-check-circle" />
          <span v-if="availableSourceServices.length === 0">当前无需备份的图片</span>
          <span v-else>当前条件下所有图片已备份</span>
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
            :noSourceSelected="noSourceSelected"
            :isRefiltering="isRefiltering"
            @toggle="handleTargetToggle(svc.serviceId)"
          />
          <!-- 未配置图床卡片 -->
          <div
            v-if="unconfiguredServices.length > 0"
            class="target-card-add"
            tabindex="0"
            role="button"
            @click="navigateToSettings"
            @keydown.enter.prevent="navigateToSettings"
          >
            <div class="target-card-add-top">
              <span class="target-card-add-icon">＋</span>
              <span class="target-card-add-label">添加新图床</span>
            </div>
            <span class="target-card-add-hint">还有 {{ unconfiguredServices.length }} 个未配置</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 底栏 -->
  <div class="bottom">
    <div class="bottom-main">
      <span class="bottom-stat" :title="bottomFullText">
        <template v-if="noSourceSelected">
          {{ checkedTargets.length === 0 ? '请先在左侧选择来源图床' : '请先选择来源图床，再开始迁移' }}
        </template>
        <template v-else-if="checkedTargets.length === 0">
          选择迁移目标，开始备份
        </template>
        <template v-else>
          <span class="bottom-dim">从</span>
          <strong class="bottom-hl" :title="displayedSourceNames">{{ displayedSourceShort }}</strong>
          <span class="bottom-dim">迁移</span>
          <strong class="bottom-hl">{{ formatNumber(totalPending) }}</strong>
          <span class="bottom-dim">张至</span>
          <strong class="bottom-hl" :title="checkedNames()">{{ displayedTargetShort }}</strong>
        </template>
      </span>
      <div class="bottom-actions">
        <i
          v-if="canStart() && hasPublicTarget"
          class="pi pi-exclamation-circle bottom-warn-icon"
          v-tooltip.top="'公共图床随时可能失效，且单日上传数量有限，大量迁移可能中途失败'"
          aria-label="公共图床风险提示"
        />
        <button class="btn-primary" :disabled="!canStart()" @click="emit('start')">
          <svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11" style="flex-shrink:0;display:block"><path d="M3 2l10 6-10 6V2z"/></svg>
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
.split-layout { display: flex; flex: 1; min-height: 0; gap: var(--space-md); }

/* 两栏之间的方向引导 */
.split-divider {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 var(--space-sm);
}

.split-arrow {
  font-size: var(--text-lg);
  color: var(--primary-alpha-40);
}

/* 栏目标签（与左栏「从这里」成对出现） */
.column-label {
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-weight: var(--weight-regular);
  margin-bottom: var(--space-sm);
  letter-spacing: 0.02em;
}

/* 右栏 */
.split-right {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; overflow-y: auto;
}

.backed-up-banner {
  display: flex; align-items: center; gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm-md);
  margin-bottom: var(--space-sm);
  background: var(--success-alpha-10);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.backed-up-banner i { font-size: var(--text-base); color: var(--success); flex-shrink: 0; }

.target-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md); }

/* 未配置添加卡片（结构与 TargetCard 对齐，保持高度一致） */
.target-card-add {
  display: flex; flex-direction: column; gap: var(--space-sm);
  padding: var(--space-md-lg) var(--space-lg);
  border-radius: var(--radius-md);
  border: 1px dashed var(--border-subtle);
  background: transparent;
  cursor: pointer; color: var(--text-tertiary);
  transition:
    border-color var(--duration-normal) var(--ease-decelerate),
    color var(--duration-normal) var(--ease-decelerate),
    background var(--duration-normal) var(--ease-decelerate);
  user-select: none;
}

.target-card-add:hover {
  border-color: var(--primary-alpha-40);
  color: var(--primary);
  background: var(--hover-overlay-subtle);
}
.target-card-add-top { display: flex; align-items: center; gap: var(--space-sm); }

.target-card-add-icon {
  width: 18px; height: 18px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  font-size: var(--text-lg); line-height: 1; font-weight: var(--weight-regular);
}
.target-card-add-label { font-size: var(--text-base); font-weight: var(--weight-semibold); letter-spacing: -0.01em; }
.target-card-add-hint { font-size: var(--text-xs); color: var(--text-tertiary); }

/* 底栏公共图床风险图标（按钮左侧 tooltip 触发） */
.bottom-warn-icon {
  font-size: var(--text-base);
  color: var(--text-muted);
  flex-shrink: 0;
  cursor: help;
}

/* 底栏追加：溢出省略（覆盖共享样式的 inline-flex） */
.bottom-main { gap: var(--space-md); align-items: center; }

.bottom-stat {
  flex: 1;
  min-width: 0;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--text-sm);
  color: var(--text-muted);
  font-weight: var(--weight-regular);
}
.bottom-actions { flex-shrink: 0; }
.bottom-dim { color: var(--text-muted); margin: 0 var(--space-xs); }

.bottom-hl {
  color: var(--primary);
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
}
</style>
