<script setup lang="ts">
/**
 * 补充备份 · 选择阶段：顶部结论卡（要做什么 + 开始备份）→ 备份到哪里 → 更多选项（默认收起）
 *
 * 用户唯一必须做的决定是「备份到哪」；来源默认全部图床，时间 / 份数 / 范围这类细分收进「更多选项」。
 */
import { computed, inject } from 'vue';
import EmptyState from '@/components/common/EmptyState.vue';
import { emit as tauriEmit } from '@tauri-apps/api/event';
import SummaryCard from '@/components/views/link-check/common/SummaryCard.vue';
import { isPublicService } from './utils';
import { MIGRATE_KEY } from './keys';
import TargetCard from './components/TargetCard.vue';
import MigrateOptions from './components/MigrateOptions.vue';
import { buildSetupVerdict, migrateFilterNote } from '@/composables/batch-migrate/migrateVerdict';

const ctx = inject(MIGRATE_KEY)!;

const {
  isInitialized, isFilterApplied, isRefiltering, maxSuccessCount, sourceServiceFilter,
  availableSourceServices, configuredServices,
  unconfiguredServices, checkedTargets, totalPending,
  initError, initConfiguring, healthStatusMap, healthTooltipMap,
  timestampAfterMs, migrateScope,
} = ctx;

const emit = defineEmits<{ start: [] }>();

const noSourceSelected = computed(() =>
  availableSourceServices.value.length > 0 && sourceServiceFilter.value.length === 0,
);

const filterNote = computed(() => migrateFilterNote({
  sourceNames: sourceServiceFilter.value
    .map((id) => availableSourceServices.value.find((s) => s.id === id)?.displayName ?? id),
  allSourcesSelected: sourceServiceFilter.value.length === availableSourceServices.value.length,
  timestampAfterMs: timestampAfterMs.value,
  maxSuccessCount: maxSuccessCount.value,
  scope: migrateScope.value,
}));

function healthOf(serviceId: string): 'verified' | 'pending' | 'error' {
  return (healthStatusMap.value[serviceId] as 'verified' | 'pending' | 'error') ?? 'pending';
}

/** 连接异常的目标不能开始：迁移会一路失败，白白耗流量 */
const usableTargets = computed(() => checkedTargets.value.filter((s) => healthOf(s.serviceId) !== 'error'));

const verdict = computed(() => buildSetupVerdict({
  targets: usableTargets.value.map((s) => s.displayName),
  pending: totalPending.value,
  refreshing: isRefiltering.value,
  noSource: noSourceSelected.value,
  publicTargets: usableTargets.value.filter((s) => isPublicService(s.serviceId)).map((s) => s.displayName),
  filterNote: filterNote.value,
}));

function navigateToSettings() {
  tauriEmit('navigate-to', { view: 'settings', tab: 'hosting' });
}

function handleTargetToggle(serviceId: string) {
  const svc = configuredServices.value.find(s => s.serviceId === serviceId);
  if (svc) svc.checked = !svc.checked;
}
</script>

