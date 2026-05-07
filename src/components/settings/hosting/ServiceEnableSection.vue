<script setup lang="ts">
import { ref, computed } from 'vue';
import type { CustomS3Profile } from '../../../config/types';
import { PRIVATE_SERVICES, PUBLIC_SERVICES, PUBLIC_SERVICE_RISK_TOOLTIP, isPublicRiskService, makeCustomS3Id } from '../../../config/types';
import ServiceChipGrid from '../ServiceChipGrid.vue';
import type { BatchTestProgress } from '../../../types/batchTest';
import type { ServiceHealthStatus } from '../../../types/serviceHealth';
import { useHealthCheck } from '../../../composables/settings/useHealthCheck';
import type { ServiceCheckSession } from '../../../types/serviceCheck';
import { useToast } from '../../../composables/useToast';
import { useConfirm } from '../../../composables/useConfirm';

const props = defineProps<{
  healthStatusMap: Record<string, ServiceHealthStatus>;
  healthTooltipMap: Record<string, string | null>;
  isBatchTesting?: boolean;
  batchTestProgress?: BatchTestProgress | null;
  batchTestCompletionKey?: number;
  serviceCheckSession?: ServiceCheckSession | null;
  refreshingServiceIds: Set<string>;
  testingConnections: Record<string, boolean>;
  isCheckingJd: boolean;
  isCheckingQiyu: boolean;
  availableServices: string[];
  serviceNames: Record<string, string>;
  customS3Profiles?: CustomS3Profile[];
  publicServiceRiskAccepted: boolean;
}>();

const emit = defineEmits<{
  'update:availableServices': [services: string[]];
  'accept-public-service-risk': [];
  save: [];
  testAll: [];
  cancelBatchTest: [];
  scrollToService: [serviceId: string];
}>();

// ==================== 健康检测 composable ====================

const isBatchTestingRef = computed(() => !!props.isBatchTesting);
const batchTestProgressRef = computed(() => props.batchTestProgress ?? null);
const testingConnectionsRef = computed(() => props.testingConnections);

const {
  isRingCompleted,
  ringLabel,
  batchTestedServices,
  batchDoneServices,
} = useHealthCheck({
  isBatchTesting: isBatchTestingRef,
  batchTestProgress: batchTestProgressRef,
  testingConnections: testingConnectionsRef,
});

type HealthRefreshState = 'done' | 'testing' | 'idle';

const healthRefreshState = computed<HealthRefreshState>(() => {
  if (isRingCompleted.value) return 'done';
  if (props.isBatchTesting) return 'testing';
  return 'idle';
});

const healthRefreshIconClass = computed(() => {
  switch (healthRefreshState.value) {
    case 'done': return 'pi pi-check';
    case 'testing': return 'pi pi-sync is-spinning';
    default: return 'pi pi-sync';
  }
});

// ==================== 健康摘要 ====================

const healthSummary = computed(() => {
  const counts: Record<ServiceHealthStatus, number> = { unconfigured: 0, pending: 0, verified: 0, error: 0 };
  const session = props.serviceCheckSession;

  if (!session) {
    for (const status of Object.values(props.healthStatusMap)) {
      counts[status as ServiceHealthStatus]++;
    }

    const hasConfigured = counts.pending > 0 || counts.verified > 0 || counts.error > 0;
    return {
      ...counts,
      hasConfigured,
      refreshingConfigured: false,
      snapshot: {
        verified: `${counts.verified} 个正常`,
        error: `${counts.error} 个异常`,
        pending: `${counts.pending} 个未检测`,
        unconfigured: `${counts.unconfigured} 个未配置`,
      },
    };
  }

  for (const status of Object.values(props.healthStatusMap)) {
    counts[status as ServiceHealthStatus]++;
  }

  const hasConfigured = counts.pending > 0
    || counts.verified > 0
    || counts.error > 0
    || session.targetIds.length > 0;

  return {
    ...counts,
    hasConfigured,
    refreshingConfigured: true,
    snapshot: session.summarySnapshot,
  };
});

// ==================== 服务启用切换 ====================

const localAvailableServices = computed({
  get: () => props.availableServices,
  set: (val) => emit('update:availableServices', val)
});

const toast = useToast();
const { confirm: confirmDialog } = useConfirm();

const customS3ServiceIds = computed(() => (props.customS3Profiles ?? []).map(profile => makeCustomS3Id(profile.id)));
const privateServiceIds = computed<string[]>(() => [...PRIVATE_SERVICES, ...customS3ServiceIds.value]);

const serviceNamesWithCustom = computed<Record<string, string>>(() => {
  const names: Record<string, string> = { ...props.serviceNames };
  for (const profile of props.customS3Profiles ?? []) {
    names[makeCustomS3Id(profile.id)] = profile.name || '自定义 S3';
  }
  return names;
});

