/**
 * 图床服务显示名称映射
 */

import type { ServiceType, UserConfig } from '@/config/types';
import { isCustomS3Id, getCustomS3ProfileId, isWebDAVId, getWebDAVProfileId } from '@/config/types';

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
const SERVICE_NAME_ALIASES: Partial<Record<ServiceType, string[]>> = {
  r2: ['R2', 'Cloudflare', 'Cloudflare R2'],
  tencent: ['腾讯', 'Tencent', 'Tencent COS'],
  aliyun: ['阿里', 'Aliyun', 'OSS'],
  qiniu: ['七牛', 'Qiniu'],
  upyun: ['又拍', 'Upyun'],
  smms: ['SMMS', 'SM.MS'],
};

/** 多实例图床（custom_s3 / webdav）的 profile 名称来源 */
export type ProfileNameSource = () => UserConfig | null | undefined;

let profileNameSource: ProfileNameSource | null = null;

/**
 * 注册 profile 名称的默认来源
 *
 * Why 需要这层注入：`getServiceDisplayName` 的 config 是可选参数，而全仓 38 个
 * 调用点里有 31 个没传。不传就查不到 profile，只能退化成 `WebDAV (原始ID)`——
 * 等于把内部 ID 泄露到界面上（上传队列里显示成 `WebDAV (msrlkrjz3...`）。
 *
 * 要求每个调用点都记得传 config 是堵不住的：下次新增调用点照样会忘，默认行为
 * 本身就是错的。所以把「查得到名字」变成默认，显式传 config 仍然优先。
 *
 * 由 composables/useConfig.ts 在模块加载时注入。方向是 composables → constants，
 * 与既有依赖一致（useConfig 本来就 import 了 ../constants），不构成循环。
 */
export function registerProfileNameSource(source: ProfileNameSource): void {
  profileNameSource = source;
}

/** 重置注入来源（单元测试用） */
export function resetProfileNameSource(): void {
  profileNameSource = null;
}

/**
 * 显式传入的 config 优先；没传才回退到注册的来源。
 * 调用方明确给了 config 就按它的来，不要"好心"用全局值覆盖。
 */
function resolveProfileConfig(config?: UserConfig): UserConfig | null | undefined {
  return config ?? profileNameSource?.();
}

/**
 * 获取服务显示名称
 * 支持内置服务和 custom_s3:profileId / webdav:profileId 复合 ID
 *
 * 查不到 profile 分两种，必须说成两样：
 * - **没去查**（没传 config、也没注册来源）→ `WebDAV (原始ID)`。这是接线漏了，
 *   带 ID 才能一眼看出问题（useConfig 的接线护栏测试靠的就是这个区别）
 * - **查了但确实不存在**（profile 已删，历史记录仍引用）→ `WebDAV（已删除）`。
 *   界面的读者是用户，一串随机 ID 既认不出是哪个配置，也说明不了链接为什么坏；
 *   「已删除」直接回答了后者。需要 ID 排查时看日志或导出的 CSV（存的是原始 serviceId）
 */
export function getServiceDisplayName(serviceId: string, config?: UserConfig): string {
  if (isCustomS3Id(serviceId)) {
    const profileId = getCustomS3ProfileId(serviceId);
    const source = resolveProfileConfig(config);
    if (!source) return `自定义 S3 (${profileId})`;
    return source.custom_s3_profiles?.find(p => p.id === profileId)?.name || '自定义 S3（已删除）';
  }
  if (isWebDAVId(serviceId)) {
    const profileId = getWebDAVProfileId(serviceId);
    const source = resolveProfileConfig(config);
    if (!source) return `WebDAV (${profileId})`;
    return source.webdav_profiles?.find(p => p.id === profileId)?.name || 'WebDAV（已删除）';
  }
  return SERVICE_DISPLAY_NAMES[serviceId as ServiceType] || serviceId;
}

/**
 * 获取服务别名列表（用于错误文案去前缀）
 * 未在 SERVICE_NAME_ALIASES 中定义的服务返回空数组
 */
export function getServiceAliases(serviceId: string): string[] {
  if (isCustomS3Id(serviceId)) return ['自定义 S3', 'S3'];
  if (isWebDAVId(serviceId)) return ['WebDAV', 'webdav'];
  return SERVICE_NAME_ALIASES[serviceId as ServiceType] ?? [];
}
