<script setup lang="ts">
import { computed, watch, nextTick } from 'vue';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import Textarea from 'primevue/textarea';
import Button from 'primevue/button';
import HostingCard from './HostingCard.vue';
import WeiboLinkPrefixSection from './hosting/WeiboLinkPrefixSection.vue';
import GithubUrlStrategySection from './hosting/GithubUrlStrategySection.vue';
import { getCategoryIcon } from '../../utils/icons';
import type { GithubUrlStrategy } from '../../config/types';
import type { BatchTestProgress, BatchTestReport } from '../../types/batchTest';
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
    urlStrategy?: GithubUrlStrategy;
  };
  imgur: { clientId: string; clientSecret?: string };
}

type PrivateProviderId = keyof PrivateFormData;
type CookieProviderId = keyof CookieFormData;
type TokenProviderId = keyof TokenFormData;

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
  githubUrlStrategy?: GithubUrlStrategy;
  targetCardId?: string | null;
  isBatchTesting?: boolean;
  batchTestProgress?: BatchTestProgress | null;
  batchTestReport?: BatchTestReport | null;
}>();

const emit = defineEmits<{
  save: [];
  testPrivate: [providerId: string];
  testToken: [providerId: string];
  testCookie: [providerId: string];
  checkBuiltin: [providerId: string];
  loginCookie: [providerId: string];
  'update:linkPrefixEnabled': [enabled: boolean];
  'update:prefixList': [list: string[]];
  'update:selectedPrefixIndex': [index: number];
  'update:githubUrlStrategy': [strategy: GithubUrlStrategy];
  addPrefix: [];
  removePrefix: [index: number];
  resetToDefault: [];
  cardNavigated: [];
  testAll: [];
}>();

function isTargetCard(id: string): boolean {
  return props.targetCardId === id;
}

watch(() => props.targetCardId, (val) => {
  if (val) {
    nextTick(() => emit('cardNavigated'));
  }
});

function isPrivateConfigured(providerId: PrivateProviderId): boolean {
  const data = props.privateFormData;
  switch (providerId) {
    case 'r2':
      return !!(data.r2.accountId && data.r2.accessKeyId && data.r2.secretAccessKey && data.r2.bucketName && data.r2.publicDomain);
    case 'tencent':
      return !!(data.tencent.secretId && data.tencent.secretKey && data.tencent.region && data.tencent.bucket && data.tencent.publicDomain);
    case 'aliyun':
      return !!(data.aliyun.accessKeyId && data.aliyun.accessKeySecret && data.aliyun.region && data.aliyun.bucket && data.aliyun.publicDomain);
    case 'qiniu':
      return !!(data.qiniu.accessKey && data.qiniu.secretKey && data.qiniu.region && data.qiniu.bucket && data.qiniu.publicDomain);
    case 'upyun':
      return !!(data.upyun.operator && data.upyun.password && data.upyun.bucket && data.upyun.publicDomain);
    default:
      return false;
  }
}

function isCookieConfigured(providerId: CookieProviderId): boolean {
  return !!props.cookieFormData[providerId].cookie?.trim();
}

function isTokenConfigured(providerId: TokenProviderId): boolean {
  const data = props.tokenFormData;
  switch (providerId) {
    case 'smms':
      return !!data.smms.token?.trim();
    case 'github':
      return !!(data.github.token?.trim() && data.github.owner?.trim() && data.github.repo?.trim());
    case 'imgur':
      return !!data.imgur.clientId?.trim();
    default:
      return false;
  }
}

const extractNamiAuthToken = computed(() => {
  return props.cookieFormData.nami.cookie?.match(/auth-token=([^;]+)/)?.[1] || '';
});

const MAX_ERROR_LENGTH = 40;
function truncateError(error: string): string {
  return error.length > MAX_ERROR_LENGTH ? error.slice(0, MAX_ERROR_LENGTH) + '...' : error;
}
</script>

