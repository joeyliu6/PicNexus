<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ServiceType } from '../../../config/types';
import { PRIVATE_SERVICES, PUBLIC_SERVICES } from '../../../config/types';
import ServiceChipGrid from '../ServiceChipGrid.vue';
import type { BatchTestProgress } from '../../../types/batchTest';
import type { ServiceHealthStatus } from '../../../types/serviceHealth';
import { useHealthCheck } from '../../../composables/settings/useHealthCheck';

const props = defineProps<{
  healthStatusMap: Record<string, ServiceHealthStatus>;
  healthTooltipMap: Record<string, string | null>;
  isBatchTesting?: boolean;
  batchTestProgress?: BatchTestProgress | null;
  batchTestCompletionKey?: number;
  testingConnections: Record<string, boolean>;
  isCheckingJd: boolean;
  isCheckingQiyu: boolean;
  availableServices: string[];
  serviceNames: Record<string, string>;
}>();

const emit = defineEmits<{
  'update:availableServices': [services: string[]];
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
  progressPercent,
  ringOffset,
  isShowingCompleted,
  ringLabel,
  isStalled,
  batchTestedServices,
  batchDoneServices,
} = useHealthCheck({
  isBatchTesting: isBatchTestingRef,
  batchTestProgress: batchTestProgressRef,
  testingConnections: testingConnectionsRef,
});

// ==================== 健康摘要 ====================

const healthSummary = computed(() => {
  const counts: Record<ServiceHealthStatus, number> = { unconfigured: 0, pending: 0, verified: 0, error: 0 };
  for (const status of Object.values(props.healthStatusMap)) {
    counts[status as ServiceHealthStatus]++;
  }
  const hasConfigured = counts.pending > 0 || counts.verified > 0 || counts.error > 0;
  return { ...counts, hasConfigured };
});

// ==================== 服务启用切换 ====================

const localAvailableServices = computed({
  get: () => props.availableServices,
  set: (val) => emit('update:availableServices', val)
});

function toggleService(service: ServiceType) {
  const current = localAvailableServices.value;
  localAvailableServices.value = current.includes(service)
    ? current.filter(s => s !== service)
    : [...current, service];
  emit('save');
}

function handleChipClick(svc: ServiceType) {
  emit('scrollToService', svc);
}

// ==================== 筛选 ====================

const activeFilter = ref<ServiceHealthStatus | null>(null);

function toggleFilter(status: ServiceHealthStatus) {
  activeFilter.value = activeFilter.value === status ? null : status;
}
</script>

<template>
  <div class="form-group">
    <label class="group-label">启用的服务</label>
    <div class="service-enable-section">
      <!-- 摘要头部 -->
      <div class="service-health-header" v-if="healthSummary.hasConfigured">
        <div class="health-row">
          <div class="health-stats" :key="batchTestCompletionKey">
            <span v-if="healthSummary.verified > 0" class="health-pill verified pill-reveal" :class="{ active: activeFilter === 'verified' }" @click="toggleFilter('verified')">
              <span class="health-dot"></span>
              {{ healthSummary.verified }} 个正常
            </span>
            <span v-if="healthSummary.error > 0" class="health-pill error pill-reveal" :class="{ active: activeFilter === 'error' }" @click="toggleFilter('error')">
              <span class="health-dot"></span>
              {{ healthSummary.error }} 个异常
            </span>
            <span v-if="healthSummary.pending > 0" class="health-pill pending pill-reveal" :class="{ active: activeFilter === 'pending' }" @click="toggleFilter('pending')">
              <span class="health-dot"></span>
              {{ healthSummary.pending }} 个未检测
            </span>
            <span v-if="healthSummary.unconfigured > 0" class="health-pill unconfigured pill-reveal" :class="{ active: activeFilter === 'unconfigured' }" @click="toggleFilter('unconfigured')">
              <span class="health-dot"></span>
              {{ healthSummary.unconfigured }} 个未配置
            </span>
          </div>
          <button
            class="health-refresh"
            :class="{ 'is-testing': isBatchTesting || isShowingCompleted, 'is-completed': isShowingCompleted || (isBatchTesting && progressPercent >= 100) }"
            @click="isBatchTesting ? emit('cancelBatchTest') : emit('testAll')"
            :disabled="isCheckingQiyu || isCheckingJd"
          >
            <Transition name="icon-swap" mode="out-in">
              <i v-if="!isBatchTesting" key="refresh" class="pi pi-refresh"></i>
              <svg v-else key="ring"
                   :class="['ring-progress', { stalled: isStalled }]"
                   viewBox="0 0 24 24">
                <circle class="ring-bg" cx="12" cy="12" r="9"/>
                <circle class="ring-fill" cx="12" cy="12" r="9"
                        :style="{ strokeDashoffset: ringOffset }"/>
              </svg>
            </Transition>
            <span class="ring-label">{{ ringLabel }}</span>
          </button>
        </div>
      </div>

      <ServiceChipGrid
        :services="PRIVATE_SERVICES"
        group-title="私有存储"
        :health-status-map="healthStatusMap"
        :health-tooltip-map="healthTooltipMap"
        :available-services="localAvailableServices"
        :service-names="serviceNames"
        :is-batch-testing="!!isBatchTesting"
        :batch-tested-services="batchTestedServices"
        :batch-done-services="batchDoneServices"
        :active-filter="activeFilter"
        @toggle-service="toggleService"
        @chip-click="handleChipClick"
      />

      <ServiceChipGrid
        :services="PUBLIC_SERVICES"
        group-title="公共图床"
        :health-status-map="healthStatusMap"
        :health-tooltip-map="healthTooltipMap"
        :available-services="localAvailableServices"
        :service-names="serviceNames"
        :is-batch-testing="!!isBatchTesting"
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

.ring-progress {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  overflow: visible;
  transform-origin: center;
  vertical-align: -1.5px;
}

.ring-progress.stalled {
  animation: k-spin var(--duration-breathe) linear infinite;
}

.icon-swap-enter-active,
.icon-swap-leave-active {
  transition: opacity var(--duration-fast) ease, transform var(--duration-fast) ease;
}

.icon-swap-enter-from,
.icon-swap-leave-to {
  opacity: 0;
  transform: scale(0.7);
}

.ring-bg {
  fill: none;
  stroke: var(--border-subtle);
  stroke-width: 2.5;
}

.ring-fill {
  fill: none;
  stroke: var(--primary);
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-dasharray: 56.55;
  stroke-dashoffset: 56.55;
  transform: rotate(-90deg);
  transform-origin: 50% 50%;
  transition: stroke-dashoffset var(--duration-slow) ease;
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
  transition: background-color var(--duration-fast) ease;
  white-space: nowrap;
}

.health-refresh:hover {
  background: var(--hover-overlay-subtle);
}

.health-refresh .pi {
  font-size: var(--text-xs);
  line-height: 1;
}

.ring-label {
  transition: color var(--duration-medium) ease;
}

.health-refresh.is-testing:not(.is-completed) .ring-label {
  animation: k-pulse 2s ease-in-out infinite;
}

.health-refresh.is-completed {
  animation: k-bounce 0.4s ease-out;
}

.health-refresh.is-completed .ring-label {
  color: var(--success);
}

.health-refresh.is-completed .ring-fill {
  stroke: var(--success);
}
</style>
