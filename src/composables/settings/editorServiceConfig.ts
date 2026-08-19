import type { CustomS3Profile, ServerServiceType, WebDAVStorageProfile } from '../../config/types';
import { DEFAULT_WEBDAV_URL_TEMPLATE, getCustomS3ProfileId, getWebDAVProfileId, isCustomS3Id, isWebDAVId, makeCustomS3Id, makeWebDAVId } from '../../config/types';
import { CUSTOM_S3_REQUIRED_FIELDS, SERVICE_REQUIRED_FIELDS, WEBDAV_REQUIRED_FIELDS, getRestChainRequiredFields } from '../../constants/serviceRequiredFields';
import { extractNamiAuthToken } from '../../utils/namiAuthToken';
import { secureStorage } from '../../security/crypto';
import type { SettingsFormShape } from './settingsFormTypes';

export const EDITOR_UNSUPPORTED_SERVICES: Set<ServerServiceType> = new Set(['qiyu', 'nami']);

export const BUILTIN_EDITOR_SERVICE_IDS: ServerServiceType[] = [
  'jd',
  'qiyu',
  'r2',
  'tencent',
  'aliyun',
  'qiniu',
  'upyun',
  'github',
  'smms',
  'imgur',
  'weibo',
  'bilibili',
  'zhihu',
  'nowcoder',
  'chaoxing',
  'nami',
];

type ServiceConfigObject = Record<string, unknown>;

