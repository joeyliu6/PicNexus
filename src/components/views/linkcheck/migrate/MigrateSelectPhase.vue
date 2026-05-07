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
  timestampAfterMs, migrateScope,
} = ctx;

const hasPublicTarget = computed(() =>
  checkedTargets.value.some(s => isPublicService(s.serviceId))
);

const noSourceSelected = computed(() =>
  availableSourceServices.value.length > 0 && sourceServiceFilter.value.length === 0
);

const isRecoveryScope = computed(() => migrateScope.value === 'broken-with-valid-source');
const migrateActionText = computed(() => isRecoveryScope.value ? '恢复备份' : '补传备份');

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

function toggleAllSources(selectAll: boolean) {
  sourceServiceFilter.value = selectAll
    ? availableSourceServices.value.map(s => s.id)
    : [];
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
  return `从 ${displayedSourceNames.value} ${migrateActionText.value} ${formatNumber(totalPending.value)} 张至 ${checkedTargets.value.map(s => s.displayName).join('、')}`;
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

    <!-- 骨架屏：冷启动（!isFilterApplied）或首次 init 期间；热刷新时两者均为 true 故不显示 -->
    <div v-else-if="!isInitialized || !isFilterApplied" class="sk-layout" aria-busy="true" aria-live="polite">
      <div class="sk-left">
        <div class="sk-column-head">
          <div class="sk-column-label" />
          <div class="sk-toggle-all" />
          <div class="sk-filter-trigger" />
        </div>
        <div v-for="i in 8" :key="i" class="sk-source-row">
          <div class="sk-checkbox" />
          <div class="sk-icon" />
          <div class="sk-line sk-line--name" />
          <div class="sk-count">
            <div class="sk-line sk-line--count-num" />
            <div class="sk-line sk-line--count-unit" />
          </div>
        </div>
      </div>
      <div class="sk-divider" aria-hidden="true" />
      <div class="sk-right">
        <div class="sk-column-label-slot">
          <div class="sk-column-label" />
        </div>
        <div class="sk-target-grid">
          <div v-for="i in 4" :key="i" class="sk-target-card">
            <div class="sk-target-top">
              <div class="sk-target-icon" />
              <div class="sk-line sk-line--title" />
              <div class="sk-dot" />
            </div>
            <div class="sk-target-count">
              <div class="sk-line sk-line--target-num" />
              <div class="sk-line sk-line--target-unit" />
            </div>
          </div>
          <div class="sk-target-card">
            <div class="sk-target-top">
              <div class="sk-target-icon sk-icon--ghost" />
              <div class="sk-line sk-line--title" />
            </div>
            <div class="sk-target-count">
              <div class="sk-line sk-line--target-unit sk-line--target-unit-add" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <EmptyState
      v-else-if="configuredServices.length === 0"
      icon="pi pi-cog"
      title="暂无已配置的图床"
    >
      <p class="migrate-empty-desc">
        请先在设置中<button class="migrate-empty-link" @click="navigateToSettings">配置至少一个图床</button>
      </p>
    </EmptyState>

    <!-- 分栏布局 -->
    <div v-else class="split-layout">
      <!-- 左栏：迁移来源 -->
      <SourceList
        :sources="availableSourceServices"
        :selectedIds="sourceServiceFilter"
        @toggle="toggleSourceFilter"
        @toggle-all="toggleAllSources"
      >
        <template #filter-trigger>
          <MigrateFilterPopover
            :maxSuccessCount="maxSuccessCount"
            :timestampAfterMs="timestampAfterMs"
            :migrateScope="migrateScope"
            @update:maxSuccessCount="maxSuccessCount = $event"
            @update:timestampAfterMs="timestampAfterMs = $event"
            @update:migrateScope="migrateScope = $event"
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
            :backedUpCount="svc.backedUpCount"
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

  <!-- 底栏骨架：与 sk-layout 同步 -->
  <div v-if="!isInitialized || !isFilterApplied" class="bottom" aria-busy="true" aria-live="polite">
    <div class="bottom-main">
      <div class="sk-bottom-text" />
      <div class="sk-bottom-btn" />
    </div>
  </div>

  <!-- 底栏 -->
  <div v-else-if="configuredServices.length > 0" class="bottom">
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
          <span class="bottom-dim">{{ migrateActionText }}</span>
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
  flex: 1; overflow: hidden auto; padding: 0 var(--space-lg-xl) 0 0;
  display: flex; flex-direction: column;
  min-width: 0;
}

