<script setup lang="ts">
import { ref } from 'vue';
import InputText from 'primevue/inputtext';
import HostingCard from '../HostingCard.vue';
import SensitiveField from '../../common/SensitiveField.vue';
import type { ServiceHealthStatus } from '../../../types/serviceHealth';
import type { CustomS3Profile, WebDAVStorageProfile } from '../../../config/types';
import { makeCustomS3Id, makeWebDAVId, DEFAULT_WEBDAV_URL_TEMPLATE } from '../../../config/types';
import { hasNonEmptyFields } from '../../../utils/validators';
import { secureStorage } from '../../../security/crypto';
import { createLogger } from '../../../utils/logger';

const log = createLogger('PrivateStorage');

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
    id: 'r2', name: 'Cloudflare R2', description: '零出口费用的对象存储',
    requiredKeys: ['accountId', 'accessKeyId', 'secretAccessKey', 'bucketName', 'publicDomain'],
    fields: [
      { key: 'accountId', label: 'Account ID', type: 'text' },
      { key: 'bucketName', label: 'Bucket Name', type: 'text' },
      { key: 'accessKeyId', label: 'Access Key ID', type: 'password', placeholder: '输入 Access Key ID' },
      { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', placeholder: '输入 Secret Access Key' },
      { key: 'path', label: '自定义路径 (Optional)', type: 'text', placeholder: 'e.g. blog/images/', spanFull: true },
      { key: 'publicDomain', label: '公开访问域名 (Public Domain)', type: 'text', placeholder: 'https://images.example.com', spanFull: true, hint: '公开图片链接仅支持 HTTPS' },
    ],
  },
  {
    id: 'tencent', name: '腾讯云', description: '腾讯云对象存储',
    requiredKeys: ['secretId', 'secretKey', 'region', 'bucket'],
    fields: [
      { key: 'secretId', label: 'Secret ID', type: 'password', placeholder: '输入 SecretId' },
      { key: 'secretKey', label: 'Secret Key', type: 'password', placeholder: '输入 SecretKey' },
      { key: 'region', label: '地域 (Region)', type: 'text', placeholder: 'ap-guangzhou' },
      { key: 'bucket', label: '存储桶 (Bucket)', type: 'text' },
      { key: 'path', label: '自定义路径 (Optional)', type: 'text', placeholder: 'e.g. blog/images/', spanFull: true },
      { key: 'publicDomain', label: '公开访问域名 (Optional)', type: 'text', placeholder: 'https://images.example.com', spanFull: true, hint: '留空时使用腾讯云 COS 默认访问域名；自定义域名仅支持 HTTPS' },
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
      { key: 'publicDomain', label: '公开访问域名 (Public Domain)', type: 'text', placeholder: 'https://images.example.com', spanFull: true, hint: '公开图片链接仅支持 HTTPS' },
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
      { key: 'publicDomain', label: '公开访问域名 (Public Domain)', type: 'text', placeholder: 'https://images.example.com', spanFull: true, hint: '公开图片链接仅支持 HTTPS' },
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
      { key: 'publicDomain', label: '公开访问域名 (Public Domain)', type: 'text', placeholder: 'https://images.example.com', spanFull: true, hint: '公开图片链接仅支持 HTTPS' },
      { key: 'path', label: '自定义路径 (Optional)', type: 'text', placeholder: 'e.g. blog/images/', spanFull: true },
    ],
  },
];