function hasFilledFields(source: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => {
    const value = source[field];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function findCustomS3Profile(service: string, fd: SettingsFormShape): CustomS3Profile | undefined {
  if (!isCustomS3Id(service)) return undefined;
  const profileId = getCustomS3ProfileId(service);
  return fd.custom_s3_profiles.find((profile) => profile.id === profileId);
}

function findWebDAVProfile(service: string, fd: SettingsFormShape): WebDAVStorageProfile | undefined {
  if (!isWebDAVId(service)) return undefined;
  const profileId = getWebDAVProfileId(service);
  return fd.webdav_profiles.find((profile) => profile.id === profileId);
}

export function isCliCompatibleServiceConfigured(service: ServerServiceType, fd: SettingsFormShape): boolean {
  if (EDITOR_UNSUPPORTED_SERVICES.has(service)) return false;

  if (isCustomS3Id(service)) {
    const profile = findCustomS3Profile(service, fd);
    return !!profile && hasFilledFields(profile as unknown as Record<string, unknown>, CUSTOM_S3_REQUIRED_FIELDS);
  }

  if (isWebDAVId(service)) {
    const profile = findWebDAVProfile(service, fd);
    return !!profile && hasFilledFields(profile as unknown as Record<string, unknown>, WEBDAV_REQUIRED_FIELDS);
  }

  // 编辑器 / CLI 走 REST 口径：又拍云这条链路用 operator/password，
  // 不需要 GUI 上传那对 S3 凭证（见 REST_CHAIN_REQUIRED_FIELDS 的说明）
  if (!(service in SERVICE_REQUIRED_FIELDS)) return false;
  const requiredFields = getRestChainRequiredFields(service);
  if (requiredFields.length === 0) return true;

  const serviceConfig = buildRawServiceRecord(service, fd);
  return !!serviceConfig && hasFilledFields(serviceConfig, requiredFields);
}

function buildRawServiceRecord(service: ServerServiceType, fd: SettingsFormShape): Record<string, unknown> | null {
  switch (service) {
    case 'jd':
    case 'qiyu':
      return {};
    case 'github':
      return fd.github as unknown as Record<string, unknown>;
    case 'smms':
      return fd.smms;
    case 'imgur':
      return fd.imgur;
    case 'weibo':
      return { cookie: fd.weiboCookie };
    case 'bilibili':
      return fd.bilibili;
    case 'nowcoder':
      return fd.nowcoder;
    case 'chaoxing':
      return fd.chaoxing;
    case 'zhihu':
      return fd.zhihu;
    case 'nami':
      return fd.nami;
    case 'r2':
      return fd.r2;
    case 'tencent':
      return fd.tencent;
    case 'aliyun':
      return fd.aliyun;
    case 'qiniu':
      return fd.qiniu;
    case 'upyun':
      return fd.upyun;
    default:
      return findCustomS3Profile(service, fd) as unknown as Record<string, unknown> | undefined ?? null;
  }
}

export function buildServiceConfig(
  service: ServerServiceType | null,
  fd: SettingsFormShape,
  webdavPassword?: string,
): ServiceConfigObject | null {
  if (!service) return null;

  if (isWebDAVId(service)) {
    const profile = findWebDAVProfile(service, fd);
    if (!profile) return null;
    return {
      type: 'webdav',
      url: profile.url,
      username: profile.username,
      password: webdavPassword ?? '',
      remote_path: profile.remotePath,
      public_domain: profile.publicDomain,
      // 模板被清空时回落到默认值。设置页那个输入框清空后只显示 placeholder，
      // 用户看着像"还有值"，不兜底的话 Typora/CLI 会静默拿到一条空链接。
      // trim 后判空是为了跟 Rust 侧 render_public_url 的兜底口径一致，
      // 让导出的 cli-config.json 里就是最终生效的模板，而不是留个空串让下游再猜。
      public_url_template: profile.publicUrlTemplate?.trim() || DEFAULT_WEBDAV_URL_TEMPLATE,
      lan_http_confirmed: profile.lanHttpConfirmed === true,
      // `!== false`：缺省落在"开启防覆盖"一侧，见 WebDAVStorageProfile.uniqueFileName
      unique_file_name: profile.uniqueFileName !== false,
    };
  }

  switch (service) {
    case 'jd':
      return { type: 'jd' };
    case 'qiyu':
      return { type: 'qiyu' };
    case 'github':
      return { type: 'github', token: fd.github.token, owner: fd.github.owner, repo: fd.github.repo, branch: fd.github.branch, path: fd.github.path };
    case 'smms':
      return { type: 'smms', token: fd.smms.token };
    case 'imgur':
      return { type: 'imgur', client_id: fd.imgur.clientId };
    case 'weibo':
      return { type: 'weibo', cookie: fd.weiboCookie };
    case 'bilibili':
      return { type: 'bilibili', cookie: fd.bilibili.cookie };
    case 'nowcoder':
      return { type: 'nowcoder', cookie: fd.nowcoder.cookie };
    case 'chaoxing':
      return { type: 'chaoxing', cookie: fd.chaoxing.cookie };
    case 'zhihu':
      return {
        type: 'zhihu',
        cookie: fd.zhihu.cookie,
        sourceParamEnabled: fd.zhihu.sourceParamEnabled ?? true,
        sourceParamValue: fd.zhihu.sourceParamValue,
      };
    case 'nami': {
      const cookie = fd.nami.cookie;
      const authToken = fd.nami.authToken || extractNamiAuthToken(cookie);
      return { type: 'nami', cookie, auth_token: authToken };
    }
    case 'r2':
      return { type: 'r2', account_id: fd.r2.accountId, access_key_id: fd.r2.accessKeyId, secret_access_key: fd.r2.secretAccessKey, bucket_name: fd.r2.bucketName, path: fd.r2.path, public_domain: fd.r2.publicDomain };
    case 'tencent':
      return { type: 'tencent', secret_id: fd.tencent.secretId, secret_key: fd.tencent.secretKey, region: fd.tencent.region, bucket: fd.tencent.bucket, path: fd.tencent.path, public_domain: fd.tencent.publicDomain };
    case 'aliyun':
      return { type: 'aliyun', access_key_id: fd.aliyun.accessKeyId, access_key_secret: fd.aliyun.accessKeySecret, region: fd.aliyun.region, bucket: fd.aliyun.bucket, path: fd.aliyun.path, public_domain: fd.aliyun.publicDomain };
    case 'qiniu':
      return { type: 'qiniu', access_key: fd.qiniu.accessKey, secret_key: fd.qiniu.secretKey, region: fd.qiniu.region, bucket: fd.qiniu.bucket, custom_domain: fd.qiniu.publicDomain, path: fd.qiniu.path };
    case 'upyun':
      return { type: 'upyun', operator: fd.upyun.operator, password: fd.upyun.password, bucket: fd.upyun.bucket, public_domain: fd.upyun.publicDomain, path: fd.upyun.path };
    default: {
      const profile = findCustomS3Profile(service, fd);
      if (!profile) return null;
      return {
        type: 'customS3',
        endpoint: profile.endpoint,
        access_key_id: profile.accessKeyId,
        secret_access_key: profile.secretAccessKey,
        region: profile.region,
        bucket: profile.bucket,
        path: profile.path,
        public_domain: profile.publicDomain,
      };
    }
  }
}

export function buildServiceConfigJson(service: ServerServiceType | null, fd: SettingsFormShape, webdavPassword?: string): string | null {
  const config = buildServiceConfig(service, fd, webdavPassword);
  return config ? JSON.stringify(config) : null;
}

export function buildCliServicesConfig(
  fd: SettingsFormShape,
  webdavPasswords?: Record<string, string>,
): Record<string, ServiceConfigObject> {
  if (fd.editorServer.cliEnabled !== true) return {};

  const services: Record<string, ServiceConfigObject> = {};

  for (const service of BUILTIN_EDITOR_SERVICE_IDS) {
    if (!isCliCompatibleServiceConfigured(service, fd)) continue;
    const config = buildServiceConfig(service, fd);
    if (config) services[service] = config;
  }

  for (const profile of fd.custom_s3_profiles) {
    const serviceId = makeCustomS3Id(profile.id);
    if (!isCliCompatibleServiceConfigured(serviceId, fd)) continue;
    const config = buildServiceConfig(serviceId, fd);
    if (config) services[serviceId] = config;
  }

  for (const profile of fd.webdav_profiles) {
    const serviceId = makeWebDAVId(profile.id);
    if (!isCliCompatibleServiceConfigured(serviceId, fd)) continue;
    const config = buildServiceConfig(serviceId, fd, webdavPasswords?.[serviceId]);
    if (config) services[serviceId] = config;
  }

  return services;
}

export function buildCliServicesConfigJson(fd: SettingsFormShape, webdavPasswords?: Record<string, string>): string {
  return JSON.stringify(buildCliServicesConfig(fd, webdavPasswords));
}

/**
 * CLI 导出服务的变更签名，供 `useEditorIntegration` 的 `watch` 判断"要不要重新下发"
 *
 * 不能直接拿 `buildCliServicesConfigJson` 的结果当签名：那份 JSON 里 WebDAV 的
 * `password` 字段固定是空串（真正的明文只在 `applyEditorServer` 里才解出来），
 * 于是"只改了 WebDAV 密码"时这份 JSON 纹丝不动，`watch` 检测不到变化，
 * `cli-config.json` 就会一直停在旧密码上。这里改用 `buildEditorCredentialSignature`
 * （webdav 分支用的是密文 `passwordEncrypted`，密文变了签名就变，不用解密）。
 */
export function buildCliServicesSignature(fd: SettingsFormShape): string {
  if (fd.editorServer.cliEnabled !== true) return '';

  const parts: string[] = [];

  for (const service of BUILTIN_EDITOR_SERVICE_IDS) {
    if (!isCliCompatibleServiceConfigured(service, fd)) continue;
    parts.push(`${service}:${buildEditorCredentialSignature(service, fd)}`);
  }

  for (const profile of fd.custom_s3_profiles) {
    const serviceId = makeCustomS3Id(profile.id);
    if (!isCliCompatibleServiceConfigured(serviceId, fd)) continue;
    parts.push(`${serviceId}:${buildEditorCredentialSignature(serviceId, fd)}`);
  }

  for (const profile of fd.webdav_profiles) {
    const serviceId = makeWebDAVId(profile.id);
    if (!isCliCompatibleServiceConfigured(serviceId, fd)) continue;
    parts.push(`${serviceId}:${buildEditorCredentialSignature(serviceId, fd)}`);
  }

  return parts.join('|');
}

export function buildEditorCredentialSignature(service: ServerServiceType, fd: SettingsFormShape): string {
  if (isWebDAVId(service)) {
    const profile = findWebDAVProfile(service, fd);
    if (!profile) return '';
    return [
      profile.url,
      profile.username,
      profile.passwordEncrypted,
      profile.remotePath,
      profile.publicDomain,
      profile.publicUrlTemplate,
      profile.lanHttpConfirmed ?? false,
      profile.uniqueFileName ?? true,
    ].join('|');
  }

  switch (service) {
    case 'jd':
    case 'qiyu':
      return service;
    case 'github':
      return [fd.github.token, fd.github.owner, fd.github.repo, fd.github.branch, fd.github.path].join('|');
    case 'smms':
      return fd.smms.token;
    case 'imgur':
      return fd.imgur.clientId;
    case 'weibo':
      return fd.weiboCookie;
    case 'bilibili':
      return fd.bilibili.cookie;
    case 'nowcoder':
      return fd.nowcoder.cookie;
    case 'chaoxing':
      return fd.chaoxing.cookie;
    case 'zhihu':
      return [
        fd.zhihu.cookie,
        fd.zhihu.sourceParamEnabled ?? true,
        fd.zhihu.sourceParamValue ?? '',
      ].join('|');
    case 'nami':
      return [fd.nami.cookie, fd.nami.authToken].join('|');
    case 'r2':
      return [fd.r2.accountId, fd.r2.accessKeyId, fd.r2.secretAccessKey, fd.r2.bucketName, fd.r2.path, fd.r2.publicDomain].join('|');
    case 'tencent':
      return [fd.tencent.secretId, fd.tencent.secretKey, fd.tencent.region, fd.tencent.bucket, fd.tencent.path, fd.tencent.publicDomain].join('|');
    case 'aliyun':
      return [fd.aliyun.accessKeyId, fd.aliyun.accessKeySecret, fd.aliyun.region, fd.aliyun.bucket, fd.aliyun.path, fd.aliyun.publicDomain].join('|');
    case 'qiniu':
      return [fd.qiniu.accessKey, fd.qiniu.secretKey, fd.qiniu.region, fd.qiniu.bucket, fd.qiniu.publicDomain, fd.qiniu.path].join('|');
    case 'upyun':
      return [fd.upyun.operator, fd.upyun.password, fd.upyun.bucket, fd.upyun.publicDomain, fd.upyun.path].join('|');
    default: {
      const profile = findCustomS3Profile(service, fd);
      if (profile) return [profile.endpoint, profile.accessKeyId, profile.secretAccessKey, profile.region, profile.bucket, profile.path, profile.publicDomain].join('|');
      return '';
    }
  }
}

/**
 * 解密单个 WebDAV 复合 ID 对应的密码
 *
 * 空密文是合法的中间态（profile 还没填密码），直接返回空串；
 * 解密失败说明密钥不匹配，抛错交给调用方（`applyEditorServer`）已有的 toast 兜底。
 */
export async function resolveWebDAVServicePassword(service: ServerServiceType, fd: SettingsFormShape): Promise<string> {
  const profile = findWebDAVProfile(service, fd);
  if (!profile?.passwordEncrypted) return '';
  try {
    return await secureStorage.decrypt(profile.passwordEncrypted);
  } catch {
    throw new Error('WebDAV 密码解密失败，请在设置中重新填写密码');
  }
}

/**
 * 解密所有 CLI 会用到的 WebDAV profile 密码，供 `buildCliServicesConfig` 使用
 */
export async function resolveWebDAVPasswordsForCli(fd: SettingsFormShape): Promise<Record<string, string>> {
  const passwords: Record<string, string> = {};
  for (const profile of fd.webdav_profiles) {
    const serviceId = makeWebDAVId(profile.id);
    if (!isCliCompatibleServiceConfigured(serviceId, fd)) continue;
    passwords[serviceId] = await resolveWebDAVServicePassword(serviceId, fd);
  }
  return passwords;
}
