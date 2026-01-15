<script setup lang="ts">
import { computed } from 'vue';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import Textarea from 'primevue/textarea';
import HostingCard from './HostingCard.vue';
import { getCategoryIcon } from '../../utils/icons';

interface PrivateFormData {
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucketName: string; path: string; publicDomain: string };
  tencent: { secretId: string; secretKey: string; region: string; bucket: string; path: string; publicDomain: string };
  aliyun: { accessKeyId: string; accessKeySecret: string; region: string; bucket: string; path: string; publicDomain: string };
  qiniu: { accessKey: string; secretKey: string; region: string; bucket: string; domain: string; path: string };
  upyun: { operator: string; password: string; bucket: string; domain: string; path: string };
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
  github: { token: string; owner: string; repo: string; branch: string; path: string; customDomain?: string };
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
}>();

const emit = defineEmits<{
  save: [];
  testPrivate: [providerId: string];
  testToken: [providerId: string];
  testCookie: [providerId: string];
  checkBuiltin: [providerId: string];
  loginCookie: [providerId: string];
}>();

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
      return !!(data.qiniu.accessKey && data.qiniu.secretKey && data.qiniu.region && data.qiniu.bucket && data.qiniu.domain);
    case 'upyun':
      return !!(data.upyun.operator && data.upyun.password && data.upyun.bucket && data.upyun.domain);
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
</script>

