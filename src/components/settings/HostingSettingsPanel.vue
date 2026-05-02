<script setup lang="ts">
import { watch, nextTick } from 'vue';
import Divider from 'primevue/divider';
import type { GithubCdnConfig, ServiceType, CustomS3Profile, LinkPrefixItem } from '../../config/types';
import PrivateStorageGroup from './hosting/PrivateStorageGroup.vue';
import CookieServiceGroup from './hosting/CookieServiceGroup.vue';
import TokenServiceGroup from './hosting/TokenServiceGroup.vue';
import BuiltinServiceGroup from './hosting/BuiltinServiceGroup.vue';
import ServiceEnableSection from './hosting/ServiceEnableSection.vue';
import type { BatchTestProgress } from '../../types/batchTest';
import { useServiceHealth } from '../../composables/useServiceHealth';
import type { ServiceCheckSession } from '../../types/serviceCheck';

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
  zhihu: { cookie: string; sourceParamEnabled?: boolean; sourceParamValue?: string };
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
  prefixList: LinkPrefixItem[];
  selectedPrefixIndex: number;
  githubCdnConfig?: GithubCdnConfig;
  targetCardId?: string | null;
  isBatchTesting?: boolean;
  batchTestProgress?: BatchTestProgress | null;
  batchTestCompletionKey?: number;
  serviceCheckSession?: ServiceCheckSession | null;
  refreshingServiceIds: Set<string>;
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
  'update:selectedPrefixIndex': [index: number];
  'update:githubCdnConfig': [config: GithubCdnConfig];
  addPrefix: [item: LinkPrefixItem];
  updatePrefix: [payload: { index: number; item: LinkPrefixItem }];
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
}, { immediate: true });
</script>

<template>
  <div class="hosting-settings-panel">
    <div class="section-header">
      <h2>图床设置</h2>
      <p class="section-desc">勾选启用图床服务，点击服务名可跳转配置</p>
    </div>

    <!-- 启用的图床服务（整合连接状态） -->
    <ServiceEnableSection
      :health-status-map="healthStatusMap"
      :health-tooltip-map="healthTooltipMap"
      :is-batch-testing="isBatchTesting"
      :batch-test-progress="batchTestProgress"
      :batch-test-completion-key="batchTestCompletionKey"
      :service-check-session="serviceCheckSession"
      :refreshing-service-ids="refreshingServiceIds"
      :testing-connections="testingConnections"
      :is-checking-jd="isCheckingJd"
      :is-checking-qiyu="isCheckingQiyu"
      :available-services="availableServices"
      :service-names="serviceNames"
      @update:available-services="emit('update:availableServices', $event)"
      @save="emit('save')"
      @test-all="emit('testAll')"
      @cancel-batch-test="emit('cancelBatchTest')"
      @scroll-to-service="emit('scrollToService', $event)"
    />

    <Divider />

    <div class="form-group">
      <div class="group-header-row">
        <label class="group-label">私有存储</label>
        <button class="add-custom-s3-btn" @click="emit('addCustomS3')">
          <i class="pi pi-plus" style="font-size: var(--text-xs)"></i>
          <span>添加自定义 S3</span>
        </button>
      </div>

      <PrivateStorageGroup
        :private-form-data="privateFormData"
        :custom-s3-profiles="customS3Profiles"
        :testing-connections="testingConnections"
        :health-status-map="healthStatusMap"
        :health-tooltip-map="healthTooltipMap"
        :refreshing-service-ids="refreshingServiceIds"
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
        :refreshing-service-ids="refreshingServiceIds"
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
        :refreshing-service-ids="refreshingServiceIds"
        :target-card-id="targetCardId"
        :link-prefix-enabled="linkPrefixEnabled"
        :prefix-list="prefixList"
        :selected-prefix-index="selectedPrefixIndex"
        @save="emit('save')"
        @test-cookie="emit('testCookie', $event)"
        @login-cookie="emit('loginCookie', $event)"
        @update:link-prefix-enabled="emit('update:linkPrefixEnabled', $event)"
        @update:selected-prefix-index="emit('update:selectedPrefixIndex', $event)"
        @add-prefix="emit('addPrefix', $event)"
        @update-prefix="emit('updatePrefix', $event)"
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
        :refreshing-service-ids="refreshingServiceIds"
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
@import url('../../styles/settings-shared.css');

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
