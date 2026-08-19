<script setup lang="ts">
import InputText from 'primevue/inputtext';
import ToggleSwitch from 'primevue/toggleswitch';
import HostingCard from '../HostingCard.vue';
import SensitiveField from '../../common/SensitiveField.vue';
import R2ThumbnailProxySection from './R2ThumbnailProxySection.vue';
import type { ServiceHealthStatus } from '../../../types/serviceHealth';
import type { CustomS3Profile, WebDAVStorageProfile } from '../../../config/types';
import { makeCustomS3Id, makeWebDAVId, DEFAULT_WEBDAV_URL_TEMPLATE } from '../../../config/types';
import { hasNonEmptyFields } from '../../../utils/validators';
import { secureStorage } from '../../../security/crypto';
import { createLogger } from '../../../utils/logger';
import { useSensitiveDraft } from '../../../composables/settings/useSensitiveDraft';

const log = createLogger('PrivateStorage');

interface PrivateFormData {
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucketName: string; path: string; publicDomain: string; thumbnailProxyEnabled?: boolean };
  tencent: { secretId: string; secretKey: string; region: string; bucket: string; path: string; publicDomain: string };
  aliyun: { accessKeyId: string; accessKeySecret: string; region: string; bucket: string; path: string; publicDomain: string };
  qiniu: { accessKey: string; secretKey: string; region: string; bucket: string; publicDomain: string; path: string };
  upyun: { operator: string; password: string; bucket: string; publicDomain: string; path: string; s3AccessKey: string; s3SecretKey: string };
}

type PrivateProviderId = keyof PrivateFormData;

