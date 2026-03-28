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
