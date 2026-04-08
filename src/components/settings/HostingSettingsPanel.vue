<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import Divider from 'primevue/divider';
import type { GithubCdnConfig, ServiceType, CustomS3Profile } from '../../config/types';
import { PRIVATE_SERVICES, PUBLIC_SERVICES } from '../../config/types';
import PrivateStorageGroup from './hosting/PrivateStorageGroup.vue';
import CookieServiceGroup from './hosting/CookieServiceGroup.vue';
import TokenServiceGroup from './hosting/TokenServiceGroup.vue';
import BuiltinServiceGroup from './hosting/BuiltinServiceGroup.vue';
import ServiceChipGrid from './ServiceChipGrid.vue';
import type { BatchTestProgress } from '../../types/batchTest';
import type { ServiceHealthStatus } from '../../types/serviceHealth';
import { useServiceHealth } from '../../composables/useServiceHealth';
import { useHealthCheck } from '../../composables/settings/useHealthCheck';

const { healthStatusMap, healthTooltipMap } = useServiceHealth();

interface PrivateFormData {
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucketName: string; path: string; publicDomain: string };
  tencent: { secretId: string; secretKey: string; region: string; bucket: string; path: string; publicDomain: string };
  aliyun: { accessKeyId: string; accessKeySecret: string; region: string; bucket: string; path: string; publicDomain: string };
  qiniu: { accessKey: string; secretKey: string; region: string; bucket: string; publicDomain: string; path: string };
  upyun: { operator: string; password: string; bucket: string; publicDomain: string; path: string };
}

interface CookieFormData {
  weibo: { cookie: string };
  zhihu: { cookie: string };
  nowcoder: { cookie: string };
  nami: { cookie: string };
  bilibili: { cookie: string };
  chaoxing: { cookie: string };
}

interface TokenFormData {
  smms: { token: string };
  github: {
    token: string;
    owner: string;
    repo: string;
    branch: string;
    path: string;
    cdnConfig?: GithubCdnConfig;
  };
  imgur: { clientId: string; clientSecret?: string };
}

const props = defineProps<{
  privateFormData: PrivateFormData;
  customS3Profiles: CustomS3Profile[];
  cookieFormData: CookieFormData;
  tokenFormData: TokenFormData;
  testingConnections: Record<string, boolean>;
  jdAvailable: boolean;
  qiyuAvailable: boolean;
  isCheckingJd: boolean;
  isCheckingQiyu: boolean;
  linkPrefixEnabled: boolean;
  prefixList: string[];
  selectedPrefixIndex: number;
  githubCdnConfig?: GithubCdnConfig;
  targetCardId?: string | null;
  isBatchTesting?: boolean;
  batchTestProgress?: BatchTestProgress | null;
  batchTestCompletionKey?: number;
  serviceNames: Record<string, string>;
  availableServices: string[];
  serviceConfigStatus: Record<ServiceType, boolean>;
}>();

const emit = defineEmits<{
  save: [];
  'update:availableServices': [services: string[]];
  testPrivate: [providerId: string];
  testToken: [providerId: string];
  testCookie: [providerId: string];
  checkBuiltin: [providerId: string];
  loginCookie: [providerId: string];
  'update:linkPrefixEnabled': [enabled: boolean];
  'update:prefixList': [list: string[]];
  'update:selectedPrefixIndex': [index: number];
  'update:githubCdnConfig': [config: GithubCdnConfig];
  addPrefix: [];
  removePrefix: [index: number];
  resetToDefault: [];
  cardNavigated: [];
  testAll: [];
  cancelBatchTest: [];
  scrollToService: [serviceId: string];
  addCustomS3: [];
  deleteCustomS3: [profileId: string];
  updateCustomS3: [profile: CustomS3Profile];
}>();

