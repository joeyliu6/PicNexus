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
  // 又拍云同时列了两套凭证：这张表卡的是 **GUI 上传**，它走 S3 端点，只认 s3AccessKey/s3SecretKey。
  // 编辑器 / CLI / 测试连接走 REST，用的是 operator/password，见下面的 REST_CHAIN_REQUIRED_FIELDS。
  upyun: ['operator', 'password', 'bucket', 'publicDomain', 's3AccessKey', 's3SecretKey'],
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
 * 走 REST/Basic Auth 那条链路的必填字段覆盖表（编辑器 / CLI）
 *
 * **只有当同一个图床的不同链路用不同凭证时才需要在这里开例外。目前只有又拍云。**
 *
 * 又拍云的 GUI 上传走 S3 端点（SigV4，需要控制台单独生成的 AK/SK），而编辑器 / CLI
 * 走它自家 REST API（Basic Auth，用操作员账号密码）。拿 GUI 那套字段去卡编辑器，
 * 会让一条**本来就能用**的链路因为缺一把它根本用不到的钥匙而停摆——只用 Typora + 又拍云
 * 的用户手里通常没有 S3 凭证。反过来，GUI 上传缺了 S3 凭证是真的传不了，
 * 必须在 `SERVICE_REQUIRED_FIELDS` 里卡住，否则又会退回「设置页看着正常、一传就报
 * ErrInvalidAccessKeyID」——那正是这个缺陷潜伏至今的形态。
 *
 * ⚠️ 设置页「测试连接」也读这张表，但它**不代表测试连接只验 REST**：2026-08-20 起
 * `test_upyun_connection` 会 REST + S3 各验一次，缺 S3 凭证由 Rust 侧报（措辞里带
 * 「去哪儿生成」，比这里的字段名报错有用得多）。理由写在 `s3ConfigValidation.ts`。
 *
 * 详见 `docs/audits/upyun-audit-2026-08-19.md`。
 */
export const REST_CHAIN_REQUIRED_FIELDS: Partial<Record<ServiceType, string[]>> = {
  upyun: ['operator', 'password', 'bucket', 'publicDomain'],
};

/**
 * 获取指定服务的必填字段列表（GUI 上传口径）
 * 支持内置服务、custom_s3:profileId 和 webdav:profileId 复合 ID
 */
export function getRequiredFields(serviceId: string): string[] {
  if (isCustomS3Id(serviceId)) return CUSTOM_S3_REQUIRED_FIELDS;
  if (isWebDAVId(serviceId)) return WEBDAV_REQUIRED_FIELDS;
  return SERVICE_REQUIRED_FIELDS[serviceId as ServiceType] ?? [];
}

/**
 * 获取 REST 链路（编辑器 / CLI / 测试连接）的必填字段列表
 *
 * 没有覆盖项的图床一律回退到 `getRequiredFields`，所以新增图床时不需要动这里。
 */
export function getRestChainRequiredFields(serviceId: string): string[] {
  if (isCustomS3Id(serviceId) || isWebDAVId(serviceId)) return getRequiredFields(serviceId);
  return REST_CHAIN_REQUIRED_FIELDS[serviceId as ServiceType] ?? getRequiredFields(serviceId);
}

/** Cookie 认证的图床列表 */
export const COOKIE_BASED_SERVICES: ServiceType[] = [
  'weibo', 'nowcoder', 'zhihu', 'nami', 'bilibili', 'chaoxing',
];

/** 无需配置的图床列表 */
export const NO_CONFIG_SERVICES: ServiceType[] = ['jd', 'qiyu'];
