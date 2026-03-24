<script setup lang="ts">
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import HostingCard from '../HostingCard.vue';
import type { ServiceHealthStatus } from '../../../types/serviceHealth';

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

// NOTE: privateFormData 通过引用传递，子组件直接修改嵌套属性是有意为之的设计
// 父组件（HostingSettingsPanel）负责监听 save 事件触发持久化
const props = defineProps<{
  privateFormData: PrivateFormData;
  testingConnections: Record<string, boolean>;
  healthStatusMap: Record<string, ServiceHealthStatus>;
  healthTooltipMap: Record<string, string>;
  targetCardId?: string | null;
}>();

const emit = defineEmits<{
  save: [];
  testPrivate: [providerId: string];
}>();

function isConfigured(svc: ServiceConfig): boolean {
  const data = props.privateFormData[svc.id] as Record<string, string>;
  return svc.requiredKeys.every(k => !!data[k]?.trim());
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
  </div>
</template>
