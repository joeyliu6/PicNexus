<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { GithubCdnConfig, ServiceType } from '../../config/types';
import { PRIVATE_SERVICES, PUBLIC_SERVICES } from '../../config/types';
import PrivateStorageGroup from './hosting/PrivateStorageGroup.vue';
import CookieServiceGroup from './hosting/CookieServiceGroup.vue';
import TokenServiceGroup from './hosting/TokenServiceGroup.vue';
import BuiltinServiceGroup from './hosting/BuiltinServiceGroup.vue';
import type { BatchTestProgress } from '../../types/batchTest';
import type { ServiceHealthStatus } from '../../types/serviceHealth';
import { useServiceHealth } from '../../composables/useServiceHealth';

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
  availableServices: ServiceType[];
  serviceConfigStatus: Record<ServiceType, boolean>;
}>();

const emit = defineEmits<{
  save: [];
  'update:availableServices': [services: ServiceType[]];
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
}>();

watch(() => props.targetCardId, (val) => {
  if (val) {
    nextTick(() => emit('cardNavigated'));
  }
});


const healthSummary = computed(() => {
  const counts: Record<ServiceHealthStatus, number> = { unconfigured: 0, pending: 0, verified: 0, error: 0 };
  for (const status of Object.values(healthStatusMap.value)) {
    counts[status as ServiceHealthStatus]++;
  }
  const hasConfigured = counts.pending > 0 || counts.verified > 0 || counts.error > 0;
  return { ...counts, hasConfigured };
});


const progressPercent = computed(() => {
  const p = props.batchTestProgress;
  if (!p || p.total === 0) return 0;
  return Math.round((p.current / p.total) * 100);
});

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

