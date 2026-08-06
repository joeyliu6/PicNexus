// 各图床必填字段映射表
// 供 useServiceHealth 和 MultiServiceUploader 共用

import type { ServiceType } from '../config/types';
import { isCustomS3Id, isWebDAVId } from '../config/types';

/**
 * 各图床的必填字段列表
 * - 空数组表示无需配置（开箱即用）
 * - Cookie 类图床统一为 ['cookie']
 * - 私有云存储列出所有必填的凭证字段
 */
export const SERVICE_REQUIRED_FIELDS: Record<ServiceType, string[]> = {
  jd: [],
  qiyu: [],
  weibo: ['cookie'],
  nowcoder: ['cookie'],
  zhihu: ['cookie'],
  nami: ['cookie'],
  bilibili: ['cookie'],
  chaoxing: ['cookie'],
  r2: ['accountId', 'accessKeyId', 'secretAccessKey', 'bucketName', 'publicDomain'],
  tencent: ['secretId', 'secretKey', 'bucket', 'region'],
  aliyun: ['accessKeyId', 'accessKeySecret', 'bucket', 'region', 'publicDomain'],
  qiniu: ['accessKey', 'secretKey', 'bucket', 'publicDomain'],
  upyun: ['operator', 'password', 'bucket', 'publicDomain'],
  smms: ['token'],
  github: ['token', 'owner', 'repo'],
  imgur: ['clientId'],
};

/** 自定义 S3 的必填字段 */
export const CUSTOM_S3_REQUIRED_FIELDS = ['endpoint', 'accessKeyId', 'secretAccessKey', 'region', 'bucket'];

/**
 * WebDAV 图床的必填字段
 *
 * publicDomain 必填：WebDAV 端点通常需要认证，直接拿它当图片链接的话，
 * 别人打开会被要求输账号密码，粘进 Markdown 就是一张裂图。
 */
export const WEBDAV_REQUIRED_FIELDS = ['url', 'username', 'passwordEncrypted', 'publicDomain'];

/**
 * 获取指定服务的必填字段列表
 * 支持内置服务、custom_s3:profileId 和 webdav:profileId 复合 ID
 */
export function getRequiredFields(serviceId: string): string[] {
  if (isCustomS3Id(serviceId)) return CUSTOM_S3_REQUIRED_FIELDS;
  if (isWebDAVId(serviceId)) return WEBDAV_REQUIRED_FIELDS;
  return SERVICE_REQUIRED_FIELDS[serviceId as ServiceType] ?? [];
}

/** Cookie 认证的图床列表 */
export const COOKIE_BASED_SERVICES: ServiceType[] = [
  'weibo', 'nowcoder', 'zhihu', 'nami', 'bilibili', 'chaoxing',
];

/** 无需配置的图床列表 */
export const NO_CONFIG_SERVICES: ServiceType[] = ['jd', 'qiyu'];
