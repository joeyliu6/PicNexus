<script setup lang="ts">
/**
 * 私有图床统一设置面板
 * 整合 R2、COS、OSS、七牛云、又拍云的配置界面
 * 使用标签页切换，带配置状态指示器
 */
import { ref, computed } from 'vue';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import Button from 'primevue/button';

// Props 定义
interface PrivateHostingFormData {
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucketName: string; path: string; publicDomain: string };
  cos: { secretId: string; secretKey: string; region: string; bucket: string; path: string; publicDomain: string };
  oss: { accessKeyId: string; accessKeySecret: string; region: string; bucket: string; path: string; publicDomain: string };
  qiniu: { accessKey: string; secretKey: string; region: string; bucket: string; domain: string; path: string };
  upyun: { operator: string; password: string; bucket: string; domain: string; path: string };
}

const props = defineProps<{
  formData: PrivateHostingFormData;
  testingConnections: Record<string, boolean>;
}>();

const emit = defineEmits<{
  save: [];
  test: [providerId: string];
}>();

// 服务商类型定义
type ProviderId = 'r2' | 'cos' | 'oss' | 'qiniu' | 'upyun';

interface Provider {
  id: ProviderId;
  name: string;
  description: string;
}

// 私有图床服务商定义
const PROVIDERS: Provider[] = [
  { id: 'r2', name: 'Cloudflare R2', description: 'S3 兼容的高速存储，用于数据备份与分发' },
  { id: 'cos', name: '腾讯云 COS', description: '腾讯云对象存储，支持数据万象处理' },
  { id: 'oss', name: '阿里云 OSS', description: '阿里云对象存储，支持图片处理服务' },
  { id: 'qiniu', name: '七牛云', description: '七牛云对象存储，支持 CDN 加速' },
  { id: 'upyun', name: '又拍云', description: '又拍云对象存储，支持图片处理' },
];

// 当前选择的服务商
const selectedProvider = ref<ProviderId>('r2');

// 当前服务商信息
const currentProviderInfo = computed(() => {
  return PROVIDERS.find(p => p.id === selectedProvider.value)!;
});

