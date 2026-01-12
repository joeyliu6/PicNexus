<script setup lang="ts">
/**
 * Token 认证图床统一设置面板
 * 整合 SM.MS、GitHub、Imgur 的配置界面
 * 使用标签页切换，带配置状态指示器
 */
import { ref, computed } from 'vue';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import Button from 'primevue/button';

// Props 定义
interface TokenFormData {
  smms: { token: string };
  github: { token: string; owner: string; repo: string; branch: string; path: string; customDomain?: string };
  imgur: { clientId: string; clientSecret?: string };
}

const props = defineProps<{
  formData: TokenFormData;
  testingConnections: Record<string, boolean>;
}>();

const emit = defineEmits<{
  save: [];
  test: [providerId: string];
}>();

// 服务商类型定义
type ProviderId = 'smms' | 'github' | 'imgur';

interface Provider {
  id: ProviderId;
  name: string;
  description: string;
}

// 服务商定义
const PROVIDERS: Provider[] = [
  { id: 'smms', name: 'SM.MS', description: 'SM.MS 图床，需要 API Token' },
  { id: 'github', name: 'GitHub', description: 'GitHub 仓库图床，需要 Personal Access Token' },
  { id: 'imgur', name: 'Imgur', description: 'Imgur 图床，需要 Client ID' },
];

// 当前选择的服务商
const selectedProvider = ref<ProviderId>('smms');

// 当前服务商信息
const currentProviderInfo = computed(() => {
  return PROVIDERS.find(p => p.id === selectedProvider.value)!;
});

// 检查服务商配置是否完整（用于状态指示器）
const isProviderConfigured = (providerId: ProviderId): boolean => {
  const formData = props.formData;

  switch (providerId) {
    case 'smms':
      return !!(formData.smms.token && formData.smms.token.trim().length > 0);
    case 'github':
      return !!(
        formData.github.token &&
        formData.github.owner &&
        formData.github.repo
      );
    case 'imgur':
      return !!(formData.imgur.clientId && formData.imgur.clientId.trim().length > 0);
    default:
      return false;
  }
};

// 保存设置
const handleSave = () => {
  emit('save');
};

// 测试连接
const handleTest = () => {
  emit('test', selectedProvider.value);
};

// 当前服务的测试状态
const isTesting = computed(() => {
  return props.testingConnections[selectedProvider.value] || false;
});
</script>

