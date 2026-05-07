import type { CustomS3Profile, ServerServiceType } from '../../config/types';
import { getCustomS3ProfileId, isCustomS3Id, makeCustomS3Id } from '../../config/types';
import { CUSTOM_S3_REQUIRED_FIELDS, SERVICE_REQUIRED_FIELDS } from '../../constants/serviceRequiredFields';
import { extractNamiAuthToken } from '../../utils/namiAuthToken';
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

export function isCliCompatibleServiceConfigured(service: ServerServiceType, fd: SettingsFormShape): boolean {
  if (EDITOR_UNSUPPORTED_SERVICES.has(service)) return false;

  if (isCustomS3Id(service)) {
    const profile = findCustomS3Profile(service, fd);
    return !!profile && hasFilledFields(profile as unknown as Record<string, unknown>, CUSTOM_S3_REQUIRED_FIELDS);
  }

  const requiredFields = SERVICE_REQUIRED_FIELDS[service as keyof typeof SERVICE_REQUIRED_FIELDS];
  if (!requiredFields) return false;
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

export function buildServiceConfig(service: ServerServiceType | null, fd: SettingsFormShape): ServiceConfigObject | null {
  if (!service) return null;

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
      return { type: 'upyun', operator: fd.upyun.operator, password: fd.upyun.password, bucket: fd.upyun.bucket, public_domain: fd.upyun.publicDomain };
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

export function buildServiceConfigJson(service: ServerServiceType | null, fd: SettingsFormShape): string | null {
  const config = buildServiceConfig(service, fd);
  return config ? JSON.stringify(config) : null;
}

export function buildCliServicesConfig(fd: SettingsFormShape): Record<string, ServiceConfigObject> {
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

  return services;
}

export function buildCliServicesConfigJson(fd: SettingsFormShape): string {
  return JSON.stringify(buildCliServicesConfig(fd));
}

export function buildEditorCredentialSignature(service: ServerServiceType, fd: SettingsFormShape): string {
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
      return [fd.upyun.operator, fd.upyun.password, fd.upyun.bucket, fd.upyun.publicDomain].join('|');
    default: {
      const profile = findCustomS3Profile(service, fd);
      if (profile) return [profile.endpoint, profile.accessKeyId, profile.secretAccessKey, profile.region, profile.bucket, profile.path, profile.publicDomain].join('|');
      return '';
    }
  }
}