async function toggleService(service: string) {
  const current = localAvailableServices.value;
  const isRemoving = current.includes(service);
  // Why: useConfig.saveConfig 会在 availableServices 为空时拒绝保存并 toast,
  //   但 UI 状态已先变空产生闪烁，也容易触发上传空图床路径。这里在 UI 层直接拦截。
  if (isRemoving && current.length <= 1) {
    toast.showConfig('warn', {
      summary: '至少保留一个图床',
      detail: '启用的图床不能全部关闭，请先启用另一个再关闭当前服务。',
      life: 3000,
    });
    return;
  }

  if (!isRemoving && isPublicRiskService(service) && !props.publicServiceRiskAccepted) {
    const serviceName = serviceNamesWithCustom.value[service] ?? service;
    const confirmed = await confirmDialog(
      `「${serviceName}」属于非官方公共图床/第三方平台适配，可能违反平台规则、随时失效，账号或数据风险由你自行承担。确认已了解并继续启用？`,
      {
        header: '公共图床风险确认',
        acceptLabel: '我已了解并继续',
        rejectLabel: '取消',
        acceptClass: 'p-button-warning',
      },
    );
    if (!confirmed) return;
    emit('accept-public-service-risk');
  }

  localAvailableServices.value = isRemoving
    ? current.filter(s => s !== service)
    : [...current, service];
  emit('save');
}

function handleChipClick(svc: string) {
  emit('scrollToService', svc);
}

// ==================== 筛选 ====================

const activeFilter = ref<ServiceHealthStatus | null>(null);

function toggleFilter(status: ServiceHealthStatus) {
  activeFilter.value = activeFilter.value === status ? null : status;
}

// 顶部骨架 pill 集合：严格跟随 session 启动时的 count 快照，保证刷新前/中/后 pill 数量一致
const skeletonStatuses = computed<ServiceHealthStatus[]>(() => {
  return props.serviceCheckSession?.summarySkeletonStatuses ?? [];
});
</script>

<template>
  <div class="form-group">
    <label class="group-label">启用的服务</label>
    <div class="service-enable-section">
      <!-- 摘要头部 -->
      <div class="service-health-header" v-if="healthSummary.hasConfigured">
        <div class="health-row">
          <div class="health-stats" :key="batchTestCompletionKey">
            <template v-if="healthSummary.refreshingConfigured">
              <span
                v-for="status in skeletonStatuses"
                :key="status"
                class="health-pill health-pill--refreshing"
              >
                <span class="health-dot"></span>
                <span class="health-pill-text">{{ healthSummary.snapshot[status] }}</span>
              </span>
            </template>
            <template v-else>
              <span v-if="healthSummary.verified > 0" class="health-pill verified pill-reveal" :class="{ active: activeFilter === 'verified' }" @click="toggleFilter('verified')">
                <span class="health-dot"></span>
                <span class="health-pill-text">{{ healthSummary.verified }} 个正常</span>
              </span>
              <span v-if="healthSummary.error > 0" class="health-pill error pill-reveal" :class="{ active: activeFilter === 'error' }" @click="toggleFilter('error')">
                <span class="health-dot"></span>
                <span class="health-pill-text">{{ healthSummary.error }} 个异常</span>
              </span>
              <span v-if="healthSummary.pending > 0" class="health-pill pending pill-reveal" :class="{ active: activeFilter === 'pending' }" @click="toggleFilter('pending')">
                <span class="health-dot"></span>
                <span class="health-pill-text">{{ healthSummary.pending }} 个未检测</span>
              </span>
              <span v-if="healthSummary.unconfigured > 0" class="health-pill unconfigured pill-reveal" :class="{ active: activeFilter === 'unconfigured' }" @click="toggleFilter('unconfigured')">
                <span class="health-dot"></span>
                <span class="health-pill-text">{{ healthSummary.unconfigured }} 个未配置</span>
              </span>
            </template>
          </div>
          <button
            class="health-refresh"
            :class="{
              'is-testing': healthRefreshState === 'testing',
              'is-completed': healthRefreshState === 'done',
            }"
            @click="isBatchTesting ? emit('cancelBatchTest') : emit('testAll')"
            :disabled="isCheckingJd || isCheckingQiyu || serviceCheckSession?.mode === 'single'"
          >
            <Transition name="icon-swap" mode="out-in">
              <span :key="healthRefreshState" class="health-refresh-content">
                <i :class="healthRefreshIconClass"></i>
                <span class="ring-label">{{ ringLabel }}</span>
              </span>
            </Transition>
          </button>
        </div>
      </div>

      <ServiceChipGrid
        :services="privateServiceIds"
        group-title="私有存储"
        :health-status-map="healthStatusMap"
        :health-tooltip-map="healthTooltipMap"
        :available-services="localAvailableServices"
        :service-names="serviceNamesWithCustom"
        :is-batch-testing="!!isBatchTesting"
        :refreshing-service-ids="refreshingServiceIds"
        :batch-tested-services="batchTestedServices"
        :batch-done-services="batchDoneServices"
        :active-filter="activeFilter"
        @toggle-service="toggleService"
        @chip-click="handleChipClick"
      />

      <ServiceChipGrid
        :services="PUBLIC_SERVICES"
        group-title="公共图床"
        :group-tooltip="PUBLIC_SERVICE_RISK_TOOLTIP"
        :health-status-map="healthStatusMap"
        :health-tooltip-map="healthTooltipMap"
        :available-services="localAvailableServices"
        :service-names="serviceNamesWithCustom"
        :is-batch-testing="!!isBatchTesting"
        :refreshing-service-ids="refreshingServiceIds"
        :batch-tested-services="batchTestedServices"
        :batch-done-services="batchDoneServices"
        :active-filter="activeFilter"
        @toggle-service="toggleService"
        @chip-click="handleChipClick"
      />
    </div>
  </div>