watch(() => props.targetCardId, (val) => {
  if (val) {
    nextTick(() => emit('cardNavigated'));
  }
});

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
  for (const status of Object.values(healthStatusMap.value)) {
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
  <div class="hosting-settings-panel">
    <div class="section-header">
      <h2>图床设置</h2>
      <p class="section-desc">勾选启用图床服务，点击服务名可跳转配置</p>
    </div>

    <!-- 启用的图床服务（整合连接状态） -->
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

    <Divider />

    <div class="form-group">
      <div class="group-header-row">
        <label class="group-label">私有存储</label>
        <button class="add-custom-s3-btn" @click="emit('addCustomS3')">
          <i class="pi pi-plus" style="font-size: var(--text-2xs-xs)"></i>
          <span>添加自定义 S3</span>
        </button>
      </div>

      <PrivateStorageGroup
        :private-form-data="privateFormData"
        :custom-s3-profiles="customS3Profiles"
        :testing-connections="testingConnections"
        :health-status-map="healthStatusMap"
        :health-tooltip-map="healthTooltipMap"
        :target-card-id="targetCardId"
        @save="emit('save')"
        @test-private="emit('testPrivate', $event)"
        @delete-custom-s3="emit('deleteCustomS3', $event)"
        @update-custom-s3="emit('updateCustomS3', $event)"
      />
    </div>

    <Divider />

    <div class="form-group">
      <label class="group-label">公共图床 · 免配置</label>
      <BuiltinServiceGroup
        :jd-available="jdAvailable"
        :qiyu-available="qiyuAvailable"
        :is-checking-jd="isCheckingJd"
        :is-checking-qiyu="isCheckingQiyu"
        :health-tooltip-map="healthTooltipMap"
        :target-card-id="targetCardId"
        @check-builtin="emit('checkBuiltin', $event)"
      />
    </div>

    <Divider />

    <div class="form-group">
      <label class="group-label">公共图床 · Cookie 登录</label>
      <CookieServiceGroup
        :cookie-form-data="cookieFormData"
        :testing-connections="testingConnections"
        :health-status-map="healthStatusMap"
        :health-tooltip-map="healthTooltipMap"
        :target-card-id="targetCardId"
        :link-prefix-enabled="linkPrefixEnabled"
        :prefix-list="prefixList"
        :selected-prefix-index="selectedPrefixIndex"
        @save="emit('save')"
        @test-cookie="emit('testCookie', $event)"
        @login-cookie="emit('loginCookie', $event)"
        @update:link-prefix-enabled="emit('update:linkPrefixEnabled', $event)"
        @update:prefix-list="emit('update:prefixList', $event)"
        @update:selected-prefix-index="emit('update:selectedPrefixIndex', $event)"
        @add-prefix="emit('addPrefix')"
        @remove-prefix="emit('removePrefix', $event)"
        @reset-to-default="emit('resetToDefault')"
      />
    </div>

    <Divider />

    <div class="form-group">
      <label class="group-label">公共图床 · Token 授权</label>
      <TokenServiceGroup
        :token-form-data="tokenFormData"
        :testing-connections="testingConnections"
        :health-status-map="healthStatusMap"
        :health-tooltip-map="healthTooltipMap"
        :target-card-id="targetCardId"
        :github-cdn-config="githubCdnConfig"
        @save="emit('save')"
        @test-token="emit('testToken', $event)"
        @update:github-cdn-config="emit('update:githubCdnConfig', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
@import '../../styles/settings-shared.css';

.hosting-settings-panel {
  width: 100%;
}

.group-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-sm-md);
}

.group-header-row .group-label {
  margin-bottom: 0;
}

.add-custom-s3-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm-md);
  background: none;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm-md);
  color: var(--text-muted);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: all var(--duration-fast) ease;
}

.add-custom-s3-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-alpha-8);
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
  font-weight: 500;
  transition: all var(--duration-fast) ease;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}

.health-pill.active {
  outline: 2px solid currentColor;
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
  font-weight: 500;
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

.service-enable-section {
  padding: var(--space-md-lg);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm-md);
}

.category-icon {
  width: 16px;
  height: 16px;
  color: var(--primary);
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.provider-grid {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.builtin-info {
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.builtin-info p {
  margin: 0;
}

.cookie-field {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.5;
  word-break: break-all;
}
</style>
