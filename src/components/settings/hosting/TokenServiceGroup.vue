<script setup lang="ts">
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import HostingCard from '../HostingCard.vue';
import GithubProxySection from './GithubProxySection.vue';
import type { GithubCdnConfig } from '../../../config/types';
import type { ServiceHealthStatus } from '../../../types/serviceHealth';

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

// NOTE: tokenFormData 通过引用传递，子组件直接修改嵌套属性是有意为之的设计
// 父组件（HostingSettingsPanel）负责监听 save 事件触发持久化
const props = defineProps<{
  tokenFormData: TokenFormData;
  testingConnections: Record<string, boolean>;
  healthStatusMap: Record<string, ServiceHealthStatus>;
  healthTooltipMap: Record<string, string>;
  targetCardId?: string | null;
  githubCdnConfig?: GithubCdnConfig;
}>();

const emit = defineEmits<{
  save: [];
  testToken: [providerId: string];
  'update:githubCdnConfig': [config: GithubCdnConfig];
}>();

function isTokenConfigured(providerId: keyof TokenFormData): boolean {
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

</script>

<template>
  <div class="provider-grid">
    <!-- SM.MS -->
    <HostingCard
      id="smms"
      :force-expand="targetCardId === 'smms'"
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

    <!-- GitHub -->
    <HostingCard
      id="github"
      :force-expand="targetCardId === 'github'"
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
        <div class="form-item span-full">
          <small class="form-hint">访问 <a href="https://github.com/settings/tokens/new?scopes=repo&description=PicNexus" target="_blank">GitHub Token 创建页面</a> 获取 Personal Access Token（需要 repo 权限）</small>
        </div>
      </div>
      <template #extra>
        <GithubProxySection
          :cdn-config="githubCdnConfig"
          @update:cdn-config="emit('update:githubCdnConfig', $event)"
          @save="emit('save')"
        />
      </template>
    </HostingCard>

    <!-- Imgur -->
    <HostingCard
      id="imgur"
      :force-expand="targetCardId === 'imgur'"
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
</template>

<style scoped>
@import '../../../styles/settings-shared.css';
</style>
