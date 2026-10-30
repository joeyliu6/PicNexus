// 多实例图床 profile（custom_s3 / webdav）与上传器注册的同步
//
// 这两类图床的 serviceId 由用户 profile 动态生成（`custom_s3:xxx` / `webdav:xxx`），
// 图床页每次保存后按当前 profile 列表重建注册。移除 profile 时由 hostConfig.disconnectHost
// 一并从「已添加 / 已启用」里摘掉它的 ID，不会留下指向空配置的图床。

import { syncCustomS3Uploaders, syncWebDAVUploaders } from '@/uploaders';
import type { CustomS3Profile, WebDAVStorageProfile } from '@/config/types';

export interface ProfileSources {
  custom_s3_profiles: CustomS3Profile[];
  webdav_profiles: WebDAVStorageProfile[];
}

/**
 * 按当前 profile 列表重建多实例上传器注册
 */
export function syncProfileUploaders(profiles: ProfileSources): void {
  syncCustomS3Uploaders(profiles.custom_s3_profiles || []);
  syncWebDAVUploaders(profiles.webdav_profiles || []);
}
