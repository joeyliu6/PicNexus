<script setup lang="ts">
import InputText from 'primevue/inputtext';
import HostingCard from '../HostingCard.vue';
import GithubProxySection from './GithubProxySection.vue';
import SensitiveField from '../../common/SensitiveField.vue';
import type { GithubCdnConfig } from '../../../config/types';
import type { ServiceHealthStatus } from '../../../types/serviceHealth';
import { hasNonEmptyFields } from '../../../utils/validators';
import { useSensitiveDraft } from '../../../composables/settings/useSensitiveDraft';
import { useSecretClearConfirm } from '../../../composables/settings/useSecretClearConfirm';

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
  refreshingServiceIds: Set<string>;
  targetCardId?: string | null;
  githubCdnConfig?: GithubCdnConfig;
}>();

const emit = defineEmits<{
  save: [];
  testToken: [providerId: string];
  'update:githubCdnConfig': [config: GithubCdnConfig];
}>();

// 各服务"已配置"所需的必填字段（添加新服务时只需在此扩展）
const TOKEN_REQUIRED_FIELDS = {
  smms: ['token'],
  github: ['token', 'owner', 'repo'],
  imgur: ['clientId'],
} as const satisfies { [K in keyof TokenFormData]: ReadonlyArray<keyof TokenFormData[K]> };

function isTokenConfigured(providerId: keyof TokenFormData): boolean {
  return hasNonEmptyFields(
    props.tokenFormData[providerId] as Record<string, unknown>,
    TOKEN_REQUIRED_FIELDS[providerId] as ReadonlyArray<string>,
  );
}

/**
 * 敏感字段的读写口子
 *
 * 这些 token 是明文存在 formData 里的（整份 .settings.dat 由 EncryptedStore 统一
 * 加密，字段级再加一层用的是同一把钥匙，没有增量收益），所以"按需揭示"就是直接
 * 读回来，不涉及解密。
 */
const SECRET_FIELDS: Record<
  string,
  { get: (fd: TokenFormData) => string; set: (fd: TokenFormData, value: string) => void }
> = {
  'smms.token': { get: fd => fd.smms.token, set: (fd, v) => { fd.smms.token = v; } },
  'github.token': { get: fd => fd.github.token, set: (fd, v) => { fd.github.token = v; } },
  'imgur.clientId': { get: fd => fd.imgur.clientId, set: (fd, v) => { fd.imgur.clientId = v; } },
  'imgur.clientSecret': {
    get: fd => fd.imgur.clientSecret ?? '',
    set: (fd, v) => { fd.imgur.clientSecret = v; },
  },
};

const confirmClearSecret = useSecretClearConfirm();

const secrets = useSensitiveDraft({
  hasStored: key => !!SECRET_FIELDS[key]?.get(props.tokenFormData),
  reveal: key => Promise.resolve(SECRET_FIELDS[key]?.get(props.tokenFormData) ?? ''),
  commit: (key, draft) => {
    // draft 为空串 = 清除；这些是明文字段，直接写空即可
    SECRET_FIELDS[key]?.set(props.tokenFormData, draft);
    emit('save');
  },
  confirmClear: confirmClearSecret,
});
</script>

<template>
  <!-- eslint-disable vue/no-mutating-props -- 见 script 顶部 NOTE：tokenFormData 通过引用传递是有意为之的设计，父组件 HostingSettingsPanel 通过 save 事件持久化 -->
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
      :is-refreshing="refreshingServiceIds.has('smms')"
      @test="emit('testToken', $event)"
    >
      <form class="form-grid" @submit.prevent>
        <div class="form-item span-full">
          <label>
            API Token
            <span v-if="secrets.hasStored('smms.token')" class="saved-chip">
              <i class="pi pi-check" aria-hidden="true"></i>{{ secrets.chipLabel('smms.token') }}
            </span>
          </label>
          <SensitiveField v-bind="secrets.bindingsFor('smms.token', '从 SM.MS 官网获取 API Token')" />
          <small class="form-hint">访问 <a href="https://sm.ms/home/apitoken" target="_blank">https://sm.ms/home/apitoken</a> 获取 API Token</small>
        </div>
      </form>
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
      :is-refreshing="refreshingServiceIds.has('github')"
      @test="emit('testToken', $event)"
    >
      <form class="form-grid" @submit.prevent>
        <div class="form-item">
          <label>
            Personal Access Token
            <span v-if="secrets.hasStored('github.token')" class="saved-chip">
              <i class="pi pi-check" aria-hidden="true"></i>{{ secrets.chipLabel('github.token') }}
            </span>
          </label>
          <SensitiveField v-bind="secrets.bindingsFor('github.token', 'ghp_xxxxxxxxxxxx')" />
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
      </form>
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
      :is-refreshing="refreshingServiceIds.has('imgur')"
      @test="emit('testToken', $event)"
    >
      <form class="form-grid" @submit.prevent>
        <div class="form-item">
          <label>
            Client ID
            <span v-if="secrets.hasStored('imgur.clientId')" class="saved-chip">
              <i class="pi pi-check" aria-hidden="true"></i>{{ secrets.chipLabel('imgur.clientId') }}
            </span>
          </label>
          <SensitiveField v-bind="secrets.bindingsFor('imgur.clientId', '从 Imgur API 获取')" />
        </div>
        <div class="form-item">
          <label>
            Client Secret（可选）
            <span v-if="secrets.hasStored('imgur.clientSecret')" class="saved-chip">
              <i class="pi pi-check" aria-hidden="true"></i>{{ secrets.chipLabel('imgur.clientSecret') }}
            </span>
          </label>
          <SensitiveField v-bind="secrets.bindingsFor('imgur.clientSecret', '可选配置')" />
        </div>
        <div class="form-item span-full">
          <small class="form-hint">访问 <a href="https://api.imgur.com/oauth2/addclient" target="_blank">Imgur API</a> 注册应用获取 Client ID</small>
        </div>
      </form>
    </HostingCard>
  </div>
</template>

<style scoped>
@import url('../../../styles/settings-shared.css');
</style>