interface FieldConfig {
  key: string;
  label: string;
  type: 'text' | 'password';
  placeholder?: string;
  /** 字段下方常驻显示的说明。短句用它 */
  hint?: string;
  /** 收进 label 右侧图标、hover 才展开的说明。三行以上的长说明用它，避免挤开后面的字段 */
  hintTooltip?: string;
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
      { key: 'publicDomain', label: '公开访问域名 (Public Domain)', type: 'text', placeholder: 'https://images.example.com', spanFull: true, hint: '建议填 HTTPS。填 HTTP 会要求确认一次——图床只给 HTTP 域名时（如又拍云测试域名）可以这么用' },
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
      { key: 'publicDomain', label: '公开访问域名 (Optional)', type: 'text', placeholder: 'https://images.example.com', spanFull: true, hint: '留空时使用腾讯云 COS 默认访问域名。自定义域名建议填 HTTPS，填 HTTP 会要求确认一次' },
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
      { key: 'publicDomain', label: '公开访问域名 (Public Domain)', type: 'text', placeholder: 'https://images.example.com', spanFull: true, hint: '建议填 HTTPS。填 HTTP 会要求确认一次——图床只给 HTTP 域名时（如又拍云测试域名）可以这么用' },
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
      { key: 'publicDomain', label: '公开访问域名 (Public Domain)', type: 'text', placeholder: 'https://images.example.com', spanFull: true, hint: '建议填 HTTPS。填 HTTP 会要求确认一次——图床只给 HTTP 域名时（如又拍云测试域名）可以这么用' },
      { key: 'path', label: '自定义路径 (Optional)', type: 'text', placeholder: 'e.g. blog/images/', spanFull: true },
    ],
  },
  {
    id: 'upyun', name: '又拍云', description: '又拍云对象存储',
    requiredKeys: ['operator', 'password', 'bucket', 'publicDomain', 's3AccessKey', 's3SecretKey'],
    fields: [
      { key: 'operator', label: 'Operator', type: 'password', placeholder: '操作员账号' },
      { key: 'password', label: 'Password', type: 'password', placeholder: '操作员密码' },
      { key: 's3AccessKey', label: 'S3 AccessKey', type: 'password', placeholder: '控制台单独生成，非操作员账号', hintTooltip: '又拍云的 S3 凭证与上面的操作员账号密码是两回事，需在控制台「操作员授权 → S3 访问凭证」单独获取。软件内上传用这一对，Typora / Obsidian 用上面那一对。' },
      { key: 's3SecretKey', label: 'S3 SecretKey', type: 'password', placeholder: '控制台单独生成，非操作员密码' },
      { key: 'bucket', label: '存储桶 (Bucket)', type: 'text', spanFull: true },
      { key: 'publicDomain', label: '公开访问域名 (Public Domain)', type: 'text', placeholder: 'https://images.example.com', spanFull: true, hint: '建议填 HTTPS。填 HTTP 会要求确认一次——图床只给 HTTP 域名时（如又拍云测试域名）可以这么用' },
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
  { key: 'publicDomain', label: '公开访问域名 (Optional)', type: 'text', placeholder: 'https://cdn.example.com', spanFull: true, hint: '留空则使用 Endpoint 构建访问链接。建议填 HTTPS，填 HTTP 会要求确认一次' },
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

/**
 * 与 setFieldModel 同样是就地改 props 上的表单对象（父组件传下来的是同一个响应式对象）
 *
 * 写法刻意与 setFieldModel 保持一致：经 `as` 断言再赋值，既表达"这里是有意的就地写入"，
 * 也让 vue/no-mutating-props 不把它当成模板里的误写。
 */
function setR2ThumbnailProxy(value: boolean) {
  (props.privateFormData.r2 as Record<string, unknown>).thumbnailProxyEnabled = value;
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

/** `!== false`：老 profile 没这个字段，缺省要显示为「已开启」 */
function isUniqueFileNameOn(profile: WebDAVStorageProfile): boolean {
  return profile.uniqueFileName !== false;
}

function setUniqueFileName(profileId: string, value: boolean) {
  const profile = props.webdavProfiles.find(p => p.id === profileId);
  if (profile) {
    emit('updateWebdav', { ...profile, uniqueFileName: value });
    emit('save');
  }
}

// ---- 敏感字段：密文常驻、明文按需 ----

/**
 * 三组密钥共用一张草稿表，用 key 前缀分流：
 *
 *   builtin:<服务>:<字段>    内置 S3 —— 明文存在 formData 里
 *   customS3:<配置>:<字段>   自定义 S3 —— 明文存在 profile 里
 *   webdav:<配置>            WebDAV 图床密码 —— 密文存在 passwordEncrypted
 *
 * 三者只有"取值"和"存值"两步不同，收在下面三个回调里；模板侧看到的是同一套接口。
 *
 * Why 明文那两类也要走这套：统一规则管的是界面契约——存过之后只显示「有没有」，
 * 不显示「是什么」。跟底下存的是密文还是明文无关。
 */
const builtinKey = (svcId: PrivateProviderId, field: string) => `builtin:${svcId}:${field}`;
const customS3Key = (profileId: string, field: string) => `customS3:${profileId}:${field}`;
const webdavKey = (profileId: string) => `webdav:${profileId}`;

type SecretRef =
  | { kind: 'builtin'; svcId: PrivateProviderId; field: string }
  | { kind: 'customS3'; profileId: string; field: string }
  | { kind: 'webdav'; profileId: string };

function parseSecretKey(key: string): SecretRef | null {
  const [kind, first, second] = key.split(':');
  if (kind === 'builtin' && first && second) {
    return { kind, svcId: first as PrivateProviderId, field: second };
  }
  if (kind === 'customS3' && first && second) {
    return { kind, profileId: first, field: second };
  }
  if (kind === 'webdav' && first) {
    return { kind, profileId: first };
  }
  return null;
}

/** WebDAV 返回的是密文，另外两类返回的就是明文本身 */
function storedValueOf(target: SecretRef): string {
  if (target.kind === 'builtin') {
    return getFieldModel(target.svcId, target.field) || '';
  }
  if (target.kind === 'customS3') {
    const profile = props.customS3Profiles.find(p => p.id === target.profileId);
    return profile ? getCustomS3Field(profile, target.field) : '';
  }
  const profile = props.webdavProfiles.find(p => p.id === target.profileId);
  return profile?.passwordEncrypted || '';
}

const secrets = useSensitiveDraft({
  hasStored: key => {
    const target = parseSecretKey(key);
    return !!target && !!storedValueOf(target);
  },

  reveal: async key => {
    const target = parseSecretKey(key);
    if (!target) return '';
    const stored = storedValueOf(target);
    return target.kind === 'webdav' ? await secureStorage.decrypt(stored) : stored;
  },

  commit: async (key, draft) => {
    const target = parseSecretKey(key);
    if (!target) return;

    if (target.kind === 'builtin') {
      setFieldModel(target.svcId, target.field, draft);
    } else if (target.kind === 'customS3') {
      setCustomS3Field(target.profileId, target.field, draft);
    } else {
      const profile = props.webdavProfiles.find(p => p.id === target.profileId);
      if (!profile) return;
      // 明文只在输入框里活一瞬：加密后写 passwordEncrypted，明文不进 profile 也不落盘
      const passwordEncrypted = await secureStorage.encrypt(draft);
      emit('updateWebdav', { ...profile, passwordEncrypted });
    }

    emit('save');
  },

  onRevealError: error => log.error('敏感字段解密失败，无法查看', error),
  onCommitError: error => log.error('敏感字段保存失败', error),
});
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
          <label>
            {{ field.label }}
            <span
              v-if="field.type === 'password' && secrets.hasStored(builtinKey(svc.id, field.key))"
              class="saved-chip"
            >
              <i class="pi pi-check" aria-hidden="true"></i>{{ secrets.chipLabel(builtinKey(svc.id, field.key)) }}
            </span>
            <i
              v-if="field.hintTooltip"
              class="pi pi-info-circle field-info-icon"
              v-tooltip.top="field.hintTooltip"
              :aria-label="field.hintTooltip"
              tabindex="0"
            ></i>
          </label>
          <SensitiveField
            v-if="field.type === 'password'"
            v-bind="secrets.bindingsFor(builtinKey(svc.id, field.key), field.placeholder ?? '')"
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
      <R2ThumbnailProxySection
        v-if="svc.id === 'r2'"
        :enabled="privateFormData.r2.thumbnailProxyEnabled === true"
        @update:enabled="setR2ThumbnailProxy"
        @save="emit('save')"
      />
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
          <label>
            {{ field.label }}
            <span
              v-if="field.type === 'password' && secrets.hasStored(customS3Key(profile.id, field.key))"
              class="saved-chip"
            >
              <i class="pi pi-check" aria-hidden="true"></i>{{ secrets.chipLabel(customS3Key(profile.id, field.key)) }}
            </span>
            <i
              v-if="field.hintTooltip"
              class="pi pi-info-circle field-info-icon"
              v-tooltip.top="field.hintTooltip"
              :aria-label="field.hintTooltip"
              tabindex="0"
            ></i>
          </label>
          <SensitiveField
            v-if="field.type === 'password'"
            v-bind="secrets.bindingsFor(customS3Key(profile.id, field.key), field.placeholder ?? '')"
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
            <span
              v-if="field.key === 'password' && secrets.hasStored(webdavKey(profile.id))"
              class="saved-chip"
            >
              <i class="pi pi-check" aria-hidden="true"></i>{{ secrets.chipLabel(webdavKey(profile.id)) }}
            </span>
            <i
              v-if="field.hintTooltip"
              class="pi pi-info-circle field-info-icon"
              v-tooltip.top="field.hintTooltip"
              :aria-label="field.hintTooltip"
              tabindex="0"
            ></i>
          </label>
          <SensitiveField
            v-if="field.key === 'password'"
            v-bind="secrets.bindingsFor(webdavKey(profile.id), '输入 WebDAV 密码')"
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
      <div class="card-subsection">
        <div class="subsection-title-row">
          <div class="subsection-title-text">
            <label class="subsection-title">防止图片互相覆盖</label>
            <span class="subsection-hint">
              上传时自动重命名，image.png 会存成 image_20260818_a3f9.png。关掉后，同名图片会顶掉旧图且找不回来
            </span>
          </div>
          <ToggleSwitch
            :modelValue="isUniqueFileNameOn(profile)"
            @update:modelValue="(v: boolean) => setUniqueFileName(profile.id, v)"
          />
        </div>
      </div>
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

</style>