// 检查服务商配置是否完整（用于状态指示器）
const isProviderConfigured = (providerId: ProviderId): boolean => {
  const formData = props.formData;

  switch (providerId) {
    case 'r2': {
      const c = formData.r2;
      return !!(c.accountId && c.accessKeyId && c.secretAccessKey && c.bucketName && c.publicDomain);
    }
    case 'cos': {
      const c = formData.cos;
      return !!(c.secretId && c.secretKey && c.region && c.bucket && c.publicDomain);
    }
    case 'oss': {
      const c = formData.oss;
      return !!(c.accessKeyId && c.accessKeySecret && c.region && c.bucket && c.publicDomain);
    }
    case 'qiniu': {
      const c = formData.qiniu;
      return !!(c.accessKey && c.secretKey && c.region && c.bucket && c.domain);
    }
    case 'upyun': {
      const c = formData.upyun;
      return !!(c.operator && c.password && c.bucket && c.domain);
    }
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
      <!-- 服务描述 -->
      <div class="section-header">
        <h2>{{ currentProviderInfo.name }}</h2>
        <p class="section-desc">{{ currentProviderInfo.description }}</p>
      </div>

      <!-- R2 表单 -->
      <div v-if="selectedProvider === 'r2'" class="form-grid">
        <div class="form-item">
          <label>Account ID</label>
          <InputText v-model="formData.r2.accountId" @blur="handleSave" class="w-full" />
        </div>
        <div class="form-item">
          <label>Bucket Name</label>
          <InputText v-model="formData.r2.bucketName" @blur="handleSave" class="w-full" />
        </div>
        <div class="form-item">
          <label>Access Key ID</label>
          <Password v-model="formData.r2.accessKeyId" @blur="handleSave" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
        </div>
        <div class="form-item">
          <label>Secret Access Key</label>
          <Password v-model="formData.r2.secretAccessKey" @blur="handleSave" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
        </div>
        <div class="form-item span-full">
          <label>自定义路径 (Optional)</label>
          <InputText v-model="formData.r2.path" @blur="handleSave" placeholder="e.g. blog/images/" class="w-full" />
        </div>
        <div class="form-item span-full">
          <label>公开访问域名 (Public Domain)</label>
          <InputText v-model="formData.r2.publicDomain" @blur="handleSave" placeholder="https://images.example.com" class="w-full" />
        </div>
      </div>

      <!-- COS 表单 -->
      <div v-else-if="selectedProvider === 'cos'" class="form-grid">
        <div class="form-item">
          <label>Secret ID</label>
          <Password v-model="formData.cos.secretId" @blur="handleSave" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
        </div>
        <div class="form-item">
          <label>Secret Key</label>
          <Password v-model="formData.cos.secretKey" @blur="handleSave" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
        </div>
        <div class="form-item">
          <label>地域 (Region)</label>
          <InputText v-model="formData.cos.region" @blur="handleSave" placeholder="ap-guangzhou" class="w-full" />
        </div>
        <div class="form-item">
          <label>存储桶 (Bucket)</label>
          <InputText v-model="formData.cos.bucket" @blur="handleSave" class="w-full" />
        </div>
        <div class="form-item span-full">
          <label>自定义路径 (Optional)</label>
          <InputText v-model="formData.cos.path" @blur="handleSave" placeholder="e.g. blog/images/" class="w-full" />
        </div>
        <div class="form-item span-full">
          <label>公开访问域名 (Public Domain)</label>
          <InputText v-model="formData.cos.publicDomain" @blur="handleSave" placeholder="https://images.example.com" class="w-full" />
        </div>
      </div>

      <!-- OSS 表单 -->
      <div v-else-if="selectedProvider === 'oss'" class="form-grid">
        <div class="form-item">
          <label>Access Key ID</label>
          <Password v-model="formData.oss.accessKeyId" @blur="handleSave" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
        </div>
        <div class="form-item">
          <label>Access Key Secret</label>
          <Password v-model="formData.oss.accessKeySecret" @blur="handleSave" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
        </div>
        <div class="form-item">
          <label>地域 (Region)</label>
          <InputText v-model="formData.oss.region" @blur="handleSave" placeholder="oss-cn-hangzhou" class="w-full" />
        </div>
        <div class="form-item">
          <label>存储桶 (Bucket)</label>
          <InputText v-model="formData.oss.bucket" @blur="handleSave" class="w-full" />
        </div>
        <div class="form-item span-full">
          <label>自定义路径 (Optional)</label>
          <InputText v-model="formData.oss.path" @blur="handleSave" placeholder="e.g. blog/images/" class="w-full" />
        </div>
        <div class="form-item span-full">
          <label>公开访问域名 (Public Domain)</label>
          <InputText v-model="formData.oss.publicDomain" @blur="handleSave" placeholder="https://images.example.com" class="w-full" />
        </div>
      </div>

      <!-- 七牛云表单 -->
      <div v-else-if="selectedProvider === 'qiniu'" class="form-grid">
        <div class="form-item">
          <label>Access Key (AK)</label>
          <Password v-model="formData.qiniu.accessKey" @blur="handleSave" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
        </div>
        <div class="form-item">
          <label>Secret Key (SK)</label>
          <Password v-model="formData.qiniu.secretKey" @blur="handleSave" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
        </div>
        <div class="form-item">
          <label>地域 (Region)</label>
          <InputText v-model="formData.qiniu.region" @blur="handleSave" placeholder="cn-east-1" class="w-full" />
          <small class="field-hint">七牛云区域代码，如 cn-east-1、cn-south-1 等</small>
        </div>
        <div class="form-item">
          <label>存储桶 (Bucket)</label>
          <InputText v-model="formData.qiniu.bucket" @blur="handleSave" class="w-full" />
        </div>
        <div class="form-item span-full">
          <label>绑定域名 (Domain)</label>
          <InputText v-model="formData.qiniu.domain" @blur="handleSave" placeholder="https://images.example.com" class="w-full" />
        </div>
        <div class="form-item span-full">
          <label>自定义路径 (Optional)</label>
          <InputText v-model="formData.qiniu.path" @blur="handleSave" placeholder="e.g. blog/images/" class="w-full" />
        </div>
      </div>

      <!-- 又拍云表单 -->
      <div v-else-if="selectedProvider === 'upyun'" class="form-grid">
        <div class="form-item">
          <label>Operator</label>
          <Password v-model="formData.upyun.operator" @blur="handleSave" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
        </div>
        <div class="form-item">
          <label>Password</label>
          <Password v-model="formData.upyun.password" @blur="handleSave" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
        </div>
        <div class="form-item span-full">
          <label>存储桶 (Bucket)</label>
          <InputText v-model="formData.upyun.bucket" @blur="handleSave" class="w-full" />
        </div>
        <div class="form-item span-full">
          <label>绑定域名 (Domain)</label>
          <InputText v-model="formData.upyun.domain" @blur="handleSave" placeholder="https://images.example.com" class="w-full" />
        </div>
        <div class="form-item span-full">
          <label>自定义路径 (Optional)</label>
          <InputText v-model="formData.upyun.path" @blur="handleSave" placeholder="e.g. blog/images/" class="w-full" />
        </div>
      </div>

      <!-- 测试连接按钮 -->
      <div class="actions-row">
        <Button
          :label="`测试 ${currentProviderInfo.name} 连接`"
          icon="pi pi-check"
          @click="handleTest"
          :loading="isTesting"
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
  background: var(--bg-secondary);
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

.field-hint {
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
  border-top: 1px solid var(--border-subtle);
}

/* 响应式 */
@media (max-width: 768px) {
  .form-grid {
    grid-template-columns: 1fr;
  }

  .form-item.span-full {
    grid-column: 1;
  }
}
</style>
