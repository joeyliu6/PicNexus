<script setup lang="ts">
/**
 * Cookie 认证图床统一设置面板
 * 整合 Weibo、Zhihu、Nowcoder、Nami、Bilibili、Chaoxing 的配置界面
 * 使用标签页切换，带配置状态指示器和测试功能
 */
import { ref, computed } from 'vue';
import Textarea from 'primevue/textarea';
import InputText from 'primevue/inputtext';
import Button from 'primevue/button';

// Props 定义
interface CookieFormData {
  weibo: { cookie: string };
  zhihu: { cookie: string };
  nowcoder: { cookie: string };
  nami: { cookie: string };
  bilibili: { cookie: string };
  chaoxing: { cookie: string };
}

const props = defineProps<{
  formData: CookieFormData;
  testingConnections: Record<string, boolean>;
}>();

const emit = defineEmits<{
  save: [];
  test: [providerId: string];
  login: [providerId: string];
}>();

// 服务商类型定义
type ProviderId = 'weibo' | 'zhihu' | 'nowcoder' | 'nami' | 'bilibili' | 'chaoxing';

interface Provider {
  id: ProviderId;
  name: string;
  description: string;
}

// 服务商定义
const PROVIDERS: Provider[] = [
  { id: 'weibo', name: '微博', description: '新浪微博图床，需要登录后的 Cookie' },
  { id: 'zhihu', name: '知乎', description: '知乎图床，需要登录后的 Cookie' },
  { id: 'nowcoder', name: '牛客', description: '牛客网图床，需要登录后的 Cookie' },
  { id: 'nami', name: '纳米', description: '纳米图床，需要登录后的 Cookie，Auth-Token 自动提取' },
  { id: 'bilibili', name: 'B站', description: 'Bilibili 图床，需要登录后的 Cookie' },
  { id: 'chaoxing', name: '超星', description: '超星图床，需要登录后的 Cookie' },
];

// 当前选择的服务商
const selectedProvider = ref<ProviderId>('weibo');

// 当前服务商信息
const currentProviderInfo = computed(() => {
  return PROVIDERS.find(p => p.id === selectedProvider.value)!;
});

// 检查服务商配置是否完整（用于状态指示器）
const isProviderConfigured = (providerId: ProviderId): boolean => {
  const formData = props.formData;
  return !!(formData[providerId]?.cookie && formData[providerId].cookie.trim().length > 0);
};

// 当前服务商是否已配置
const isCurrentConfigured = computed(() => {
  return isProviderConfigured(selectedProvider.value);
});

// 当前服务商是否正在测试
const isTesting = computed(() => {
  return props.testingConnections[selectedProvider.value] || false;
});

// 保存设置
const handleSave = () => {
  emit('save');
};

// 测试连接
const handleTest = () => {
  emit('test', selectedProvider.value);
};

// 自动获取 Cookie
const handleLogin = () => {
  emit('login', selectedProvider.value);
};

// 从 Cookie 中提取 Auth-Token（仅用于 Nami）
const extractAuthToken = computed(() => {
  if (selectedProvider.value !== 'nami') return '';
  const cookie = props.formData.nami.cookie;
  if (!cookie) return '';

  // 尝试从 Cookie 中提取 auth-token
  const match = cookie.match(/auth-token=([^;]+)/);
  return match ? match[1] : '';
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

      <!-- 通用 Cookie 表单 -->
      <div class="form-grid">
        <div class="form-item span-full">
          <label>Cookie</label>
          <Textarea
            v-model="formData[selectedProvider].cookie"
            @blur="handleSave"
            rows="6"
            class="w-full"
            placeholder="从浏览器开发者工具中复制完整的 Cookie 字符串"
          />
          <small class="form-hint">
            在浏览器中登录 {{ currentProviderInfo.name }}，按 F12 打开开发者工具，在 Network 选项卡中找到请求头的 Cookie 值并复制
          </small>
        </div>

        <!-- Nami 特殊：显示提取的 Auth-Token -->
        <div v-if="selectedProvider === 'nami' && extractAuthToken" class="form-item span-full">
          <label>Auth-Token（自动提取）</label>
          <InputText
            :modelValue="extractAuthToken"
            readonly
            class="w-full"
            disabled
          />
          <small class="form-hint">
            此 Token 已从 Cookie 中自动提取，无需手动输入
          </small>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="actions-row">
        <Button
          label="自动获取"
          icon="pi pi-sign-in"
          @click="handleLogin"
          severity="info"
          outlined
          size="small"
        />
        <Button
          label="测试连接"
          icon="pi pi-check"
          @click="handleTest"
          :loading="isTesting"
          :disabled="!isCurrentConfigured"
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
