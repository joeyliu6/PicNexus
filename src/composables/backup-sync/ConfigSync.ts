// 云端配置同步：合并同步 / 用本机覆盖云端 / 用云端覆盖本机。
// 不弹通知：结果返回给调用方（设置页云同步卡写在状态行），失败抛 SyncFailure（原因 + 处理办法）。
// 云端配置含图床密钥：没设备份密码时不上传（调用方先引导设置密码）。

import type { WebDAVProfile, UserConfig } from '@/config/types';
import { DEFAULT_CONFIG, isValidUserConfig } from '@/config/types';
import { configStore } from '@/store/instances';
import { secureStorage, isPasswordEncryptedData } from '@/security/crypto';
import { createLogger } from '@/utils/logger';
import {
  writeSyncLog, extractErrorCode, getWebDAVClientAndPath, isWebDAVNotFoundError,
  CLOUD_CONFIG_EMPTY_REASON, SyncFailure, SYNC_NOT_CONFIGURED,
} from './backupSyncUtils';
import { recordSync } from './syncRecords';

const log = createLogger('ConfigSync');

/** 解开加密内容（弹「输入备份密码」）；用户取消时抛 Error('user_cancelled') */
export type DecryptContent = (encrypted: string) => Promise<string>;

export const NEED_BACKUP_PASSWORD = '同步配置前需要先设置备份密码（云端配置包含图床密钥）';

/** 云端合并进本机时留本机的几项：同步连接本身，以及文档文件夹（本机路径，换台电脑多半不存在） */
export function mergeCloudConfig(cloud: UserConfig, local: UserConfig): UserConfig {
  return {
    ...cloud,
    webdav: local.webdav,
    linkHealth: {
      ...DEFAULT_CONFIG.linkHealth!,
      ...cloud.linkHealth,
      docFolders: local.linkHealth?.docFolders ?? [],
    },
  };
}

async function client(profile: WebDAVProfile) {
  const webdav = await getWebDAVClientAndPath(profile, 'settings');
  if (!webdav) throw new SyncFailure(SYNC_NOT_CONFIGURED, 'config');
  return webdav;
}

/** 读云端配置：没有文件返回 null；0 字节、格式坏都中止（继续上传就等于拿本机把云端盖了） */
async function readCloudConfig(webdav: Awaited<ReturnType<typeof client>>, decrypt: DecryptContent): Promise<UserConfig | null> {
  let raw: string | null;
  try {
    raw = await webdav.client.getFile(webdav.remotePath);
  } catch (error) {
    // 只容忍「云端没这个文件」；认证、网络错误必须中止，免得下一步覆盖云端
    if (isWebDAVNotFoundError(error)) return null;
    throw error;
  }
  // Why 用 `=== ''`：getFile 对 404 返回 null（首次同步，放行），对 200 + 空响应体返回 ''
  //（文件在但 0 字节，多半是上次上传中断留下的）——后者必须中止
  if (raw === null) return null;
  if (raw === '') throw new Error(CLOUD_CONFIG_EMPTY_REASON);
  const content = isPasswordEncryptedData(raw.trim()) ? await decrypt(raw.trim()) : raw;
  const parsed = JSON.parse(content) as unknown;
  if (!isValidUserConfig(parsed)) throw new Error('云端配置文件内容格式无效');
  return parsed;
}

async function upload(webdav: Awaited<ReturnType<typeof client>>): Promise<void> {
  const config = await configStore.get<UserConfig>('config');
  if (!config) throw new Error('无法读取本地配置');
  await webdav.client.putFile(webdav.remotePath, await secureStorage.encrypt(JSON.stringify(config, null, 2)));
}

function isCancel(error: unknown): boolean {
  return error instanceof Error && error.message === 'user_cancelled';
}

/**
 * 合并同步：先把云端配置并进本机（留本机的连接与文档文件夹），再把结果传回云端。
 * changed = 本机配置被云端改了（需要刷新才生效）。
 */
export async function syncConfig(profile: WebDAVProfile, decrypt: DecryptContent): Promise<{ changed: boolean }> {
  if (!secureStorage.isPasswordMode()) throw new SyncFailure(NEED_BACKUP_PASSWORD, 'config');
  const webdav = await client(profile);
  let changed = false;
  try {
    const cloud = await readCloudConfig(webdav, decrypt);
    if (cloud) {
      const local = await configStore.get<UserConfig>('config');
      // 首次使用 / 配置缺失：本机没有配置时直接用云端的，否则下一步读不到本地配置
      const merged = local ? mergeCloudConfig(cloud, local) : cloud;
      changed = JSON.stringify(merged) !== JSON.stringify(local);
      if (changed) {
        await configStore.set('config', merged);
        await configStore.save();
      }
    }
  } catch (error) {
    if (isCancel(error)) throw error;
    const reason = extractErrorCode(error);
    log.error('拉取云端配置失败，已中止以避免覆盖云端数据:', error);
    await recordSync(profile, 'config', 'failed', reason);
    await writeSyncLog('sync_settings', 'failed', reason, profile);
    throw new SyncFailure(reason, 'config');
  }

  try {
    await upload(webdav);
  } catch (error) {
    const reason = extractErrorCode(error);
    log.error('配置同步上传失败:', error);
    await recordSync(profile, 'config', changed ? 'partial' : 'failed', reason);
    await writeSyncLog('sync_settings', 'failed', reason, profile);
    throw new SyncFailure(reason, 'config', changed);
  }

  await recordSync(profile, 'config', 'success');
  await writeSyncLog('sync_settings', 'success', changed ? '已合并云端配置' : '配置无变化', profile);
  return { changed };
}

/** 用本机覆盖云端（配置） */
export async function pushConfig(profile: WebDAVProfile): Promise<void> {
  if (!secureStorage.isPasswordMode()) throw new SyncFailure(NEED_BACKUP_PASSWORD, 'config');
  const webdav = await client(profile);
  try {
    await upload(webdav);
  } catch (error) {
    const reason = extractErrorCode(error);
    log.error('覆盖云端配置失败:', error);
    await recordSync(profile, 'config', 'failed', reason);
    await writeSyncLog('upload_settings_cloud', 'failed', reason, profile);
    throw new SyncFailure(reason, 'config');
  }
  await recordSync(profile, 'config', 'success');
  await writeSyncLog('upload_settings_cloud', 'success', undefined, profile);
}

/** 用云端覆盖本机（配置）：云端没有文件也算失败（没东西可还原），本机的同步连接与文档文件夹保留 */
export async function pullConfig(profile: WebDAVProfile, decrypt: DecryptContent): Promise<void> {
  const webdav = await client(profile);
  try {
    const cloud = await readCloudConfig(webdav, decrypt);
    if (!cloud) throw new Error('云端还没有配置文件');
    const local = await configStore.get<UserConfig>('config');
    await configStore.set('config', local ? mergeCloudConfig(cloud, local) : cloud);
    await configStore.save();
  } catch (error) {
    if (isCancel(error)) throw error;
    const reason = extractErrorCode(error);
    log.error('用云端覆盖本机配置失败:', error);
    await recordSync(profile, 'config', 'failed', reason);
    await writeSyncLog('download_settings_cloud', 'failed', reason, profile);
    throw new SyncFailure(reason, 'config');
  }
  await recordSync(profile, 'config', 'success');
  await writeSyncLog('download_settings_cloud', 'success', undefined, profile);
}
