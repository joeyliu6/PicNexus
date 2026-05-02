// src/composables/backup-sync/ConfigSync.ts
// 云端配置同步：上传 / 覆盖下载 / 合并下载 / 双向同步

import type { WebDAVProfile, UserConfig } from '../../config/types';
import { isValidUserConfig } from '../../config/types';
import { configStore } from '../../store/instances';
import { secureStorage, isPasswordEncryptedData } from '../../crypto';
import { TOAST_MESSAGES } from '../../constants';
import { createLogger } from '../../utils/logger';
import { writeSyncLog, extractErrorCode, getWebDAVClientAndPath, isWebDAVNotFoundError } from './backupSyncUtils';
import type { BackupCloudDeps } from './useBackupCloud';

const log = createLogger('ConfigSync');

export function createConfigSyncOps(deps: BackupCloudDeps) {
  const {
    toast, confirmDialog, tryDecryptContent,
    updateConfigSyncStatus,
    uploadSettingsLoading, downloadSettingsLoading, syncConfigLoading,
    downloadSettingsMenuVisible,
    needsReload,
    acquireCloudSync, releaseCloudSync,
  } = deps;

  async function uploadSettingsCloud(profile: WebDAVProfile | null): Promise<void> {
    const webdav = await getWebDAVClientAndPath(profile, 'settings', toast);
    if (!webdav) return;
    if (!acquireCloudSync(toast)) return;

    try {
      uploadSettingsLoading.value = true;

      const config = await configStore.get<UserConfig>('config');
      if (!config) {
        throw new Error('无法读取本地配置');
      }

      const jsonContent = JSON.stringify(config, null, 2);
      let uploadContent = jsonContent;
      if (secureStorage.isPasswordMode()) {
        uploadContent = await secureStorage.encrypt(jsonContent);
      }
      await webdav.client.putFile(webdav.remotePath, uploadContent);

      updateConfigSyncStatus(profile, 'success');
      await writeSyncLog('upload_settings_cloud', 'success', undefined, profile);
      toast.showConfig('success', TOAST_MESSAGES.sync.uploadSuccess('config'));
    } catch (error) {
      const errorCode = extractErrorCode(error);
      log.error('上传配置失败:', error);
      updateConfigSyncStatus(profile, 'failed', errorCode);
      await writeSyncLog('upload_settings_cloud', 'failed', errorCode, profile);
      toast.showConfig('error', TOAST_MESSAGES.sync.uploadFailed(errorCode));
    } finally {
      uploadSettingsLoading.value = false;
      releaseCloudSync();
    }
  }

  async function downloadSettingsOverwrite(profile: WebDAVProfile | null): Promise<void> {
    downloadSettingsMenuVisible.value = false;

    const webdav = await getWebDAVClientAndPath(profile, 'settings', toast);
    if (!webdav) return;

    const confirmed = await confirmDialog(
      '本地的所有配置（包括 WebDAV 连接信息）将被云端数据替换。此操作不可撤销。',
      { header: '覆盖本地配置', acceptLabel: '覆盖', acceptClass: 'p-button-danger' }
    );
    if (!confirmed) return;
    if (!acquireCloudSync(toast)) return;

    try {
      downloadSettingsLoading.value = true;

      const rawContent = await webdav.client.getFile(webdav.remotePath);

      if (!rawContent) {
        throw new Error('云端配置文件不存在');
      }

      let content = rawContent;
      if (isPasswordEncryptedData(rawContent.trim())) {
        content = await tryDecryptContent(rawContent.trim());
      }

      const importedConfig = JSON.parse(content) as unknown;

      if (!isValidUserConfig(importedConfig)) {
        updateConfigSyncStatus(profile, 'failed', '云端数据格式无效');
        toast.showConfig('error', TOAST_MESSAGES.sync.downloadFailed('云端配置文件内容格式无效'));
        return;
      }

      await configStore.set('config', importedConfig);
      await configStore.save();

      updateConfigSyncStatus(profile, 'success');
      await writeSyncLog('download_settings_cloud', 'success', undefined, profile);
      toast.showConfig('success', TOAST_MESSAGES.sync.downloadSuccess('config'));

      needsReload.value = true;
    } catch (error) {
      if (error instanceof Error && error.message === 'user_cancelled') return;
      const errorCode = extractErrorCode(error);
      log.error('下载配置失败:', error);
      updateConfigSyncStatus(profile, 'failed', errorCode);
      await writeSyncLog('download_settings_cloud', 'failed', errorCode, profile);
      toast.showConfig('error', TOAST_MESSAGES.sync.downloadFailed(errorCode));
    } finally {
      downloadSettingsLoading.value = false;
      releaseCloudSync();
    }
  }

  async function downloadSettingsMerge(profile: WebDAVProfile | null): Promise<void> {
    downloadSettingsMenuVisible.value = false;

    const webdav = await getWebDAVClientAndPath(profile, 'settings', toast);
    if (!webdav) return;
    if (!acquireCloudSync(toast)) return;

    try {
      downloadSettingsLoading.value = true;

      const currentConfig = await configStore.get<UserConfig>('config');
      const rawContent = await webdav.client.getFile(webdav.remotePath);

      if (!rawContent) {
        throw new Error('云端配置文件不存在');
      }

      let content = rawContent;
      if (isPasswordEncryptedData(rawContent.trim())) {
        content = await tryDecryptContent(rawContent.trim());
      }

      const importedConfig = JSON.parse(content) as unknown;

      if (!isValidUserConfig(importedConfig)) {
        updateConfigSyncStatus(profile, 'failed', '云端数据格式无效');
        toast.error('下载失败', '云端配置文件内容格式无效，可能不是配置数据');
        return;
      }

      const mergedConfig: UserConfig = {
        ...importedConfig,
        webdav: currentConfig?.webdav || importedConfig.webdav
      };

      await configStore.set('config', mergedConfig);
      await configStore.save();

      updateConfigSyncStatus(profile, 'success');
      await writeSyncLog('download_settings_cloud', 'success', undefined, profile);
      toast.success('配置已从云端恢复（保留本地 WebDAV）');

      needsReload.value = true;
    } catch (error) {
      if (error instanceof Error && error.message === 'user_cancelled') return;
      const errorCode = extractErrorCode(error);
      log.error('合并下载配置失败:', error);
      updateConfigSyncStatus(profile, 'failed', errorCode);
      await writeSyncLog('download_settings_cloud', 'failed', errorCode, profile);
      toast.error('下载失败', errorCode);
    } finally {
      downloadSettingsLoading.value = false;
      releaseCloudSync();
    }
  }

  async function syncConfig(profile: WebDAVProfile | null): Promise<void> {
    if (!profile) return;
    const webdav = await getWebDAVClientAndPath(profile, 'settings', toast);
    if (!webdav) return;
    if (!acquireCloudSync(toast)) return;

    let stage: 'download' | 'upload' = 'download';
    // Why: 需要在外层 catch 里根据是否已合并云端数据来决定 toast 文案，所以声明挪到 try 之外
    let hasCloudData = false;

    try {
      syncConfigLoading.value = true;

      const currentConfig = await configStore.get<UserConfig>('config');

      // 步骤 1：拉取云端配置并合并到本地（保留本地 WebDAV 配置）
      try {
        const rawContent = await webdav.client.getFile(webdav.remotePath);
        if (rawContent) {
          let contentStr = rawContent;
          if (isPasswordEncryptedData(rawContent.trim())) {
            contentStr = await tryDecryptContent(rawContent.trim());
          }
          const importedConfig = JSON.parse(contentStr) as unknown;
          if (!isValidUserConfig(importedConfig)) {
            throw new Error('云端配置文件内容格式无效');
          }

          hasCloudData = true;

          // Why: 首次使用/配置缺失场景下 currentConfig 为 null，若仅在 currentConfig 存在时保存，
          // 云端合法配置会被静默丢弃，随后 step 2 读不到本地配置抛"无法读取本地配置"
          if (currentConfig) {
            const mergedConfig: UserConfig = {
              ...importedConfig,
              webdav: currentConfig.webdav,
            };
            await configStore.set('config', mergedConfig);
            await configStore.save();
          } else {
            await configStore.set('config', importedConfig);
            await configStore.save();
          }
        }
      } catch (downloadError) {
        // Why: 原实现 catch {} 会连 user_cancelled（用户取消输密码）和网络/解密/JSON 错误
        // 一起吞掉，直接进入上传步骤有覆盖云端合法数据的风险。
        // - user_cancelled 必须向外抛，让上层 return 掉整个同步流程；
        // - 只有远端文件不存在可以容忍；认证、网络、JSON/格式错误必须中止，避免覆盖云端。
        if (downloadError instanceof Error && downloadError.message === 'user_cancelled') {
          throw downloadError;
        }
        if (!isWebDAVNotFoundError(downloadError)) {
          log.error('拉取云端配置失败，已中止以避免覆盖云端数据:', downloadError);
          throw downloadError;
        }
        log.warn('云端配置文件不存在，将按首次同步处理');
      }

      // 步骤 2：将本地配置上传到云端
      stage = 'upload';
      const finalConfig = await configStore.get<UserConfig>('config');
      if (!finalConfig) throw new Error('无法读取本地配置');

      const jsonContent = JSON.stringify(finalConfig, null, 2);
      let uploadContent = jsonContent;
      if (secureStorage.isPasswordMode()) {
        uploadContent = await secureStorage.encrypt(jsonContent);
      }
      await webdav.client.putFile(webdav.remotePath, uploadContent);

      updateConfigSyncStatus(profile, 'success');
      await writeSyncLog('sync_settings', 'success', undefined, profile);
      toast.success('已同步配置');

      if (hasCloudData) {
        needsReload.value = true;
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'user_cancelled') return;
      const errorCode = extractErrorCode(error);
      log.error('配置同步失败:', error);
      await writeSyncLog('sync_settings', 'failed', errorCode, profile);

      if (stage === 'upload') {
        // Why: hasCloudData=false 时 step 1 实际上什么都没合并，旧文案会误导用户"云端数据已覆盖本地"。
        if (hasCloudData) {
          updateConfigSyncStatus(profile, 'partial', errorCode);
          toast.error('云端数据已合并到本地，但上传失败', errorCode);
        } else {
          updateConfigSyncStatus(profile, 'failed', errorCode);
          toast.error('同步失败：本地配置上传失败', errorCode);
        }
      } else {
        updateConfigSyncStatus(profile, 'failed', errorCode);
        toast.error('同步失败：无法获取云端配置', errorCode);
      }
    } finally {
      syncConfigLoading.value = false;
      releaseCloudSync();
    }
  }

  return {
    uploadSettingsCloud,
    downloadSettingsOverwrite,
    downloadSettingsMerge,
    syncConfig,
  };
}