function getChipTooltip(svc: ServiceType): string | null {
  const status = healthStatusMap.value[svc];
  if (status === 'unconfigured') return '未配置，点击跳转到配置';
  return healthTooltipMap.value[svc] ?? null;
}

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
    <div class="group-title">
      <span>启用的服务</span>
    </div>
    <div class="service-enable-section">
      <!-- 摘要头部（原连接状态，移入卡片内） -->
      <div class="service-health-header" v-if="healthSummary.hasConfigured">
        <template v-if="isBatchTesting && batchTestProgress">
          <div class="health-checking-wrapper">
            <div class="health-checking">
              <div class="health-checking-info">
                <i class="pi" :class="progressPercent === 100 ? 'pi-check-circle health-complete-icon' : 'pi-spin pi-spinner health-spinner'"></i>
                <span class="health-progress">
                  {{ progressPercent === 100 ? '检测完成' : `正在检测… (${batchTestProgress.current}/${batchTestProgress.total}) ${batchTestProgress.currentService}` }}
                </span>
              </div>
              <div class="health-checking-right">
                <span class="health-percent" :class="{ 'health-percent-done': progressPercent === 100 }">{{ progressPercent }}%</span>
                <button v-if="progressPercent < 100" class="health-cancel" @click="emit('cancelBatchTest')" title="取消检测">
                  <i class="pi pi-times"></i>
                  取消
                </button>
              </div>
            </div>
            <div class="health-progress-bar">
              <div class="health-progress-fill" :class="{ complete: progressPercent === 100 }" :style="{ width: progressPercent + '%' }"></div>
            </div>
          </div>
        </template>
        <template v-else>
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
            <button class="health-refresh" @click="emit('testAll')">
              <i class="pi pi-refresh"></i>
              重新检测
            </button>
          </div>
        </template>
      </div>

      <div class="service-group-section">
        <div class="service-group-title">私有存储</div>
        <div class="service-toggles-grid">
          <div
            v-for="svc in PRIVATE_SERVICES"
            :key="svc"
            class="toggle-chip"
            :class="[healthStatusMap[svc], { 'is-filtered-out': activeFilter && healthStatusMap[svc] !== activeFilter }]"
            v-tooltip.top="getChipTooltip(svc)"
            @click="handleChipClick(svc)"
          >
            <span v-if="healthStatusMap[svc] === 'unconfigured'" class="toggle-empty-circle"></span>
            <button
              v-else
              class="toggle-indicator"
              :class="{ checked: localAvailableServices.includes(svc) }"
              :aria-pressed="localAvailableServices.includes(svc)"
              :aria-label="`${localAvailableServices.includes(svc) ? '禁用' : '启用'} ${serviceNames[svc]}`"
              @click.stop="toggleService(svc)"
            >
              <i v-if="localAvailableServices.includes(svc)" class="pi pi-check"></i>
            </button>
            <span class="toggle-label">{{ serviceNames[svc] }}</span>
          </div>
        </div>
      </div>

      <div class="service-group-section">
        <div class="service-group-title">公共图床</div>
        <div class="service-toggles-grid">
          <div
            v-for="svc in PUBLIC_SERVICES"
            :key="svc"
            class="toggle-chip"
            :class="[healthStatusMap[svc], { 'is-filtered-out': activeFilter && healthStatusMap[svc] !== activeFilter }]"
            v-tooltip.top="getChipTooltip(svc)"
            @click="handleChipClick(svc)"
          >
            <span v-if="healthStatusMap[svc] === 'unconfigured'" class="toggle-empty-circle"></span>
            <button
              v-else
              class="toggle-indicator"
              :class="{ checked: localAvailableServices.includes(svc) }"
              :aria-pressed="localAvailableServices.includes(svc)"
              :aria-label="`${localAvailableServices.includes(svc) ? '禁用' : '启用'} ${serviceNames[svc]}`"
              @click.stop="toggleService(svc)"
            >
              <i v-if="localAvailableServices.includes(svc)" class="pi pi-check"></i>
            </button>
            <span class="toggle-label">{{ serviceNames[svc] }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="settings-content">
      <div class="group-title">
        <span>私有存储</span>
      </div>
      <PrivateStorageGroup
        :private-form-data="privateFormData"
        :testing-connections="testingConnections"
        :health-status-map="healthStatusMap"
        :health-tooltip-map="healthTooltipMap"
        :target-card-id="targetCardId"
        @save="emit('save')"
        @test-private="emit('testPrivate', $event)"
      />

      <div class="group-title">
        <span>公共图床 · 免配置</span>
      </div>
      <BuiltinServiceGroup
        :jd-available="jdAvailable"
        :qiyu-available="qiyuAvailable"
        :is-checking-jd="isCheckingJd"
        :is-checking-qiyu="isCheckingQiyu"
        :health-tooltip-map="healthTooltipMap"
        :target-card-id="targetCardId"
        @check-builtin="emit('checkBuiltin', $event)"
      />

      <div class="group-title">
        <span>公共图床 · Cookie 登录</span>
      </div>
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

      <div class="group-title">
        <span>公共图床 · Token 授权</span>
      </div>
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
.hosting-settings-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.section-header {
  /* gap 控制间距，无需 margin */
}

.section-header h2 {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.section-desc {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
}

.service-health-header {
  margin-bottom: 14px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.health-row {
  display: flex;
  align-items: center;
  width: 100%;
}


.health-checking-wrapper {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.health-checking {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin-bottom: 8px;
}

.health-checking-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.health-spinner {
  font-size: 13px;
  color: var(--primary);
}

.health-progress {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}

.health-checking-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.health-percent {
  font-size: 12px;
  font-weight: 500;
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}

.health-progress-bar {
  width: 100%;
  height: 3px;
  background: var(--bg-input);
  border-radius: 2px;
  overflow: hidden;
}

.health-progress-fill {
  height: 100%;
  background: var(--primary);
  border-radius: 2px;
  transition: width 0.3s ease, background-color 0.3s ease;
}

.health-progress-fill.complete {
  background: var(--success);
}

.health-complete-icon {
  font-size: 13px;
  color: var(--success);
}

.health-percent-done {
  color: var(--success);
}

.pill-reveal {
  animation: pillFadeIn 0.3s ease both;
}

.health-stats .pill-reveal:nth-child(2) { animation-delay: 80ms; }
.health-stats .pill-reveal:nth-child(3) { animation-delay: 160ms; }
.health-stats .pill-reveal:nth-child(4) { animation-delay: 240ms; }


@keyframes pillFadeIn {
  from { opacity: 0; transform: translateY(4px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.health-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  flex-wrap: wrap;
}

.health-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s ease;
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
  border-radius: 50%;
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
  gap: 6px;
  background: none;
  border: none;
  color: var(--primary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 8px;
  transition: background-color 0.15s ease;
  white-space: nowrap;
}

.health-refresh:hover {
  background: var(--hover-overlay-subtle);
}

.health-refresh .pi {
  font-size: 12px;
}

.health-cancel {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  border: none;
  background: var(--hover-overlay-subtle);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.health-cancel:hover {
  background: color-mix(in srgb, var(--error) 15%, transparent);
  color: var(--error);
}

.health-cancel .pi {
  font-size: 10px;
}

.service-enable-section {
  padding: 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
}

.service-group-section {
  margin-bottom: 16px;
}

.service-group-section:last-child {
  margin-bottom: 0;
}

.service-group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.service-toggles-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.toggle-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: var(--hover-overlay-subtle);
  border: 1px solid var(--border-subtle-light);
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s;
}

.toggle-chip .toggle-label {
  font-size: 12px;
  color: var(--text-primary);
  white-space: nowrap;
}

/* 可用 - 淡绿底 */
.toggle-chip.verified {
  background: var(--success-alpha-8);
}
.toggle-chip.verified:hover {
  background: var(--success-alpha-15);
}

/* 未配置 - 明确弱化（安静的多数态） */
.toggle-chip.unconfigured {
  cursor: pointer;
  background: transparent;
  border-color: var(--hover-overlay-subtle);
}
.toggle-chip.unconfigured .toggle-label {
  opacity: 0.4;
}
.toggle-chip.unconfigured:hover {
  background: var(--primary-alpha-8);
  border-color: var(--hover-overlay);
}
.toggle-chip.unconfigured:hover .toggle-label {
  opacity: 0.7;
}

.toggle-indicator {
  width: 18px;
  height: 18px;
  padding: 0;
  background: none;
  border-radius: 50%;
  border: 1.5px solid var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s;
  opacity: 0.45;
}

.toggle-indicator .pi {
  font-size: 10px;
  color: var(--text-on-primary);
  display: none;
}

.toggle-indicator.checked {
  opacity: 1;
  border: none;
}

.toggle-indicator.checked .pi {
  display: block;
}

.toggle-chip.verified .toggle-indicator.checked {
  background: var(--success);
}

.toggle-chip.pending .toggle-indicator.checked {
  background: var(--pending);
}

.toggle-chip.error .toggle-indicator.checked {
  background: var(--error);
}

.toggle-indicator:hover {
  opacity: 0.8;
  border-color: var(--primary);
}

.toggle-indicator.checked:hover {
  filter: brightness(1.15);
}

.toggle-empty-circle {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1.5px solid var(--text-muted);
  opacity: 0.3;
  flex-shrink: 0;
  transition: all 0.2s;
}
.toggle-chip.unconfigured:hover .toggle-empty-circle {
  opacity: 0.5;
  border-color: var(--primary);
}

/* 未检测 - 淡紫底 */
.toggle-chip.pending {
  background: var(--pending-alpha-8);
}
.toggle-chip.pending:hover {
  background: var(--pending-alpha-15);
}

/* 有问题 - 淡红底 */
.toggle-chip.error {
  background: var(--error-alpha-8);
}
.toggle-chip.error:hover {
  background: var(--error-alpha-15);
}

/* 筛选时未匹配的药丸淡化 */
.toggle-chip.is-filtered-out {
  opacity: 0.15;
  pointer-events: none;
  transition: opacity 0.2s;
}

.settings-content {
  display: flex;
  flex-direction: column;
}

.group-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-top: 14px;
  margin-bottom: 14px;
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
  gap: 12px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.form-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-item.span-full {
  grid-column: 1 / -1;
}

.form-item label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.field-hint,
.form-hint {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
  margin-top: 2px;
}

.form-hint a {
  color: var(--primary);
  text-decoration: none;
  transition: color 0.15s ease;
}

.form-hint a:hover {
  text-decoration: underline;
}

.builtin-info {
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.builtin-info p {
  margin: 0;
}

.cookie-field {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-all;
}

@media (max-width: 768px) {
  .form-grid {
    grid-template-columns: 1fr;
  }

  .form-item.span-full {
    grid-column: 1;
  }
}
</style>
