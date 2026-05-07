// 各图床必填字段映射表
// 供 useServiceHealth 和 MultiServiceUploader 共用

import type { ServiceType } from '../config/types';
import { isCustomS3Id } from '../config/types';

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
 * 获取指定服务的必填字段列表
 * 支持内置服务和 custom_s3:profileId 复合 ID
 */
export function getRequiredFields(serviceId: string): string[] {
  if (isCustomS3Id(serviceId)) return CUSTOM_S3_REQUIRED_FIELDS;
  return SERVICE_REQUIRED_FIELDS[serviceId as ServiceType] ?? [];
}

/** Cookie 认证的图床列表 */
export const COOKIE_BASED_SERVICES: ServiceType[] = [
  'weibo', 'nowcoder', 'zhihu', 'nami', 'bilibili', 'chaoxing',
];

/** 无需配置的图床列表 */
export const NO_CONFIG_SERVICES: ServiceType[] = ['jd', 'qiyu'];
