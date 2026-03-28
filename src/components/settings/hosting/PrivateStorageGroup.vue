<script setup lang="ts">
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import HostingCard from '../HostingCard.vue';
import type { ServiceHealthStatus } from '../../../types/serviceHealth';
import type { CustomS3Profile } from '../../../config/types';
import { makeCustomS3Id } from '../../../config/types';

interface PrivateFormData {
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucketName: string; path: string; publicDomain: string };
  tencent: { secretId: string; secretKey: string; region: string; bucket: string; path: string; publicDomain: string };
  aliyun: { accessKeyId: string; accessKeySecret: string; region: string; bucket: string; path: string; publicDomain: string };
  qiniu: { accessKey: string; secretKey: string; region: string; bucket: string; publicDomain: string; path: string };
  upyun: { operator: string; password: string; bucket: string; publicDomain: string; path: string };
}

type PrivateProviderId = keyof PrivateFormData;

interface FieldConfig {
  key: string;
  label: string;
  type: 'text' | 'password';
  placeholder?: string;
  hint?: string;
  spanFull?: boolean;
}

interface ServiceConfig {
  id: PrivateProviderId;
  name: string;
  description: string;
  fields: FieldConfig[];
  requiredKeys: string[];
}

const PRIVATE_SERVICES: ServiceConfig[] = [
  {
    id: 'r2', name: 'Cloudflare R2', description: 'S3 兼容的高速存储',
    requiredKeys: ['accountId', 'accessKeyId', 'secretAccessKey', 'bucketName', 'publicDomain'],
    fields: [
      { key: 'accountId', label: 'Account ID', type: 'text' },
      { key: 'bucketName', label: 'Bucket Name', type: 'text' },
      { key: 'accessKeyId', label: 'Access Key ID', type: 'password', placeholder: '输入 Access Key ID' },
      { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', placeholder: '输入 Secret Access Key' },
      { key: 'path', label: '自定义路径 (Optional)', type: 'text', placeholder: 'e.g. blog/images/', spanFull: true },
      { key: 'publicDomain', label: '公开访问域名 (Public Domain)', type: 'text', placeholder: 'https://images.example.com', spanFull: true },
    ],
  },
  {
    id: 'tencent', name: '腾讯云', description: '腾讯云对象存储',
    requiredKeys: ['secretId', 'secretKey', 'region', 'bucket', 'publicDomain'],
    fields: [
      { key: 'secretId', label: 'Secret ID', type: 'password', placeholder: '输入 SecretId' },
      { key: 'secretKey', label: 'Secret Key', type: 'password', placeholder: '输入 SecretKey' },
      { key: 'region', label: '地域 (Region)', type: 'text', placeholder: 'ap-guangzhou' },
      { key: 'bucket', label: '存储桶 (Bucket)', type: 'text' },
      { key: 'path', label: '自定义路径 (Optional)', type: 'text', placeholder: 'e.g. blog/images/', spanFull: true },
      { key: 'publicDomain', label: '公开访问域名 (Public Domain)', type: 'text', placeholder: 'https://images.example.com', spanFull: true },
    ],
  },
  {
    id: 'aliyun', name: '阿里云', description: '阿里云对象存储',
    requiredKeys: ['accessKeyId', 'accessKeySecret', 'region', 'bucket', 'publicDomain'],
    fields: [
      { key: 'accessKeyId', label: 'Access Key ID', type: 'password', placeholder: '输入 AccessKey ID' },
      { key: 'accessKeySecret', label: 'Access Key Secret', type: 'password', placeholder: '输入 AccessKey Secret' },
      { key: 'region', label: '地域 (Region)', type: 'text', placeholder: 'oss-cn-hangzhou' },
      { key: 'bucket', label: '存储桶 (Bucket)', type: 'text' },
      { key: 'path', label: '自定义路径 (Optional)', type: 'text', placeholder: 'e.g. blog/images/', spanFull: true },
      { key: 'publicDomain', label: '公开访问域名 (Public Domain)', type: 'text', placeholder: 'https://images.example.com', spanFull: true },
    ],
  },
  {
    id: 'qiniu', name: '七牛云', description: '七牛云对象存储',
    requiredKeys: ['accessKey', 'secretKey', 'region', 'bucket', 'publicDomain'],
    fields: [
      { key: 'accessKey', label: 'Access Key (AK)', type: 'password', placeholder: '输入 Access Key' },
      { key: 'secretKey', label: 'Secret Key (SK)', type: 'password', placeholder: '输入 Secret Key' },
      { key: 'region', label: '地域 (Region)', type: 'text', placeholder: 'cn-east-1', hint: '七牛云区域代码，如 cn-east-1、cn-south-1 等' },
      { key: 'bucket', label: '存储桶 (Bucket)', type: 'text' },
      { key: 'publicDomain', label: '公开访问域名 (Public Domain)', type: 'text', placeholder: 'https://images.example.com', spanFull: true },
      { key: 'path', label: '自定义路径 (Optional)', type: 'text', placeholder: 'e.g. blog/images/', spanFull: true },
    ],
  },
  {
    id: 'upyun', name: '又拍云', description: '又拍云对象存储',
    requiredKeys: ['operator', 'password', 'bucket', 'publicDomain'],
    fields: [
      { key: 'operator', label: 'Operator', type: 'password', placeholder: '操作员账号' },
      { key: 'password', label: 'Password', type: 'password', placeholder: '操作员密码' },
      { key: 'bucket', label: '存储桶 (Bucket)', type: 'text', spanFull: true },
      { key: 'publicDomain', label: '公开访问域名 (Public Domain)', type: 'text', placeholder: 'https://images.example.com', spanFull: true },
      { key: 'path', label: '自定义路径 (Optional)', type: 'text', placeholder: 'e.g. blog/images/', spanFull: true },
    ],
  },
];

const CUSTOM_S3_FIELDS: FieldConfig[] = [
  { key: 'name', label: '显示名称', type: 'text', placeholder: '如：我的 MinIO', spanFull: true },
  { key: 'endpoint', label: 'Endpoint (端点地址)', type: 'text', placeholder: 'https://s3.amazonaws.com', spanFull: true, hint: '完整的 S3 兼容端点 URL，包含协议前缀' },
  { key: 'accessKeyId', label: 'Access Key ID', type: 'password', placeholder: '输入 Access Key ID' },
  { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', placeholder: '输入 Secret Access Key' },
  { key: 'region', label: '地域 (Region)', type: 'text', placeholder: 'us-east-1' },
  { key: 'bucket', label: '存储桶 (Bucket)', type: 'text' },
  { key: 'path', label: '自定义路径 (Optional)', type: 'text', placeholder: 'e.g. blog/images/', spanFull: true },
  { key: 'publicDomain', label: '公开访问域名 (Optional)', type: 'text', placeholder: 'https://cdn.example.com', spanFull: true, hint: '留空则使用 Endpoint 构建访问链接' },
];
const CUSTOM_S3_REQUIRED_KEYS = ['endpoint', 'accessKeyId', 'secretAccessKey', 'region', 'bucket'];

// NOTE: privateFormData 通过引用传递，子组件直接修改嵌套属性是有意为之的设计
// 父组件（HostingSettingsPanel）负责监听 save 事件触发持久化
const props = defineProps<{
  privateFormData: PrivateFormData;
  customS3Profiles: CustomS3Profile[];
  testingConnections: Record<string, boolean>;
  healthStatusMap: Record<string, ServiceHealthStatus>;
  healthTooltipMap: Record<string, string>;
  targetCardId?: string | null;
}>();

const emit = defineEmits<{
  save: [];
  testPrivate: [providerId: string];
  addCustomS3: [];
  deleteCustomS3: [profileId: string];
  updateCustomS3: [profile: CustomS3Profile];
}>();

function isConfigured(svc: ServiceConfig): boolean {
  const data = props.privateFormData[svc.id] as Record<string, string>;
  return svc.requiredKeys.every(k => !!data[k]?.trim());
}

function isCustomS3Configured(profile: CustomS3Profile): boolean {
  return CUSTOM_S3_REQUIRED_KEYS.every(k => !!(profile[k as keyof CustomS3Profile] as string)?.trim());
}

function getCustomS3Field(profile: CustomS3Profile, key: string): string {
  return (profile[key as keyof CustomS3Profile] as string) || '';
}

function setCustomS3Field(profileId: string, key: string, value: string) {
  const profile = props.customS3Profiles.find(p => p.id === profileId);
  if (profile) {
    emit('updateCustomS3', { ...profile, [key]: value });
  }
}

function getFieldModel(svcId: PrivateProviderId, fieldKey: string) {
  return (props.privateFormData[svcId] as Record<string, string>)[fieldKey];
}

function setFieldModel(svcId: PrivateProviderId, fieldKey: string, value: string) {
  (props.privateFormData[svcId] as Record<string, string>)[fieldKey] = value;
}
</script>

<template>
  <div class="provider-grid">
    <HostingCard
      v-for="svc in PRIVATE_SERVICES"
      :key="svc.id"
      :id="svc.id"
      :force-expand="targetCardId === svc.id"
      :name="svc.name"
      :description="svc.description"
      :isConfigured="isConfigured(svc)"
      :health-status="healthStatusMap[svc.id]"
      :health-tooltip="healthTooltipMap[svc.id]"
      :isTesting="testingConnections[svc.id]"
      @test="emit('testPrivate', $event)"
    >
      <div class="form-grid">
        <div
          v-for="field in svc.fields"
          :key="field.key"
          class="form-item"
          :class="{ 'span-full': field.spanFull }"
        >
          <label>{{ field.label }}</label>
          <Password
            v-if="field.type === 'password'"
            :modelValue="getFieldModel(svc.id, field.key)"
            @update:modelValue="setFieldModel(svc.id, field.key, $event)"
            @blur="emit('save')"
            :feedback="false"
            toggleMask
            fluid
            :placeholder="field.placeholder"
          />
          <InputText
            v-else
            :modelValue="getFieldModel(svc.id, field.key)"
            @update:modelValue="setFieldModel(svc.id, field.key, $event ?? '')"
            @blur="emit('save')"
            :placeholder="field.placeholder"
            class="w-full"
          />
          <small v-if="field.hint" class="field-hint">{{ field.hint }}</small>
        </div>
      </div>
    </HostingCard>

    <!-- 自定义 S3 多实例 -->
    <HostingCard
      v-for="profile in customS3Profiles"
      :key="makeCustomS3Id(profile.id)"
      :id="makeCustomS3Id(profile.id)"
      :force-expand="targetCardId === makeCustomS3Id(profile.id)"
      :name="profile.name || '自定义 S3'"
      description="S3 兼容存储"
      :isConfigured="isCustomS3Configured(profile)"
      :health-status="healthStatusMap[makeCustomS3Id(profile.id)]"
      :health-tooltip="healthTooltipMap[makeCustomS3Id(profile.id)]"
      :isTesting="testingConnections[makeCustomS3Id(profile.id)]"
      @test="emit('testPrivate', $event)"
    >
      <div class="form-grid">
        <div
          v-for="field in CUSTOM_S3_FIELDS"
          :key="field.key"
          class="form-item"
          :class="{ 'span-full': field.spanFull }"
        >
          <label>{{ field.label }}</label>
          <Password
            v-if="field.type === 'password'"
            :modelValue="getCustomS3Field(profile, field.key)"
            @update:modelValue="setCustomS3Field(profile.id, field.key, $event)"
            @blur="emit('save')"
            :feedback="false"
            toggleMask
            fluid
            :placeholder="field.placeholder"
          />
          <InputText
            v-else
            :modelValue="getCustomS3Field(profile, field.key)"
            @update:modelValue="setCustomS3Field(profile.id, field.key, $event ?? '')"
            @blur="emit('save')"
            :placeholder="field.placeholder"
            class="w-full"
          />
          <small v-if="field.hint" class="field-hint">{{ field.hint }}</small>
        </div>
      </div>
      <div class="custom-s3-delete">
        <button class="delete-profile-btn" @click.stop="emit('deleteCustomS3', profile.id)">
          <i class="pi pi-trash"></i>
          <span>删除此配置</span>
        </button>
      </div>
    </HostingCard>

    <button class="add-custom-s3-btn" @click="emit('addCustomS3')">
      <i class="pi pi-plus"></i>
      <span>添加自定义 S3</span>
    </button>
  </div>
</template>

<style scoped>
@import '../../../styles/settings-shared.css';

.custom-s3-delete {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}

.delete-profile-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: none;
  border: 1px solid var(--error-alpha-20);
  border-radius: 6px;
  color: var(--error);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.delete-profile-btn:hover {
  background: var(--error-alpha-8);
}

.add-custom-s3-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 10px;
  background: none;
  border: 1px dashed var(--border-subtle);
  border-radius: 8px;
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.add-custom-s3-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-alpha-6);
}
</style>
