/**
 * 图床服务显示名称映射
 */

import type { ServiceType, UserConfig } from '../config/types';
import { isCustomS3Id, getCustomS3ProfileId } from '../config/types';

export const SERVICE_DISPLAY_NAMES: Record<ServiceType, string> = {
  weibo: '微博',
  r2: 'Cloudflare R2',
  jd: '京东',
  nowcoder: '牛客',
  qiyu: '七鱼',
  zhihu: '知乎',
  nami: '纳米',
  bilibili: 'B站',
  chaoxing: '超星',
  smms: 'SM.MS',
  github: 'GitHub',
  imgur: 'Imgur',
  tencent: '腾讯云',
  aliyun: '阿里云',
  qiniu: '七牛云',
  upyun: '又拍云',
} as const;

/**
 * 图床别名表
 * 用于错误文案去前缀。当 uploader 内部包装错误时（如 R2Error 的 `R2 上传失败: xxx`），
 * 正则需要知道该图床可能出现的所有写法才能正确剥壳。
 */
export const SERVICE_NAME_ALIASES: Partial<Record<ServiceType, string[]>> = {
  r2: ['R2', 'Cloudflare', 'Cloudflare R2'],
  tencent: ['腾讯', 'Tencent', 'Tencent COS'],
  aliyun: ['阿里', 'Aliyun', 'OSS'],
  qiniu: ['七牛', 'Qiniu'],
  upyun: ['又拍', 'Upyun'],
  smms: ['SMMS', 'SM.MS'],
};

/**
 * 获取服务显示名称
 * 支持内置服务和 custom_s3:profileId 复合 ID
 */
export function getServiceDisplayName(serviceId: string, config?: UserConfig): string {
  if (isCustomS3Id(serviceId)) {
    const profileId = getCustomS3ProfileId(serviceId);
    const profile = config?.custom_s3_profiles?.find(p => p.id === profileId);
    return profile?.name || `自定义 S3 (${profileId})`;
  }
  return SERVICE_DISPLAY_NAMES[serviceId as ServiceType] || serviceId;
}

/**
 * 获取服务别名列表（用于错误文案去前缀）
 * 未在 SERVICE_NAME_ALIASES 中定义的服务返回空数组
 */
export function getServiceAliases(serviceId: string): string[] {
  if (isCustomS3Id(serviceId)) return ['自定义 S3', 'S3'];
  return SERVICE_NAME_ALIASES[serviceId as ServiceType] ?? [];
}