<template>
  <div class="hosting-settings-panel">
    <div class="section-header">
      <h2>图床设置</h2>
      <p class="section-desc">根据认证方式和使用场景选择合适的图床服务</p>
    </div>

    <div class="batch-test-bar">
      <Button
        :label="isBatchTesting ? `正在测试 ${batchTestProgress?.current ?? 0}/${batchTestProgress?.total ?? 0}...` : '测试所有图床'"
        :icon="isBatchTesting ? 'pi pi-spin pi-spinner' : 'pi pi-play'"
        :disabled="isBatchTesting"
        severity="secondary"
        size="small"
        outlined
        @click="emit('testAll')"
      />
      <div v-if="batchTestReport && !isBatchTesting" class="batch-report">
        <span :class="['report-summary', batchTestReport.failed.length === 0 ? 'all-pass' : batchTestReport.passed === 0 ? 'all-fail' : 'has-fail']">
          {{ batchTestReport.passed }}/{{ batchTestReport.total }} 通过
        </span>
        <div v-if="batchTestReport.failed.length > 0" class="report-failures">
          <div v-for="item in batchTestReport.failed" :key="item.serviceId" class="failure-item" v-tooltip.bottom="item.error">
            <span class="failure-name">{{ item.name }}</span>
            <span class="failure-error">{{ truncateError(item.error) }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="settings-content">
      <div class="group-title">
        <span class="category-icon" v-html="getCategoryIcon('private-storage')"></span>
        <span>私有存储</span>
      </div>
      <div class="provider-grid">
        <HostingCard
          id="r2"
          :force-expand="isTargetCard('r2')"
          name="Cloudflare R2"
          description="S3 兼容的高速存储"
          :isConfigured="isPrivateConfigured('r2')"
          :health-status="healthStatusMap['r2']"
          :health-tooltip="healthTooltipMap['r2']"
          :isTesting="testingConnections['r2']"
          @test="emit('testPrivate', $event)"
        >
          <div class="form-grid">
            <div class="form-item">
              <label>Account ID</label>
              <InputText v-model="privateFormData.r2.accountId" @blur="emit('save')" class="w-full" />
            </div>
            <div class="form-item">
              <label>Bucket Name</label>
              <InputText v-model="privateFormData.r2.bucketName" @blur="emit('save')" class="w-full" />
            </div>
            <div class="form-item">
              <label>Access Key ID</label>
              <Password v-model="privateFormData.r2.accessKeyId" @blur="emit('save')" :feedback="false" toggleMask fluid placeholder="输入 Access Key ID" />
            </div>
            <div class="form-item">
              <label>Secret Access Key</label>
              <Password v-model="privateFormData.r2.secretAccessKey" @blur="emit('save')" :feedback="false" toggleMask fluid placeholder="输入 Secret Access Key" />
            </div>
            <div class="form-item span-full">
              <label>自定义路径 (Optional)</label>
              <InputText v-model="privateFormData.r2.path" @blur="emit('save')" placeholder="e.g. blog/images/" class="w-full" />
            </div>
            <div class="form-item span-full">
              <label>公开访问域名 (Public Domain)</label>
              <InputText v-model="privateFormData.r2.publicDomain" @blur="emit('save')" placeholder="https://images.example.com" class="w-full" />
            </div>
          </div>
        </HostingCard>

        <HostingCard
          id="tencent"
          :force-expand="isTargetCard('tencent')"
          name="腾讯云"
          description="腾讯云对象存储"
          :isConfigured="isPrivateConfigured('tencent')"
          :health-status="healthStatusMap['tencent']"
          :health-tooltip="healthTooltipMap['tencent']"
          :isTesting="testingConnections['tencent']"
          @test="emit('testPrivate', $event)"
        >
          <div class="form-grid">
            <div class="form-item">
              <label>Secret ID</label>
              <Password v-model="privateFormData.tencent.secretId" @blur="emit('save')" :feedback="false" toggleMask fluid placeholder="输入 SecretId" />
            </div>
            <div class="form-item">
              <label>Secret Key</label>
              <Password v-model="privateFormData.tencent.secretKey" @blur="emit('save')" :feedback="false" toggleMask fluid placeholder="输入 SecretKey" />
            </div>
            <div class="form-item">
              <label>地域 (Region)</label>
              <InputText v-model="privateFormData.tencent.region" @blur="emit('save')" placeholder="ap-guangzhou" class="w-full" />
            </div>
            <div class="form-item">
              <label>存储桶 (Bucket)</label>
              <InputText v-model="privateFormData.tencent.bucket" @blur="emit('save')" class="w-full" />
            </div>
            <div class="form-item span-full">
              <label>自定义路径 (Optional)</label>
              <InputText v-model="privateFormData.tencent.path" @blur="emit('save')" placeholder="e.g. blog/images/" class="w-full" />
            </div>
            <div class="form-item span-full">
              <label>公开访问域名 (Public Domain)</label>
              <InputText v-model="privateFormData.tencent.publicDomain" @blur="emit('save')" placeholder="https://images.example.com" class="w-full" />
            </div>
          </div>
        </HostingCard>

        <HostingCard
          id="aliyun"
          :force-expand="isTargetCard('aliyun')"
          name="阿里云"
          description="阿里云对象存储"
          :isConfigured="isPrivateConfigured('aliyun')"
          :health-status="healthStatusMap['aliyun']"
          :health-tooltip="healthTooltipMap['aliyun']"
          :isTesting="testingConnections['aliyun']"
          @test="emit('testPrivate', $event)"
        >
          <div class="form-grid">
            <div class="form-item">
              <label>Access Key ID</label>
              <Password v-model="privateFormData.aliyun.accessKeyId" @blur="emit('save')" :feedback="false" toggleMask fluid placeholder="输入 AccessKey ID" />
            </div>
            <div class="form-item">
              <label>Access Key Secret</label>
              <Password v-model="privateFormData.aliyun.accessKeySecret" @blur="emit('save')" :feedback="false" toggleMask fluid placeholder="输入 AccessKey Secret" />
            </div>
            <div class="form-item">
              <label>地域 (Region)</label>
              <InputText v-model="privateFormData.aliyun.region" @blur="emit('save')" placeholder="oss-cn-hangzhou" class="w-full" />
            </div>
            <div class="form-item">
              <label>存储桶 (Bucket)</label>
              <InputText v-model="privateFormData.aliyun.bucket" @blur="emit('save')" class="w-full" />
            </div>
            <div class="form-item span-full">
              <label>自定义路径 (Optional)</label>
              <InputText v-model="privateFormData.aliyun.path" @blur="emit('save')" placeholder="e.g. blog/images/" class="w-full" />
            </div>
            <div class="form-item span-full">
              <label>公开访问域名 (Public Domain)</label>
              <InputText v-model="privateFormData.aliyun.publicDomain" @blur="emit('save')" placeholder="https://images.example.com" class="w-full" />
            </div>
          </div>
        </HostingCard>

        <HostingCard
          id="qiniu"
          :force-expand="isTargetCard('qiniu')"
          name="七牛云"
          description="七牛云对象存储"
          :isConfigured="isPrivateConfigured('qiniu')"
          :health-status="healthStatusMap['qiniu']"
          :health-tooltip="healthTooltipMap['qiniu']"
          :isTesting="testingConnections['qiniu']"
          @test="emit('testPrivate', $event)"
        >
          <div class="form-grid">
            <div class="form-item">
              <label>Access Key (AK)</label>
              <Password v-model="privateFormData.qiniu.accessKey" @blur="emit('save')" :feedback="false" toggleMask fluid placeholder="输入 Access Key" />
            </div>
            <div class="form-item">
              <label>Secret Key (SK)</label>
              <Password v-model="privateFormData.qiniu.secretKey" @blur="emit('save')" :feedback="false" toggleMask fluid placeholder="输入 Secret Key" />
            </div>
            <div class="form-item">
              <label>地域 (Region)</label>
              <InputText v-model="privateFormData.qiniu.region" @blur="emit('save')" placeholder="cn-east-1" class="w-full" />
              <small class="field-hint">七牛云区域代码，如 cn-east-1、cn-south-1 等</small>
            </div>
            <div class="form-item">
              <label>存储桶 (Bucket)</label>
              <InputText v-model="privateFormData.qiniu.bucket" @blur="emit('save')" class="w-full" />
            </div>
            <div class="form-item span-full">
              <label>公开访问域名 (Public Domain)</label>
              <InputText v-model="privateFormData.qiniu.publicDomain" @blur="emit('save')" placeholder="https://images.example.com" class="w-full" />
            </div>
            <div class="form-item span-full">
              <label>自定义路径 (Optional)</label>
              <InputText v-model="privateFormData.qiniu.path" @blur="emit('save')" placeholder="e.g. blog/images/" class="w-full" />
            </div>
          </div>
        </HostingCard>

        <HostingCard
          id="upyun"
          :force-expand="isTargetCard('upyun')"
          name="又拍云"
          description="又拍云对象存储"
          :isConfigured="isPrivateConfigured('upyun')"
          :health-status="healthStatusMap['upyun']"
          :health-tooltip="healthTooltipMap['upyun']"
          :isTesting="testingConnections['upyun']"
          @test="emit('testPrivate', $event)"
        >
          <div class="form-grid">
            <div class="form-item">
              <label>Operator</label>
              <Password v-model="privateFormData.upyun.operator" @blur="emit('save')" :feedback="false" toggleMask fluid placeholder="操作员账号" />
            </div>
            <div class="form-item">
              <label>Password</label>
              <Password v-model="privateFormData.upyun.password" @blur="emit('save')" :feedback="false" toggleMask fluid placeholder="操作员密码" />
            </div>
            <div class="form-item span-full">
              <label>存储桶 (Bucket)</label>
              <InputText v-model="privateFormData.upyun.bucket" @blur="emit('save')" class="w-full" />
            </div>
            <div class="form-item span-full">
              <label>公开访问域名 (Public Domain)</label>
              <InputText v-model="privateFormData.upyun.publicDomain" @blur="emit('save')" placeholder="https://images.example.com" class="w-full" />
            </div>
            <div class="form-item span-full">
              <label>自定义路径 (Optional)</label>
              <InputText v-model="privateFormData.upyun.path" @blur="emit('save')" placeholder="e.g. blog/images/" class="w-full" />
            </div>
          </div>
        </HostingCard>
      </div>

      <div class="group-title">
        <span class="category-icon" v-html="getCategoryIcon('public-easy')"></span>
        <span>公共图床-开箱即用</span>
      </div>
      <div class="provider-grid">
        <HostingCard
          id="jd"
          :force-expand="isTargetCard('jd')"
          name="京东"
          description="京东云存储，开箱即用"
          :isBuiltin="true"
          :isConfigured="jdAvailable"
          :isAvailable="jdAvailable"
          :isChecking="isCheckingJd"
          :health-tooltip="healthTooltipMap['jd']"
          :showTestButton="false"
          @check="emit('checkBuiltin', $event)"
        >
          <div class="builtin-info">
            <p>京东图床无需任何配置，可以直接使用。</p>
          </div>
        </HostingCard>

        <HostingCard
          id="qiyu"
          :force-expand="isTargetCard('qiyu')"
          name="七鱼"
          description="网易七鱼客服系统存储"
          :isBuiltin="true"
          :isConfigured="qiyuAvailable"
          :isAvailable="qiyuAvailable"
          :isChecking="isCheckingQiyu"
          :health-tooltip="healthTooltipMap['qiyu']"
          :showTestButton="false"
          @check="emit('checkBuiltin', $event)"
        >
          <div class="builtin-info">
            <p>七鱼图床 Token 已自动获取，可以直接使用。</p>
          </div>
        </HostingCard>
      </div>

      <div class="group-title">
        <span class="category-icon" v-html="getCategoryIcon('public-cookie')"></span>
        <span>公共图床-Cookie 认证</span>
      </div>
      <div class="provider-grid">
        <HostingCard
          id="weibo"
          :force-expand="isTargetCard('weibo')"
          name="微博"
          description="新浪微博图床"
          :isConfigured="isCookieConfigured('weibo')"
          :health-status="healthStatusMap['weibo']"
          :health-tooltip="healthTooltipMap['weibo']"
          :isTesting="testingConnections['weibo']"
          :showLoginButton="true"
          @test="emit('testCookie', $event)"
          @login="emit('loginCookie', $event)"
        >
          <div class="form-grid">
            <div class="form-item span-full">
              <label>Cookie</label>
              <Textarea v-model="cookieFormData.weibo.cookie" @blur="emit('save')" rows="4" class="w-full cookie-field" placeholder="从浏览器开发者工具中复制完整的 Cookie 字符串" />
              <small class="form-hint">点击「自动获取」登录即可自动填入 Cookie，无需手动操作<br>如需手动填写，可在浏览器中登录后通过开发者工具（F12 → Network）复制 Cookie</small>
            </div>
          </div>
          <template #extra>
            <WeiboLinkPrefixSection
              :link-prefix-enabled="linkPrefixEnabled"
              :prefix-list="prefixList"
              :selected-prefix-index="selectedPrefixIndex"
              @update:link-prefix-enabled="emit('update:linkPrefixEnabled', $event)"
              @update:prefix-list="emit('update:prefixList', $event)"
              @update:selected-prefix-index="emit('update:selectedPrefixIndex', $event)"
              @save="emit('save')"
              @add-prefix="emit('addPrefix')"
              @remove-prefix="emit('removePrefix', $event)"
              @reset-to-default="emit('resetToDefault')"
            />
          </template>
        </HostingCard>

        <HostingCard
          id="zhihu"
          :force-expand="isTargetCard('zhihu')"
          name="知乎"
          description="知乎图床"
          :isConfigured="isCookieConfigured('zhihu')"
          :health-status="healthStatusMap['zhihu']"
          :health-tooltip="healthTooltipMap['zhihu']"
          :isTesting="testingConnections['zhihu']"
          :showLoginButton="true"
          @test="emit('testCookie', $event)"
          @login="emit('loginCookie', $event)"
        >
          <div class="form-grid">
            <div class="form-item span-full">
              <label>Cookie</label>
              <Textarea v-model="cookieFormData.zhihu.cookie" @blur="emit('save')" rows="4" class="w-full cookie-field" placeholder="从浏览器开发者工具中复制完整的 Cookie 字符串" />
              <small class="form-hint">点击「自动获取」登录即可自动填入 Cookie，无需手动操作<br>如需手动填写，可在浏览器中登录后通过开发者工具（F12 → Network）复制 Cookie</small>
            </div>
          </div>
        </HostingCard>

        <HostingCard
          id="nowcoder"
          :force-expand="isTargetCard('nowcoder')"
          name="牛客"
          description="牛客网图床"
          :isConfigured="isCookieConfigured('nowcoder')"
          :health-status="healthStatusMap['nowcoder']"
          :health-tooltip="healthTooltipMap['nowcoder']"
          :isTesting="testingConnections['nowcoder']"
          :showLoginButton="true"
          @test="emit('testCookie', $event)"
          @login="emit('loginCookie', $event)"
        >
          <div class="form-grid">
            <div class="form-item span-full">
              <label>Cookie</label>
              <Textarea v-model="cookieFormData.nowcoder.cookie" @blur="emit('save')" rows="4" class="w-full cookie-field" placeholder="从浏览器开发者工具中复制完整的 Cookie 字符串" />
              <small class="form-hint">点击「自动获取」登录即可自动填入 Cookie，无需手动操作<br>如需手动填写，可在浏览器中登录后通过开发者工具（F12 → Network）复制 Cookie</small>
            </div>
          </div>
        </HostingCard>

        <HostingCard
          id="nami"
          :force-expand="isTargetCard('nami')"
          name="纳米"
          description="纳米图床"
          :isConfigured="isCookieConfigured('nami')"
          :health-status="healthStatusMap['nami']"
          :health-tooltip="healthTooltipMap['nami']"
          :isTesting="testingConnections['nami']"
          :showLoginButton="true"
          @test="emit('testCookie', $event)"
          @login="emit('loginCookie', $event)"
        >
          <div class="form-grid">
            <div class="form-item span-full">
              <label>Cookie</label>
              <Textarea v-model="cookieFormData.nami.cookie" @blur="emit('save')" rows="4" class="w-full cookie-field" placeholder="从浏览器开发者工具中复制完整的 Cookie 字符串" />
              <small class="form-hint">点击「自动获取」登录即可自动填入 Cookie，无需手动操作<br>如需手动填写，可在浏览器中登录后通过开发者工具（F12 → Network）复制 Cookie</small>
            </div>
            <div v-if="extractNamiAuthToken" class="form-item span-full">
              <label>Auth-Token（自动提取）</label>
              <InputText :modelValue="extractNamiAuthToken" readonly class="w-full" disabled />
            </div>
          </div>
        </HostingCard>

        <HostingCard
          id="bilibili"
          :force-expand="isTargetCard('bilibili')"
          name="B站"
          description="Bilibili 图床"
          :isConfigured="isCookieConfigured('bilibili')"
          :health-status="healthStatusMap['bilibili']"
          :health-tooltip="healthTooltipMap['bilibili']"
          :isTesting="testingConnections['bilibili']"
          :showLoginButton="true"
          @test="emit('testCookie', $event)"
          @login="emit('loginCookie', $event)"
        >
          <div class="form-grid">
            <div class="form-item span-full">
              <label>Cookie</label>
              <Textarea v-model="cookieFormData.bilibili.cookie" @blur="emit('save')" rows="4" class="w-full cookie-field" placeholder="从浏览器开发者工具中复制完整的 Cookie 字符串" />
              <small class="form-hint">点击「自动获取」登录即可自动填入 Cookie，无需手动操作<br>如需手动填写，可在浏览器中登录后通过开发者工具（F12 → Network）复制 Cookie</small>
            </div>
          </div>
        </HostingCard>

        <HostingCard
          id="chaoxing"
          :force-expand="isTargetCard('chaoxing')"
          name="超星"
          description="超星图床"
          :isConfigured="isCookieConfigured('chaoxing')"
          :health-status="healthStatusMap['chaoxing']"
          :health-tooltip="healthTooltipMap['chaoxing']"
          :isTesting="testingConnections['chaoxing']"
          :showLoginButton="true"
          @test="emit('testCookie', $event)"
          @login="emit('loginCookie', $event)"
        >
          <div class="form-grid">
            <div class="form-item span-full">
              <label>Cookie</label>
              <Textarea v-model="cookieFormData.chaoxing.cookie" @blur="emit('save')" rows="4" class="w-full cookie-field" placeholder="从浏览器开发者工具中复制完整的 Cookie 字符串" />
              <small class="form-hint">点击「自动获取」登录即可自动填入 Cookie，无需手动操作<br>如需手动填写，可在浏览器中登录后通过开发者工具（F12 → Network）复制 Cookie</small>
            </div>
          </div>
        </HostingCard>
      </div>

      <div class="group-title">
        <span class="category-icon" v-html="getCategoryIcon('public-token')"></span>
        <span>公共图床-Token 认证</span>
      </div>
      <div class="provider-grid">
        <HostingCard
          id="smms"
          :force-expand="isTargetCard('smms')"
          name="SM.MS"
          description="SM.MS 图床"
          :isConfigured="isTokenConfigured('smms')"
          :health-status="healthStatusMap['smms']"
          :health-tooltip="healthTooltipMap['smms']"
          :isTesting="testingConnections['smms']"
          @test="emit('testToken', $event)"
        >
          <div class="form-grid">
            <div class="form-item span-full">
              <label>API Token</label>
              <Password v-model="tokenFormData.smms.token" @blur="emit('save')" :feedback="false" toggleMask fluid placeholder="从 SM.MS 官网获取 API Token" />
              <small class="form-hint">访问 <a href="https://sm.ms/home/apitoken" target="_blank">https://sm.ms/home/apitoken</a> 获取 API Token</small>
            </div>
          </div>
        </HostingCard>

        <HostingCard
          id="github"
          :force-expand="isTargetCard('github')"
          name="GitHub"
          description="GitHub 仓库图床"
          :isConfigured="isTokenConfigured('github')"
          :health-status="healthStatusMap['github']"
          :health-tooltip="healthTooltipMap['github']"
          :isTesting="testingConnections['github']"
          @test="emit('testToken', $event)"
        >
          <div class="form-grid">
            <div class="form-item">
              <label>Personal Access Token</label>
              <Password v-model="tokenFormData.github.token" @blur="emit('save')" :feedback="false" toggleMask fluid placeholder="ghp_xxxxxxxxxxxx" />
            </div>
            <div class="form-item">
              <label>Repository Owner</label>
              <InputText v-model="tokenFormData.github.owner" @blur="emit('save')" class="w-full" placeholder="your-username" />
            </div>
            <div class="form-item">
              <label>Repository Name</label>
              <InputText v-model="tokenFormData.github.repo" @blur="emit('save')" class="w-full" placeholder="image-hosting" />
            </div>
            <div class="form-item">
              <label>Branch</label>
              <InputText v-model="tokenFormData.github.branch" @blur="emit('save')" placeholder="main" class="w-full" />
            </div>
            <div class="form-item span-full">
              <label>Storage Path</label>
              <InputText v-model="tokenFormData.github.path" @blur="emit('save')" placeholder="images/" class="w-full" />
              <small class="form-hint">图片存储在仓库中的路径，例如 images/ 或 assets/pics/</small>
            </div>
          </div>
          <template #extra>
            <GithubUrlStrategySection
              :url-strategy="githubUrlStrategy"
              @update:url-strategy="emit('update:githubUrlStrategy', $event)"
              @save="emit('save')"
            />
          </template>
        </HostingCard>

        <HostingCard
          id="imgur"
          :force-expand="isTargetCard('imgur')"
          name="Imgur"
          description="Imgur 图床"
          :isConfigured="isTokenConfigured('imgur')"
          :health-status="healthStatusMap['imgur']"
          :health-tooltip="healthTooltipMap['imgur']"
          :isTesting="testingConnections['imgur']"
          @test="emit('testToken', $event)"
        >
          <div class="form-grid">
            <div class="form-item">
              <label>Client ID</label>
              <Password v-model="tokenFormData.imgur.clientId" @blur="emit('save')" :feedback="false" toggleMask fluid placeholder="从 Imgur API 获取" />
            </div>
            <div class="form-item">
              <label>Client Secret（可选）</label>
              <Password v-model="tokenFormData.imgur.clientSecret" @blur="emit('save')" :feedback="false" toggleMask fluid placeholder="可选配置" />
            </div>
            <div class="form-item span-full">
              <small class="form-hint">访问 <a href="https://api.imgur.com/oauth2/addclient" target="_blank">Imgur API</a> 注册应用获取 Client ID</small>
            </div>
          </div>
        </HostingCard>
      </div>
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

.batch-test-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 12px;
  margin-top: 12px;
}

.batch-report {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  padding-top: 4px;
}

.report-summary {
  font-weight: 600;
}

.report-summary.all-pass {
  color: var(--green-500);
}

.report-summary.has-fail {
  color: var(--orange-500);
}

.report-summary.all-fail {
  color: var(--red-400);
}

.report-failures {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.failure-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.failure-name {
  font-weight: 500;
  color: var(--red-400);
  white-space: nowrap;
}

.failure-error {
  color: var(--text-muted);
  word-break: break-all;
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