</template>

<style scoped>
@import url('../../../styles/settings-shared.css');

.service-enable-section {
  padding: var(--space-md-lg);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm-md);
}

.service-health-header {
  margin-bottom: var(--space-md-lg);
  padding-bottom: var(--space-md-lg);
  border-bottom: 1px solid var(--border-subtle);
}

.health-row {
  display: flex;
  align-items: center;
  width: 100%;
}

.icon-swap-enter-active,
.icon-swap-leave-active {
  transition: opacity var(--duration-fast) ease;
}

.icon-swap-enter-from,
.icon-swap-leave-to {
  opacity: 0;
}

.pill-reveal {
  animation: k-fade-scale var(--duration-medium) ease both;
}

.health-stats .pill-reveal:nth-child(2) { animation-delay: 80ms; }
.health-stats .pill-reveal:nth-child(3) { animation-delay: 160ms; }
.health-stats .pill-reveal:nth-child(4) { animation-delay: 240ms; }

.health-stats {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex: 1;
  flex-wrap: wrap;
}

.health-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs-sm);
  padding: var(--space-xs) var(--space-md);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  transition: all var(--duration-fast) ease;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}

.health-pill-text {
  display: inline-block;
  position: relative;
}

/* 刷新态 pill 外壳透明，只让内部 dot + text shimmer 浮出，视觉最轻 */
.health-pill--refreshing {
  background: transparent;
  color: transparent;
  cursor: default;
  pointer-events: none;
}

/* shimmer 配方与链接检测/批量迁移保持一致：border-subtle-light ↔ bg-card 对比度更强 */
.health-pill--refreshing .health-dot {
  background: linear-gradient(
    90deg,
    var(--border-subtle-light) 25%,
    var(--bg-card) 50%,
    var(--border-subtle-light) 75%
  );
  background-size: 200% 100%;
  box-shadow: none;
  animation: k-shimmer var(--duration-shimmer) ease-in-out infinite;
}

.health-pill--refreshing .health-pill-text {
  color: transparent;
}

.health-pill--refreshing .health-pill-text::before {
  content: '';
  position: absolute;
  inset: 50% 0 auto;
  height: 12px;
  transform: translateY(-50%);
  border-radius: var(--radius-full);
  background: linear-gradient(
    90deg,
    var(--border-subtle-light) 25%,
    var(--bg-card) 50%,
    var(--border-subtle-light) 75%
  );
  background-size: 200% 100%;
  animation: k-shimmer var(--duration-shimmer) ease-in-out infinite;
}

.health-pill.active {
  outline: 2px solid currentcolor;
  outline-offset: 1px;
}

.health-pill .health-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.health-pill.verified {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  color: var(--success);
}

.health-pill.verified .health-dot {
  background: var(--success);
}

.health-pill.error {
  background: color-mix(in srgb, var(--error) 12%, transparent);
  color: var(--error);
}

.health-pill.error .health-dot {
  background: var(--error);
}

.health-pill.pending {
  background: color-mix(in srgb, var(--pending) 12%, transparent);
  color: var(--pending);
}

.health-pill.pending .health-dot {
  background: var(--pending);
}

.health-pill.unconfigured {
  background: color-mix(in srgb, var(--text-muted) 10%, transparent);
  color: var(--text-muted);
}

.health-pill.unconfigured .health-dot {
  background: var(--text-muted);
  opacity: 0.5;
}

.health-refresh {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs-sm);
  background: none;
  border: none;
  color: var(--primary);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
  padding: var(--space-xs-sm) var(--space-md);
  border-radius: var(--radius-md);
  transition: background-color var(--duration-fast) ease, color var(--duration-fast) ease;
  white-space: nowrap;
}

.health-refresh:hover {
  background: var(--hover-overlay-subtle);
}

.health-refresh-content {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs-sm);
}

.health-refresh .pi {
  font-size: var(--text-xs);
  line-height: 1;
}

.health-refresh .pi.is-spinning {
  animation: k-spin var(--duration-breathe) linear infinite;
}

.ring-label {
  transition: color var(--duration-fast) ease;
}

/* 完成态：整按钮 color 切成 success，图标和文字一起变绿 */
.health-refresh.is-completed {
  color: var(--success);
  animation: k-bounce var(--duration-slow) ease-out;
}
</style>