const CUSTOM_S3_FIELDS: FieldConfig[] = [
  { key: 'name', label: '显示名称', type: 'text', placeholder: '如：我的 MinIO', spanFull: true },
  { key: 'endpoint', label: 'Endpoint (端点地址)', type: 'text', placeholder: 'https://s3.amazonaws.com', spanFull: true, hint: '完整的 S3 兼容端点 URL；外部服务仅支持 HTTPS' },
  { key: 'accessKeyId', label: 'Access Key ID', type: 'password', placeholder: '输入 Access Key ID' },
  { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', placeholder: '输入 Secret Access Key' },
  { key: 'region', label: '地域 (Region)', type: 'text', placeholder: 'us-east-1' },
  { key: 'bucket', label: '存储桶 (Bucket)', type: 'text' },
  { key: 'path', label: '自定义路径 (Optional)', type: 'text', placeholder: 'e.g. blog/images/', spanFull: true },
  { key: 'publicDomain', label: '公开访问域名 (Optional)', type: 'text', placeholder: 'https://cdn.example.com', spanFull: true, hint: '留空则使用 Endpoint 构建访问链接；填写时仅支持 HTTPS' },
];
const CUSTOM_S3_REQUIRED_KEYS = ['endpoint', 'accessKeyId', 'secretAccessKey', 'region', 'bucket'];

const WEBDAV_FIELDS: FieldConfig[] = [
  { key: 'name', label: '显示名称', type: 'text', placeholder: '如：家里的 NAS', spanFull: true },
  { key: 'url', label: 'WebDAV 地址', type: 'text', placeholder: 'https://dav.example.com/dav', spanFull: true, hint: '局域网地址可用 HTTP（如 http://192.168.1.10:5005），公网地址仅支持 HTTPS' },
  { key: 'username', label: '用户名', type: 'text' },
  { key: 'password', label: '密码', type: 'password' },
  { key: 'remotePath', label: '图片目录', type: 'text', placeholder: 'images/', spanFull: true, hint: '建议与备份目录分开，避免图片和配置混在一起' },
  { key: 'publicDomain', label: '公开访问域名', type: 'text', placeholder: 'https://cdn.example.com', spanFull: true, hint: '必填。WebDAV 地址本身通常需要登录，不能直接当图片链接用' },
  { key: 'publicUrlTemplate', label: '链接模板', type: 'text', placeholder: DEFAULT_WEBDAV_URL_TEMPLATE, spanFull: true, hint: '可用变量：{domain} {path} {filename}。OpenList / Alist 一般填 {domain}/d/挂载点/{path}' },
];
const WEBDAV_REQUIRED_KEYS = ['url', 'username', 'passwordEncrypted', 'publicDomain'];

// NOTE: privateFormData 通过引用传递，子组件直接修改嵌套属性是有意为之的设计
// 父组件（HostingSettingsPanel）负责监听 save 事件触发持久化
const props = defineProps<{
  privateFormData: PrivateFormData;
  customS3Profiles: CustomS3Profile[];
  webdavProfiles: WebDAVStorageProfile[];
  testingConnections: Record<string, boolean>;
  healthStatusMap: Record<string, ServiceHealthStatus>;
  healthTooltipMap: Record<string, string>;
  refreshingServiceIds: Set<string>;
  targetCardId?: string | null;
}>();

const emit = defineEmits<{
  save: [];
  testPrivate: [providerId: string];
  deleteCustomS3: [profileId: string];
  updateCustomS3: [profile: CustomS3Profile];
  deleteWebdav: [profileId: string];
  updateWebdav: [profile: WebDAVStorageProfile];
}>();

function isConfigured(svc: ServiceConfig): boolean {
  return hasNonEmptyFields(
    props.privateFormData[svc.id] as unknown as Record<string, unknown>,
    svc.requiredKeys,
  );
}

function isCustomS3Configured(profile: CustomS3Profile): boolean {
  return hasNonEmptyFields(profile as unknown as Record<string, unknown>, CUSTOM_S3_REQUIRED_KEYS);
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

// ---- WebDAV ----

function isWebDAVConfigured(profile: WebDAVStorageProfile): boolean {
  return hasNonEmptyFields(profile as unknown as Record<string, unknown>, WEBDAV_REQUIRED_KEYS);
}

function getWebDAVField(profile: WebDAVStorageProfile, key: string): string {
  return (profile[key as keyof WebDAVStorageProfile] as string) || '';
}

function setWebDAVField(profileId: string, key: string, value: string) {
  const profile = props.webdavProfiles.find(p => p.id === profileId);
  if (profile) {
    emit('updateWebdav', { ...profile, [key]: value });
  }
}

/**
 * 明文密码只在输入框里活一瞬：失焦即加密写入 passwordEncrypted，随后清空草稿。
 * 这样明文既不进 formData 也不落盘。留空表示"不修改已保存的密码"。
 */
const webdavPasswordDrafts = ref<Record<string, string>>({});

function setWebDAVPasswordDraft(profileId: string, value: string) {
  webdavPasswordDrafts.value[profileId] = value;
}

async function commitWebDAVPassword(profileId: string) {
  const draft = webdavPasswordDrafts.value[profileId];
  if (!draft) return;

  const profile = props.webdavProfiles.find(p => p.id === profileId);
  if (!profile) return;

  try {
    const passwordEncrypted = await secureStorage.encrypt(draft);
    emit('updateWebdav', { ...profile, passwordEncrypted });
    webdavPasswordDrafts.value[profileId] = '';
    emit('save');
  } catch (error) {
    log.error('WebDAV 密码加密失败', error);
  }
}

function webdavPasswordPlaceholder(profile: WebDAVStorageProfile): string {
  return profile.passwordEncrypted ? '留空则不修改' : '输入 WebDAV 密码';
}

/**
 * 点眼睛时才解密，明文只在 SensitiveField 的只读展示态里活 15 秒
 *
 * Why 不在渲染时就解密好放着：那等于把明文常驻内存，和「密文常驻、明文按需」
 * 的设计背道而驰。空输入框 + 「已保存」标记负责回答"有没有"，
 * 想知道"是什么"必须是一次显式的用户动作。
 */
function makeWebDAVPasswordRevealer(profile: WebDAVStorageProfile): (() => Promise<string>) | null {
  if (!profile.passwordEncrypted) return null;
  return () => secureStorage.decrypt(profile.passwordEncrypted as string);
}

function handleWebDAVRevealError(error: unknown): void {
  log.error('WebDAV 密码解密失败，无法查看', error);
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
      :is-refreshing="refreshingServiceIds.has(svc.id)"
      @test="emit('testPrivate', $event)"
    >
      <form class="form-grid" @submit.prevent>
        <div
          v-for="field in svc.fields"
          :key="field.key"
          class="form-item"
          :class="{ 'span-full': field.spanFull }"
        >
          <label>{{ field.label }}</label>
          <SensitiveField
            v-if="field.type === 'password'"
            :modelValue="getFieldModel(svc.id, field.key)"
            @update:modelValue="setFieldModel(svc.id, field.key, $event)"
            @blur="emit('save')"
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
      </form>
    </HostingCard>

    <!-- 自定义 S3 多实例 -->
    <HostingCard
      v-for="profile in customS3Profiles"
      :key="makeCustomS3Id(profile.id)"
      :id="makeCustomS3Id(profile.id)"
      :force-expand="targetCardId === makeCustomS3Id(profile.id)"
      :name="profile.name || '自定义 S3'"
      description="对接其他 S3 协议云存储"
      :isConfigured="isCustomS3Configured(profile)"
      :health-status="healthStatusMap[makeCustomS3Id(profile.id)]"
      :health-tooltip="healthTooltipMap[makeCustomS3Id(profile.id)]"
      :isTesting="testingConnections[makeCustomS3Id(profile.id)]"
      :is-refreshing="refreshingServiceIds.has(makeCustomS3Id(profile.id))"
      @test="emit('testPrivate', $event)"
    >
      <form class="form-grid" @submit.prevent>
        <div
          v-for="field in CUSTOM_S3_FIELDS"
          :key="field.key"
          class="form-item"
          :class="{ 'span-full': field.spanFull }"
        >
          <label>{{ field.label }}</label>
          <SensitiveField
            v-if="field.type === 'password'"
            :modelValue="getCustomS3Field(profile, field.key)"
            @update:modelValue="setCustomS3Field(profile.id, field.key, $event)"
            @blur="emit('save')"
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
      </form>
      <template #actions-right>
        <button class="delete-profile-btn" @click.stop="emit('deleteCustomS3', profile.id)">
          <i class="pi pi-trash"></i>
          <span>删除此配置</span>
        </button>
      </template>
    </HostingCard>

    <!-- WebDAV 图床多实例 -->
    <HostingCard
      v-for="profile in webdavProfiles"
      :key="makeWebDAVId(profile.id)"
      :id="makeWebDAVId(profile.id)"
      :force-expand="targetCardId === makeWebDAVId(profile.id)"
      :name="profile.name || 'WebDAV'"
      description="把图片存到自己的 WebDAV 网盘或 NAS"
      :isConfigured="isWebDAVConfigured(profile)"
      :health-status="healthStatusMap[makeWebDAVId(profile.id)]"
      :health-tooltip="healthTooltipMap[makeWebDAVId(profile.id)]"
      :isTesting="testingConnections[makeWebDAVId(profile.id)]"
      :is-refreshing="refreshingServiceIds.has(makeWebDAVId(profile.id))"
      @test="emit('testPrivate', $event)"
    >
      <form class="form-grid" @submit.prevent>
        <div
          v-for="field in WEBDAV_FIELDS"
          :key="field.key"
          class="form-item"
          :class="{ 'span-full': field.spanFull }"
        >
          <label>
            {{ field.label }}
            <span v-if="field.key === 'password' && profile.passwordEncrypted" class="saved-chip">
              <i class="pi pi-check" aria-hidden="true"></i>已保存
            </span>
          </label>
          <SensitiveField
            v-if="field.key === 'password'"
            :modelValue="webdavPasswordDrafts[profile.id] ?? ''"
            @update:modelValue="setWebDAVPasswordDraft(profile.id, $event)"
            @blur="commitWebDAVPassword(profile.id)"
            :placeholder="webdavPasswordPlaceholder(profile)"
            :has-stored-value="!!profile.passwordEncrypted"
            :reveal-stored="makeWebDAVPasswordRevealer(profile)"
            @reveal-error="handleWebDAVRevealError"
          />
          <InputText
            v-else
            :modelValue="getWebDAVField(profile, field.key)"
            @update:modelValue="setWebDAVField(profile.id, field.key, $event ?? '')"
            @blur="emit('save')"
            :placeholder="field.placeholder"
            class="w-full"
          />
          <small v-if="field.hint" class="field-hint">{{ field.hint }}</small>
        </div>
      </form>
      <template #actions-right>
        <button class="delete-profile-btn" @click.stop="emit('deleteWebdav', profile.id)">
          <i class="pi pi-trash"></i>
          <span>删除此配置</span>
        </button>
      </template>
    </HostingCard>

  </div>
</template>

<style scoped>
@import url('../../../styles/settings-shared.css');

.delete-profile-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs-sm);
  padding: var(--space-xs-sm) var(--space-md);
  background: none;
  border: 1px solid var(--error-alpha-20);
  border-radius: var(--radius-sm-md);
  color: var(--error);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: all var(--duration-fast) ease;
}

.delete-profile-btn:hover {
  background: var(--error-alpha-8);
}

/*
 * 「已保存」标记
 *
 * Why 不用灰 placeholder 传达：输入框是空的这个视觉信号，分量远大于框内一行灰字。
 * 而「密码存着呢」和「密码丢了」长得一模一样时，用户没法判断——a322dba 修的
 * 正是"保存后密码被静默清空"，这两种状态必须一眼可分。
 */
.saved-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  margin-left: var(--space-xs-sm);
  padding: 0 var(--space-xs-sm);
  border-radius: var(--radius-sm-md);
  background: var(--success-alpha-12);
  color: var(--success);
  font-size: var(--text-2xs);
  font-weight: var(--weight-medium);
}

.saved-chip i {
  font-size: var(--text-2xs);
}
</style>