<template>
  <div class="hosting-panel">
    <!-- 服务商标签页切换 -->
    <div class="provider-tabs">
      <button
        v-for="provider in PROVIDERS"
        :key="provider.id"
        class="provider-tab"
        :class="{ active: selectedProvider === provider.id }"
        @click="selectedProvider = provider.id"
      >
        <span
          class="provider-indicator"
          :class="{ configured: isProviderConfigured(provider.id) }"
        ></span>
        <span>{{ provider.name }}</span>
      </button>
    </div>

    <!-- 当前服务商配置表单 -->
    <div class="provider-form">
      <!-- 服务名称 -->
      <div class="section-header">
        <h2>{{ currentProviderInfo.name }}</h2>
      </div>

      <!-- SM.MS 表单 -->
      <div v-if="selectedProvider === 'smms'" class="form-grid">
        <div class="form-item span-full">
          <label>API Token</label>
          <Password
            v-model="formData.smms.token"
            @blur="handleSave"
            :feedback="false"
            toggleMask
            class="w-full"
            inputClass="w-full"
            placeholder="从 SM.MS 官网获取 API Token"
          />
          <small class="form-hint">
            访问 <a href="https://sm.ms/home/apitoken" target="_blank">https://sm.ms/home/apitoken</a> 获取 API Token
          </small>
        </div>
      </div>

      <!-- GitHub 表单 -->
      <div v-else-if="selectedProvider === 'github'" class="form-grid">
        <div class="form-item">
          <label>Personal Access Token</label>
          <Password
            v-model="formData.github.token"
            @blur="handleSave"
            :feedback="false"
            toggleMask
            class="w-full"
            inputClass="w-full"
            placeholder="ghp_xxxxxxxxxxxx"
          />
        </div>
        <div class="form-item">
          <label>Repository Owner</label>
          <InputText
            v-model="formData.github.owner"
            @blur="handleSave"
            class="w-full"
            placeholder="your-username"
          />
        </div>
        <div class="form-item">
          <label>Repository Name</label>
          <InputText
            v-model="formData.github.repo"
            @blur="handleSave"
            class="w-full"
            placeholder="image-hosting"
          />
        </div>
        <div class="form-item">
          <label>Branch</label>
          <InputText
            v-model="formData.github.branch"
            @blur="handleSave"
            placeholder="main"
            class="w-full"
          />
        </div>
        <div class="form-item span-full">
          <label>Storage Path</label>
          <InputText
            v-model="formData.github.path"
            @blur="handleSave"
            placeholder="images/"
            class="w-full"
          />
          <small class="form-hint">
            图片存储在仓库中的路径，例如 images/ 或 assets/pics/
          </small>
        </div>
        <div class="form-item span-full">
          <label>Custom Domain（可选）</label>
          <InputText
            v-model="formData.github.customDomain"
            @blur="handleSave"
            placeholder="https://cdn.example.com"
            class="w-full"
          />
          <small class="form-hint">
            自定义域名，留空则使用 raw.githubusercontent.com
          </small>
        </div>
      </div>

      <!-- Imgur 表单 -->
      <div v-else-if="selectedProvider === 'imgur'" class="form-grid">
        <div class="form-item">
          <label>Client ID</label>
          <Password
            v-model="formData.imgur.clientId"
            @blur="handleSave"
            :feedback="false"
            toggleMask
            class="w-full"
            inputClass="w-full"
            placeholder="从 Imgur API 获取"
          />
        </div>
        <div class="form-item">
          <label>Client Secret（可选）</label>
          <Password
            v-model="formData.imgur.clientSecret"
            @blur="handleSave"
            :feedback="false"
            toggleMask
            class="w-full"
            inputClass="w-full"
            placeholder="可选配置"
          />
        </div>
        <div class="form-item span-full">
          <small class="form-hint">
            访问 <a href="https://api.imgur.com/oauth2/addclient" target="_blank">Imgur API</a> 注册应用获取 Client ID
          </small>
        </div>
      </div>

      <!-- 测试连接按钮 -->
      <div class="actions-row">
        <Button
          label="测试连接"
          icon="pi pi-check"
          @click="handleTest"
          :loading="isTesting"
          :disabled="!isProviderConfigured(selectedProvider)"
          severity="secondary"
          outlined
          size="small"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.hosting-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 100%;
}

/* 服务商标签页 */
.provider-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 4px;
  background: var(--hover-overlay-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
}

.provider-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  background: transparent;
  border: none;
  border-radius: 8px;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.provider-tab:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.provider-tab.active {
  background: var(--bg-primary);
  color: var(--primary-color);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

/* 配置状态指示器 */
.provider-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  transition: background 0.2s ease;
}

.provider-indicator.configured {
  background: var(--success);
}

/* 表单区域 */
.provider-form {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.section-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-header h2 {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.section-desc {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0;
}

/* 表单网格 */
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

.form-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-item.span-full {
  grid-column: 1 / -1;
}

.form-item label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
}

.form-hint {
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.5;
  margin-top: 4px;
}

.form-hint a {
  color: var(--primary-color);
  text-decoration: none;
}

.form-hint a:hover {
  text-decoration: underline;
}

/* 操作按钮行 */
.actions-row {
  display: flex;
  justify-content: flex-start;
  gap: 12px;
  padding-top: 8px;
}

/* 响应式 */
@media (max-width: 768px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