<template>
  <div class="hosting-settings-panel">
    <div class="section-header">
      <h2>图床设置</h2>
      <p class="section-desc">根据认证方式和使用场景选择合适的图床服务</p>
    </div>

    <div class="settings-content">
      <div class="group-title">
        <span class="category-icon" v-html="getCategoryIcon('private-storage')"></span>
        <span>私有存储</span>
      </div>
      <div class="provider-grid">
        <HostingCard
          id="r2"
          name="Cloudflare R2"
          description="S3 兼容的高速存储"
          :isConfigured="isPrivateConfigured('r2')"
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
              <Password v-model="privateFormData.r2.accessKeyId" @blur="emit('save')" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
            </div>
            <div class="form-item">
              <label>Secret Access Key</label>
              <Password v-model="privateFormData.r2.secretAccessKey" @blur="emit('save')" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
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
          name="腾讯云"
          description="腾讯云对象存储"
          :isConfigured="isPrivateConfigured('tencent')"
          :isTesting="testingConnections['tencent']"
          @test="emit('testPrivate', $event)"
        >
          <div class="form-grid">
            <div class="form-item">
              <label>Secret ID</label>
              <Password v-model="privateFormData.tencent.secretId" @blur="emit('save')" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
            </div>
            <div class="form-item">
              <label>Secret Key</label>
              <Password v-model="privateFormData.tencent.secretKey" @blur="emit('save')" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
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
          name="阿里云"
          description="阿里云对象存储"
          :isConfigured="isPrivateConfigured('aliyun')"
          :isTesting="testingConnections['aliyun']"
          @test="emit('testPrivate', $event)"
        >
          <div class="form-grid">
            <div class="form-item">
              <label>Access Key ID</label>
              <Password v-model="privateFormData.aliyun.accessKeyId" @blur="emit('save')" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
            </div>
            <div class="form-item">
              <label>Access Key Secret</label>
              <Password v-model="privateFormData.aliyun.accessKeySecret" @blur="emit('save')" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
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
          name="七牛云"
          description="七牛云对象存储"
          :isConfigured="isPrivateConfigured('qiniu')"
          :isTesting="testingConnections['qiniu']"
          @test="emit('testPrivate', $event)"
        >
          <div class="form-grid">
            <div class="form-item">
              <label>Access Key (AK)</label>
              <Password v-model="privateFormData.qiniu.accessKey" @blur="emit('save')" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
            </div>
            <div class="form-item">
              <label>Secret Key (SK)</label>
              <Password v-model="privateFormData.qiniu.secretKey" @blur="emit('save')" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
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
              <label>绑定域名 (Domain)</label>
              <InputText v-model="privateFormData.qiniu.domain" @blur="emit('save')" placeholder="https://images.example.com" class="w-full" />
            </div>
            <div class="form-item span-full">
              <label>自定义路径 (Optional)</label>
              <InputText v-model="privateFormData.qiniu.path" @blur="emit('save')" placeholder="e.g. blog/images/" class="w-full" />
            </div>
          </div>
        </HostingCard>

        <HostingCard
          id="upyun"
          name="又拍云"
          description="又拍云对象存储"
          :isConfigured="isPrivateConfigured('upyun')"
          :isTesting="testingConnections['upyun']"
          @test="emit('testPrivate', $event)"
        >
          <div class="form-grid">
            <div class="form-item">
              <label>Operator</label>
              <Password v-model="privateFormData.upyun.operator" @blur="emit('save')" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
            </div>
            <div class="form-item">
              <label>Password</label>
              <Password v-model="privateFormData.upyun.password" @blur="emit('save')" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
            </div>
            <div class="form-item span-full">
              <label>存储桶 (Bucket)</label>
              <InputText v-model="privateFormData.upyun.bucket" @blur="emit('save')" class="w-full" />
            </div>
            <div class="form-item span-full">
              <label>绑定域名 (Domain)</label>
              <InputText v-model="privateFormData.upyun.domain" @blur="emit('save')" placeholder="https://images.example.com" class="w-full" />
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
          name="京东"
          description="京东云存储，开箱即用"
          :isBuiltin="true"
          :isConfigured="jdAvailable"
          :isAvailable="jdAvailable"
          :isChecking="isCheckingJd"
          :showTestButton="false"
          @check="emit('checkBuiltin', $event)"
        >
          <div class="builtin-info">
            <p>京东图床无需任何配置，可以直接使用。</p>
          </div>
        </HostingCard>

        <HostingCard
          id="qiyu"
          name="七鱼"
          description="网易七鱼客服系统存储"
          :isBuiltin="true"
          :isConfigured="qiyuAvailable"
          :isAvailable="qiyuAvailable"
          :isChecking="isCheckingQiyu"
          :showTestButton="false"
          :showLoginButton="true"
          @login="emit('loginCookie', $event)"
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
          name="微博"
          description="新浪微博图床"
          :isConfigured="isCookieConfigured('weibo')"
          :isTesting="testingConnections['weibo']"
          :showLoginButton="true"
          @test="emit('testCookie', $event)"
          @login="emit('loginCookie', $event)"
        >
          <div class="form-grid">
            <div class="form-item span-full">
              <label>Cookie</label>
              <Textarea v-model="cookieFormData.weibo.cookie" @blur="emit('save')" rows="6" class="w-full" placeholder="从浏览器开发者工具中复制完整的 Cookie 字符串" />
              <small class="form-hint">在浏览器中登录微博，按 F12 打开开发者工具，在 Network 选项卡中找到请求头的 Cookie 值并复制</small>
            </div>
          </div>
        </HostingCard>

        <HostingCard
          id="zhihu"
          name="知乎"
          description="知乎图床"
          :isConfigured="isCookieConfigured('zhihu')"
          :isTesting="testingConnections['zhihu']"
          :showLoginButton="true"
          @test="emit('testCookie', $event)"
          @login="emit('loginCookie', $event)"
        >
          <div class="form-grid">
            <div class="form-item span-full">
              <label>Cookie</label>
              <Textarea v-model="cookieFormData.zhihu.cookie" @blur="emit('save')" rows="6" class="w-full" placeholder="从浏览器开发者工具中复制完整的 Cookie 字符串" />
              <small class="form-hint">在浏览器中登录知乎，按 F12 打开开发者工具，在 Network 选项卡中找到请求头的 Cookie 值并复制</small>
            </div>
          </div>
        </HostingCard>

        <HostingCard
          id="nowcoder"
          name="牛客"
          description="牛客网图床"
          :isConfigured="isCookieConfigured('nowcoder')"
          :isTesting="testingConnections['nowcoder']"
          :showLoginButton="true"
          @test="emit('testCookie', $event)"
          @login="emit('loginCookie', $event)"
        >
          <div class="form-grid">
            <div class="form-item span-full">
              <label>Cookie</label>
              <Textarea v-model="cookieFormData.nowcoder.cookie" @blur="emit('save')" rows="6" class="w-full" placeholder="从浏览器开发者工具中复制完整的 Cookie 字符串" />
              <small class="form-hint">在浏览器中登录牛客，按 F12 打开开发者工具，在 Network 选项卡中找到请求头的 Cookie 值并复制</small>
            </div>
          </div>
        </HostingCard>

        <HostingCard
          id="nami"
          name="纳米"
          description="纳米图床"
          :isConfigured="isCookieConfigured('nami')"
          :isTesting="testingConnections['nami']"
          :showLoginButton="true"
          @test="emit('testCookie', $event)"
          @login="emit('loginCookie', $event)"
        >
          <div class="form-grid">
            <div class="form-item span-full">
              <label>Cookie</label>
              <Textarea v-model="cookieFormData.nami.cookie" @blur="emit('save')" rows="6" class="w-full" placeholder="从浏览器开发者工具中复制完整的 Cookie 字符串" />
              <small class="form-hint">Auth-Token 会自动从 Cookie 中提取</small>
            </div>
            <div v-if="extractNamiAuthToken" class="form-item span-full">
              <label>Auth-Token（自动提取）</label>
              <InputText :modelValue="extractNamiAuthToken" readonly class="w-full" disabled />
            </div>
          </div>
        </HostingCard>

        <HostingCard
          id="bilibili"
          name="B站"
          description="Bilibili 图床"
          :isConfigured="isCookieConfigured('bilibili')"
          :isTesting="testingConnections['bilibili']"
          :showLoginButton="true"
          @test="emit('testCookie', $event)"
          @login="emit('loginCookie', $event)"
        >
          <div class="form-grid">
            <div class="form-item span-full">
              <label>Cookie</label>
              <Textarea v-model="cookieFormData.bilibili.cookie" @blur="emit('save')" rows="6" class="w-full" placeholder="从浏览器开发者工具中复制完整的 Cookie 字符串" />
              <small class="form-hint">在浏览器中登录 B站，按 F12 打开开发者工具，在 Network 选项卡中找到请求头的 Cookie 值并复制</small>
            </div>
          </div>
        </HostingCard>

        <HostingCard
          id="chaoxing"
          name="超星"
          description="超星图床"
          :isConfigured="isCookieConfigured('chaoxing')"
          :isTesting="testingConnections['chaoxing']"
          :showLoginButton="true"
          @test="emit('testCookie', $event)"
          @login="emit('loginCookie', $event)"
        >
          <div class="form-grid">
            <div class="form-item span-full">
              <label>Cookie</label>
              <Textarea v-model="cookieFormData.chaoxing.cookie" @blur="emit('save')" rows="6" class="w-full" placeholder="从浏览器开发者工具中复制完整的 Cookie 字符串" />
              <small class="form-hint">在浏览器中登录超星，按 F12 打开开发者工具，在 Network 选项卡中找到请求头的 Cookie 值并复制</small>
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
          name="SM.MS"
          description="SM.MS 图床"
          :isConfigured="isTokenConfigured('smms')"
          :isTesting="testingConnections['smms']"
          @test="emit('testToken', $event)"
        >
          <div class="form-grid">
            <div class="form-item span-full">
              <label>API Token</label>
              <Password v-model="tokenFormData.smms.token" @blur="emit('save')" :feedback="false" toggleMask class="w-full" inputClass="w-full" placeholder="从 SM.MS 官网获取 API Token" />
              <small class="form-hint">访问 <a href="https://sm.ms/home/apitoken" target="_blank">https://sm.ms/home/apitoken</a> 获取 API Token</small>
            </div>
          </div>
        </HostingCard>

        <HostingCard
          id="github"
          name="GitHub"
          description="GitHub 仓库图床"
          :isConfigured="isTokenConfigured('github')"
          :isTesting="testingConnections['github']"
          @test="emit('testToken', $event)"
        >
          <div class="form-grid">
            <div class="form-item">
              <label>Personal Access Token</label>
              <Password v-model="tokenFormData.github.token" @blur="emit('save')" :feedback="false" toggleMask class="w-full" inputClass="w-full" placeholder="ghp_xxxxxxxxxxxx" />
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
            <div class="form-item span-full">
              <label>Custom Domain（可选）</label>
              <InputText v-model="tokenFormData.github.customDomain" @blur="emit('save')" placeholder="https://cdn.example.com" class="w-full" />
              <small class="form-hint">自定义域名，留空则使用 raw.githubusercontent.com</small>
            </div>
          </div>
        </HostingCard>

        <HostingCard
          id="imgur"
          name="Imgur"
          description="Imgur 图床"
          :isConfigured="isTokenConfigured('imgur')"
          :isTesting="testingConnections['imgur']"
          @test="emit('testToken', $event)"
        >
          <div class="form-grid">
            <div class="form-item">
              <label>Client ID</label>
              <Password v-model="tokenFormData.imgur.clientId" @blur="emit('save')" :feedback="false" toggleMask class="w-full" inputClass="w-full" placeholder="从 Imgur API 获取" />
            </div>
            <div class="form-item">
              <label>Client Secret（可选）</label>
              <Password v-model="tokenFormData.imgur.clientSecret" @blur="emit('save')" :feedback="false" toggleMask class="w-full" inputClass="w-full" placeholder="可选配置" />
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

@media (max-width: 768px) {
  .form-grid {
    grid-template-columns: 1fr;
  }

  .form-item.span-full {
    grid-column: 1;
  }
}
</style>