/* 冷启动骨架屏：镜像真实布局的几何结构，避免加载完成后 UI 跳跃 */
.sk-layout { display: flex; flex: 1; min-height: 0; gap: var(--space-md); overflow: hidden; }
.sk-left { flex: 0 0 42%; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
.sk-divider { flex: 0 0 auto; width: calc(var(--text-lg) + var(--space-sm) * 2); }
.sk-right { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }

/* 共用 shimmer：用 border-subtle-light 作底（比 bg-surface-low 色深更多，更明显） */
.sk-column-label, .sk-filter-trigger, .sk-toggle-all, .sk-checkbox, .sk-icon, .sk-target-icon, .sk-dot, .sk-line, .sk-bottom-text, .sk-bottom-btn {
  background: linear-gradient(90deg, var(--border-subtle-light) 25%, var(--bg-card) 50%, var(--border-subtle-light) 75%);
  background-size: 200% 100%;
  animation: k-shimmer var(--duration-shimmer) ease-in-out infinite;
}
.sk-column-label, .sk-filter-trigger, .sk-checkbox, .sk-icon, .sk-target-icon, .sk-line, .sk-bottom-text { border-radius: var(--radius-sm); }

.sk-column-head {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}

.sk-column-label { width: 44px; height: 9px; }
.sk-toggle-all { width: 28px; height: 9px; margin-left: auto; border-radius: var(--radius-sm); }
.sk-filter-trigger { width: 24px; height: 24px; border-radius: var(--radius-sm-md); }

.sk-column-label-slot {
  display: flex;
  align-items: center;
  height: 19px;
  margin-bottom: var(--space-sm);
  flex-shrink: 0;
}

.sk-source-row {
  display: flex; align-items: center; gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm-md);
  min-height: 37px;
}
.sk-source-row + .sk-source-row { margin-top: var(--space-2xs); }

.sk-checkbox { width: 16px; height: 16px; flex-shrink: 0; }
.sk-icon { width: 16px; height: 16px; flex-shrink: 0; }
.sk-target-icon { width: 18px; height: 18px; flex-shrink: 0; }
.sk-icon--ghost { opacity: 0.5; }
.sk-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-left: auto; }

.sk-line--name { flex: 1; height: 10px; max-width: 150px; }
.sk-count { display: inline-flex; align-items: baseline; gap: var(--space-2xs); margin-left: auto; flex-shrink: 0; }
.sk-line--count-num { width: 46px; height: 10px; }
.sk-line--count-unit { width: 12px; height: 8px; opacity: 0.72; }
.sk-line--title { flex: 1; min-width: 0; height: 11px; max-width: 132px; }
.sk-target-count { display: inline-flex; align-items: center; gap: var(--space-2xs); min-width: 0; min-height: 21px; }
.sk-line--target-num { width: 34px; height: 10px; }
.sk-line--target-unit { width: 68px; height: 10px; opacity: 0.72; }
.sk-line--target-unit-add { width: 92px; }

.sk-target-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-md);
}

/* 底栏骨架：文字条 + 按钮块 */
.sk-bottom-text { flex: 1; max-width: 172px; height: 10px; }
.sk-bottom-btn { width: 87px; height: 28px; border-radius: var(--radius-sm-md); flex-shrink: 0; }

/* 骨架卡片用虚线弱化边框，避免看起来像"已加载的空卡" */
.sk-target-card {
  display: flex; flex-direction: column; gap: var(--space-sm);
  padding: var(--space-md-lg) var(--space-lg);
  border-radius: var(--radius-md);
  border: 1px dashed var(--border-subtle);
  background: transparent;
  min-height: 81px;
  min-width: 0;
}
.sk-target-top { display: flex; align-items: center; gap: var(--space-sm); min-width: 0; min-height: 22px; }

/* 分栏布局 */
.split-layout { display: flex; flex: 1; min-height: 0; gap: var(--space-md); overflow: hidden; }

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
  display: flex; flex-direction: column; overflow: hidden auto;
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

.migrate-empty-desc {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
  margin: 0;
  text-align: center;
}

.migrate-empty-link {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: inherit;
  color: var(--primary);
  cursor: pointer;
  transition: color var(--duration-normal) ease;
}

.migrate-empty-link:hover {
  color: var(--primary-hover, #3b82f6);
  text-decoration: underline;
}

.target-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-md);
}

/* 未配置添加卡片（结构与 TargetCard 对齐，保持高度一致） */
.target-card-add {
  display: flex; flex-direction: column; gap: var(--space-sm);
  padding: var(--space-md-lg) var(--space-lg);
  border-radius: var(--radius-md);
  border: 1px dashed var(--border-subtle);
  background: transparent;
  cursor: pointer; color: var(--text-tertiary);
  min-width: 0;
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
.target-card-add-top { display: flex; align-items: center; gap: var(--space-sm); min-width: 0; }

.target-card-add-icon {
  width: 18px; height: 18px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  font-size: var(--text-lg); line-height: 1; font-weight: var(--weight-regular);
}

.target-card-add-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  letter-spacing: -0.01em;
}

.target-card-add-hint {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

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