<template>
  <div class="setup-body">
    <EmptyState v-if="initError" icon="pi pi-exclamation-triangle" :title="initError">
      <button class="summary-retry" type="button" @click="initConfiguring">重试</button>
    </EmptyState>

    <!-- 冷启动骨架：轮廓与真实布局一致（结论卡 → 目标卡片） -->
    <div v-else-if="!isInitialized || !isFilterApplied" class="setup-skeleton" aria-busy="true" aria-live="polite">
      <div class="sk-card">
        <div class="sk-icon" />
        <div class="sk-text">
          <div class="sk-line sk-line--title" />
          <div class="sk-line sk-line--subtitle" />
        </div>
        <div class="sk-button" />
      </div>
      <div class="sk-line sk-line--label" />
      <div class="target-grid">
        <div v-for="i in 4" :key="i" class="sk-target" />
      </div>
    </div>

    <SummaryCard
      v-else-if="configuredServices.length === 0"
      tone="neutral"
      hero
      icon="pi pi-cog"
      title="先配置一个图床"
      subtitle="补充备份会把图片复制到另一个图床，先在设置里配好一个"
    >
      <template #actions>
        <button type="button" class="summary-btn summary-btn--primary" @click="navigateToSettings">去设置</button>
      </template>
    </SummaryCard>

    <template v-else>
      <SummaryCard :tone="verdict.tone" icon="pi pi-copy" :title="verdict.title" :subtitle="verdict.subtitle">
        <template v-if="verdict.note" #extra>
          <p class="summary-note">
            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
            {{ verdict.note.text }}
          </p>
        </template>
        <template v-if="verdict.primary" #actions>
          <span v-tooltip.top="verdict.primary.hint ?? null">
            <button
              type="button"
              class="summary-btn summary-btn--primary"
              :disabled="verdict.primary.disabled"
              @click="emit('start')"
            >
              {{ verdict.primary.label }}
            </button>
          </span>
        </template>
      </SummaryCard>

      <div class="setup-scroll">
        <section class="target-section" aria-labelledby="target-section-label">
          <h3 id="target-section-label" class="section-label">备份到哪里</h3>
          <div class="target-grid">
            <TargetCard
              v-for="svc in configuredServices"
              :key="svc.serviceId"
              :serviceId="svc.serviceId"
              :displayName="svc.displayName"
              :pendingCount="svc.pendingCount"
              :backedUpCount="svc.backedUpCount"
              :checked="svc.checked"
              :healthStatus="healthOf(svc.serviceId)"
              :healthTooltip="healthTooltipMap[svc.serviceId]"
              :noSourceSelected="noSourceSelected"
              :isRefiltering="isRefiltering"
              @toggle="handleTargetToggle(svc.serviceId)"
            />
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
                <span class="target-card-add-label">添加图床</span>
              </div>
              <span class="target-card-add-hint">还有 {{ unconfiguredServices.length }} 个没配置</span>
            </div>
          </div>
        </section>

        <MigrateOptions
          v-model:selected-sources="sourceServiceFilter"
          v-model:timestamp-after-ms="timestampAfterMs"
          v-model:max-success-count="maxSuccessCount"
          v-model:scope="migrateScope"
          :sources="availableSourceServices"
          :note="filterNote"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.setup-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  flex: 1;
  min-height: 0;
}

.setup-scroll {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  flex: 1;
  min-height: 0;
  margin: 0 calc(var(--space-xl) * -1);
  padding: var(--space-xs) var(--space-xl) var(--space-lg-xl);
  overflow-y: auto;
}

.summary-note {
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  margin: var(--space-xs) 0 0;
  font-size: var(--text-xs);
  color: var(--warning);
}

.summary-retry {
  margin-top: var(--space-sm);
  padding: var(--space-xs) var(--space-md);
  border: none;
  border-radius: var(--radius-md);
  background: var(--primary);
  color: var(--text-on-primary);
  font-family: inherit;
  cursor: pointer;
}

.target-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.section-label {
  margin: 0;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-muted);
}

.target-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
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
}

.target-card-add-hint {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

/* ---- 骨架 ---- */
.setup-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.setup-skeleton :where(.sk-icon, .sk-line, .sk-button, .sk-target) {
  background: linear-gradient(90deg, var(--border-subtle-light) 25%, var(--bg-card) 50%, var(--border-subtle-light) 75%);
  background-size: 200% 100%;
  animation: k-shimmer var(--duration-shimmer) ease-in-out infinite;
  border-radius: var(--radius-sm);
}

.sk-card {
  display: flex;
  align-items: center;
  gap: var(--space-md-lg);
  padding: var(--space-lg) var(--space-lg-xl);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
}

.sk-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex-shrink: 0;
}

.sk-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.sk-line {
  height: 12px;
}

.sk-line--title {
  width: 200px;
  height: 16px;
}

.sk-line--subtitle {
  width: 300px;
}

.sk-line--label {
  width: 64px;
  height: 10px;
}

.sk-button {
  width: 88px;
  height: 32px;
  border-radius: var(--radius-md);
}

.sk-target {
  height: 76px;
  border-radius: var(--radius-md);
}

@media (prefers-reduced-motion: reduce) {
  .setup-skeleton :where(.sk-icon, .sk-line, .sk-button, .sk-target) {
    animation: none;
  }
}
</style>
