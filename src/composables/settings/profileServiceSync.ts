// 多实例图床 profile（custom_s3 / webdav）与上传器注册、可用列表的同步
//
// 这两类图床的 serviceId 由用户 profile 动态生成（`custom_s3:xxx` / `webdav:xxx`），
// 删掉 profile 后如果不同步清理，availableServices 里就会留下指向空配置的幽灵图床。
// 收敛到一处，避免 load / save 两条路径各写一遍再慢慢走样。

import { syncCustomS3Uploaders, syncWebDAVUploaders } from '../../uploaders';
import { isCustomS3Id, isWebDAVId, makeCustomS3Id, makeWebDAVId } from '../../config/types';
import type { CustomS3Profile, WebDAVStorageProfile } from '../../config/types';

export interface ProfileSources {
  custom_s3_profiles: CustomS3Profile[];
  webdav_profiles: WebDAVStorageProfile[];
}

/**
 * 过滤掉已不存在对应 profile 的多实例图床 ID
 * 非多实例的内建图床原样保留
 */
export function filterOrphanProfileServices(
  serviceIds: string[],
  profiles: ProfileSources,
): string[] {
  const customS3Ids = new Set(
    (profiles.custom_s3_profiles || []).map(profile => makeCustomS3Id(profile.id)),
  );
  const webdavIds = new Set(
    (profiles.webdav_profiles || []).map(profile => makeWebDAVId(profile.id)),
  );

  return serviceIds.filter((serviceId) => {
    if (isCustomS3Id(serviceId)) return customS3Ids.has(serviceId);
    if (isWebDAVId(serviceId)) return webdavIds.has(serviceId);
    return true;
  });
}

/**
 * 按当前 profile 列表重建多实例上传器注册
 */
export function syncProfileUploaders(profiles: ProfileSources): void {
  syncCustomS3Uploaders(profiles.custom_s3_profiles || []);
  syncWebDAVUploaders(profiles.webdav_profiles || []);
}
