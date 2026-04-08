// 备份与同步 - 云端同步操作（上传/下载/双向同步）

import type { Ref } from 'vue';
import { historyDB } from '../../services/HistoryDatabase';
import { invalidateCache } from '../useHistory';
import { emitHistoryUpdated } from '../../events/cacheEvents';
import { useToast } from '../useToast';
import { useConfirm } from '../useConfirm';
import { TOAST_MESSAGES } from '../../constants';
import type { UserConfig, WebDAVProfile, HistoryItem } from '../../config/types';
import { isValidUserConfig } from '../../config/types';
import { configStore } from '../../store/instances';
import { secureStorage, isPasswordEncryptedData } from '../../crypto';
import { createLogger } from '../../utils/logger';
import { writeSyncLog, extractErrorCode, getWebDAVClientAndPath } from './backupSyncUtils';

const log = createLogger('BackupSync');

export interface BackupCloudDeps {
  toast: ReturnType<typeof useToast>;
  confirmDialog: ReturnType<typeof useConfirm>['confirm'];
  tryDecryptContent: (content: string) => Promise<string>;
  updateConfigSyncStatus: (profile: WebDAVProfile | null, result: 'success' | 'failed' | 'partial', error?: string) => void;
  updateHistorySyncStatus: (profile: WebDAVProfile | null, result: 'success' | 'failed' | 'partial', error?: string) => void;
  uploadSettingsLoading: Ref<boolean>;
  downloadSettingsLoading: Ref<boolean>;
  uploadHistoryLoading: Ref<boolean>;
  downloadHistoryLoading: Ref<boolean>;
  syncConfigLoading: Ref<boolean>;
  syncHistoryLoading: Ref<boolean>;
  uploadHistoryMenuVisible: Ref<boolean>;
  downloadSettingsMenuVisible: Ref<boolean>;
  downloadHistoryMenuVisible: Ref<boolean>;
}

export function createBackupCloudOps(deps: BackupCloudDeps) {
  const {
    toast, confirmDialog, tryDecryptContent,
    updateConfigSyncStatus, updateHistorySyncStatus,
    uploadSettingsLoading, downloadSettingsLoading,
    uploadHistoryLoading, downloadHistoryLoading,
    syncConfigLoading, syncHistoryLoading,
    uploadHistoryMenuVisible, downloadSettingsMenuVisible, downloadHistoryMenuVisible,
  } = deps;

  // ==================== 云端同步 - 配置 ====================

  async function uploadSettingsCloud(profile: WebDAVProfile | null): Promise<void> {
    const webdav = await getWebDAVClientAndPath(profile, 'settings', toast);
    if (!webdav) return;

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

      updateConfigSyncStatus(profile,'success');
      await writeSyncLog('upload_settings_cloud', 'success', undefined, profile);
      toast.showConfig('success', TOAST_MESSAGES.sync.uploadSuccess('config'));
    } catch (error) {
      const errorCode = extractErrorCode(error);
      log.error('上传配置失败:', error);
      updateConfigSyncStatus(profile,'failed', errorCode);
      await writeSyncLog('upload_settings_cloud', 'failed', errorCode, profile);
      toast.showConfig('error', TOAST_MESSAGES.sync.uploadFailed(errorCode));
    } finally {
      uploadSettingsLoading.value = false;
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

      let importedConfig = JSON.parse(content) as UserConfig;

      if (!isValidUserConfig(importedConfig)) {
        updateConfigSyncStatus(profile,'failed', '云端数据格式无效');
        toast.showConfig('error', TOAST_MESSAGES.sync.downloadFailed('云端配置文件内容格式无效'));
        return;
      }

      await configStore.set('config', importedConfig);
      await configStore.save();

      updateConfigSyncStatus(profile,'success');
      await writeSyncLog('download_settings_cloud', 'success', undefined, profile);
      toast.showConfig('success', TOAST_MESSAGES.sync.downloadSuccess('config'));

      setTimeout(() => {
        toast.showConfig('info', TOAST_MESSAGES.sync.refreshHint);
      }, 1000);
    } catch (error) {
      if (error instanceof Error && error.message === 'user_cancelled') return;
      const errorCode = extractErrorCode(error);
      log.error('下载配置失败:', error);
      updateConfigSyncStatus(profile,'failed', errorCode);
      await writeSyncLog('download_settings_cloud', 'failed', errorCode, profile);
      toast.showConfig('error', TOAST_MESSAGES.sync.downloadFailed(errorCode));
    } finally {
      downloadSettingsLoading.value = false;
    }
  }

  async function downloadSettingsMerge(profile: WebDAVProfile | null): Promise<void> {
    downloadSettingsMenuVisible.value = false;

    const webdav = await getWebDAVClientAndPath(profile, 'settings', toast);
    if (!webdav) return;

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

      let importedConfig = JSON.parse(content) as UserConfig;

      if (!isValidUserConfig(importedConfig)) {
        updateConfigSyncStatus(profile,'failed', '云端数据格式无效');
        toast.error('下载失败', '云端配置文件内容格式无效，可能不是配置数据');
        return;
      }

      const mergedConfig: UserConfig = {
        ...importedConfig,
        webdav: currentConfig?.webdav || importedConfig.webdav
      };

      await configStore.set('config', mergedConfig);
      await configStore.save();

      updateConfigSyncStatus(profile,'success');
      await writeSyncLog('download_settings_cloud', 'success', undefined, profile);
      toast.success('配置已从云端恢复（保留本地 WebDAV）');

      setTimeout(() => {
        toast.info('请刷新页面以使配置生效');
      }, 1000);
    } catch (error) {
      if (error instanceof Error && error.message === 'user_cancelled') return;
      const errorCode = extractErrorCode(error);
      log.error('合并下载配置失败:', error);
      updateConfigSyncStatus(profile,'failed', errorCode);
      await writeSyncLog('download_settings_cloud', 'failed', errorCode, profile);
      toast.error('下载失败', errorCode);
    } finally {
      downloadSettingsLoading.value = false;
    }
  }

  // ==================== 云端同步 - 历史记录 ====================

  async function uploadHistoryForce(profile: WebDAVProfile | null): Promise<void> {
    uploadHistoryMenuVisible.value = false;

    const webdav = await getWebDAVClientAndPath(profile, 'history', toast);
    if (!webdav) return;

    const confirmed = await confirmDialog(
      '云端现有的所有记录将被删除，替换为本地数据。此操作不可撤销。',
      { header: '强制覆盖云端', acceptLabel: '覆盖', acceptClass: 'p-button-danger' }
    );
    if (!confirmed) return;

    try {
      uploadHistoryLoading.value = true;

      const count = await historyDB.getCount();
      if (count === 0) {
        toast.warn('没有可上传的历史记录');
        return;
      }

      const jsonContent = await historyDB.exportToJSON();
      await webdav.client.putFile(webdav.remotePath, jsonContent);

      updateHistorySyncStatus(profile,'success');
      await writeSyncLog('upload_history_cloud', 'success', `${count} 条记录`, profile);
      toast.success(`已强制覆盖云端记录（${count} 条）`);
    } catch (error) {
      const errorCode = extractErrorCode(error);
      log.error('强制上传历史记录失败:', error);
      updateHistorySyncStatus(profile,'failed', errorCode);
      await writeSyncLog('upload_history_cloud', 'failed', errorCode, profile);
      toast.error('上传失败', errorCode);
    } finally {
      uploadHistoryLoading.value = false;
    }
  }

  async function uploadHistoryMerge(profile: WebDAVProfile | null): Promise<void> {
    uploadHistoryMenuVisible.value = false;

    const webdav = await getWebDAVClientAndPath(profile, 'history', toast);
    if (!webdav) return;

    try {
      uploadHistoryLoading.value = true;

      const localCount = await historyDB.getCount();
      if (localCount === 0) {
        toast.warn('没有可上传的历史记录');
        return;
      }

      const localJsonContent = await historyDB.exportToJSON();
      const localItems = JSON.parse(localJsonContent) as HistoryItem[];

      let cloudItems: HistoryItem[] = [];
      try {
        const content = await webdav.client.getFile(webdav.remotePath);
        if (content) {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            cloudItems = parsed;
          }
        }
      } catch (e) {
        log.info('云端文件不存在或无法解析，将进行全量上传');
      }

      const itemMap = new Map<string, HistoryItem>();

      cloudItems.forEach(item => {
        if (item.id) {
          itemMap.set(item.id, item);
        }
      });

      localItems.forEach(item => {
        if (item.id) {
          const existing = itemMap.get(item.id);
          if (!existing || (item.timestamp && item.timestamp > (existing.timestamp || 0))) {
            itemMap.set(item.id, item);
          }
        } else {
          item.id = crypto.randomUUID();
          itemMap.set(item.id, item);
        }
      });

      const mergedItems = Array.from(itemMap.values());
      mergedItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      const jsonContent = JSON.stringify(mergedItems, null, 2);
      await webdav.client.putFile(webdav.remotePath, jsonContent);

      const newCount = mergedItems.length - cloudItems.length;
      updateHistorySyncStatus(profile,'success');
      await writeSyncLog('upload_history_cloud', 'success', `共 ${mergedItems.length} 条`, profile);
      toast.success(
        `合并上传完成：共 ${mergedItems.length} 条记录`,
        newCount > 0 ? `新增 ${newCount} 条到云端` : '云端数据已是最新'
      );
    } catch (error) {
      const errorCode = extractErrorCode(error);
      log.error('智能合并上传失败:', error);
      updateHistorySyncStatus(profile,'failed', errorCode);
      await writeSyncLog('upload_history_cloud', 'failed', errorCode, profile);
      toast.error('上传失败', errorCode);
    } finally {
      uploadHistoryLoading.value = false;
    }
  }

  async function uploadHistoryIncremental(profile: WebDAVProfile | null): Promise<void> {
    uploadHistoryMenuVisible.value = false;

    const webdav = await getWebDAVClientAndPath(profile, 'history', toast);
    if (!webdav) return;

    try {
      uploadHistoryLoading.value = true;

      const localCount = await historyDB.getCount();
      if (localCount === 0) {
        toast.warn('没有可上传的历史记录');
        return;
      }

      const localJsonContent = await historyDB.exportToJSON();
      const localItems = JSON.parse(localJsonContent) as HistoryItem[];

      let cloudItems: HistoryItem[] = [];
      const cloudIdSet = new Set<string>();

      try {
        const content = await webdav.client.getFile(webdav.remotePath);
        if (content) {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            cloudItems = parsed;
            cloudItems.forEach(item => {
              if (item.id) cloudIdSet.add(item.id);
            });
          }
        }
      } catch (e) {
        log.info('云端文件不存在，将进行全量上传');
      }

      const newItems = localItems.filter(item => item.id && !cloudIdSet.has(item.id));

      if (newItems.length === 0) {
        updateHistorySyncStatus(profile,'success');
        toast.info('无需上传', '本地没有新增的记录');
        return;
      }

      const mergedItems = [...cloudItems, ...newItems];
      mergedItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      const jsonContent = JSON.stringify(mergedItems, null, 2);
      await webdav.client.putFile(webdav.remotePath, jsonContent);

      updateHistorySyncStatus(profile,'success');
      await writeSyncLog('upload_history_cloud', 'success', `新增 ${newItems.length} 条`, profile);
      toast.success(
        `增量上传完成`,
        `新增 ${newItems.length} 条记录到云端，共 ${mergedItems.length} 条`
      );
    } catch (error) {
      const errorCode = extractErrorCode(error);
      log.error('增量上传失败:', error);
      updateHistorySyncStatus(profile,'failed', errorCode);
      await writeSyncLog('upload_history_cloud', 'failed', errorCode, profile);
      toast.error('上传失败', errorCode);
    } finally {
      uploadHistoryLoading.value = false;
    }
  }

  async function downloadHistoryOverwrite(profile: WebDAVProfile | null): Promise<void> {
    downloadHistoryMenuVisible.value = false;

    const webdav = await getWebDAVClientAndPath(profile, 'history', toast);
    if (!webdav) return;

    const confirmed = await confirmDialog(
      '本地现有的所有记录将被删除，替换为云端数据。此操作不可撤销。',
      { header: '覆盖本地数据', acceptLabel: '覆盖', acceptClass: 'p-button-danger' }
    );
    if (!confirmed) return;

    try {
      downloadHistoryLoading.value = true;

      const content = await webdav.client.getFile(webdav.remotePath);

      if (!content) {
        throw new Error('云端历史记录文件不存在');
      }

      const cloudItems = JSON.parse(content) as HistoryItem[];

      if (!Array.isArray(cloudItems)) {
        throw new Error('云端数据格式错误：期望数组格式');
      }

      await historyDB.importFromJSON(content, 'replace');

      invalidateCache();
      emitHistoryUpdated();

      updateHistorySyncStatus(profile,'success');
      await writeSyncLog('download_history_cloud', 'success', `${cloudItems.length} 条记录`, profile);
      toast.success(`下载完成：共 ${cloudItems.length} 条记录（覆盖本地）`);
    } catch (error) {
      const errorCode = extractErrorCode(error);
      log.error('下载历史记录失败:', error);
      updateHistorySyncStatus(profile,'failed', errorCode);
      await writeSyncLog('download_history_cloud', 'failed', errorCode, profile);
      toast.error('下载失败', errorCode);
    } finally {
      downloadHistoryLoading.value = false;
    }
  }

  async function downloadHistoryMerge(profile: WebDAVProfile | null): Promise<void> {
    downloadHistoryMenuVisible.value = false;

    const webdav = await getWebDAVClientAndPath(profile, 'history', toast);
    if (!webdav) return;

    try {
      downloadHistoryLoading.value = true;

      const content = await webdav.client.getFile(webdav.remotePath);

      if (!content) {
        throw new Error('云端历史记录文件不存在');
      }

      const cloudItems = JSON.parse(content) as HistoryItem[];

      if (!Array.isArray(cloudItems)) {
        throw new Error('云端数据格式错误：期望数组格式');
      }

      const countBefore = await historyDB.getCount();

      await historyDB.importFromJSON(content, 'merge');

      const countAfter = await historyDB.getCount();

      invalidateCache();
      emitHistoryUpdated();

      const addedCount = countAfter - countBefore;
      updateHistorySyncStatus(profile,'success');
      await writeSyncLog('download_history_cloud', 'success', `共 ${countAfter} 条，新增 ${addedCount} 条`, profile);
      toast.success(
        `下载完成：共 ${countAfter} 条记录`,
        `新增 ${addedCount} 条，合并 ${cloudItems.length - addedCount} 条`
      );
    } catch (error) {
      const errorCode = extractErrorCode(error);
      log.error('下载历史记录失败:', error);
      updateHistorySyncStatus(profile,'failed', errorCode);
      await writeSyncLog('download_history_cloud', 'failed', errorCode, profile);
      toast.error('下载失败', errorCode);
    } finally {
      downloadHistoryLoading.value = false;
    }
  }

  // ==================== 双向同步 ====================

  async function syncConfig(profile: WebDAVProfile | null): Promise<void> {
    if (!profile) return;
    const webdav = await getWebDAVClientAndPath(profile, 'settings', toast);
    if (!webdav) return;

    let stage: 'download' | 'upload' = 'download';

    try {
      syncConfigLoading.value = true;

      const currentConfig = await configStore.get<UserConfig>('config');
      let hasCloudData = false;

      // 步骤 1：拉取云端配置并合并到本地（保留本地 WebDAV 配置）
      try {
        const rawContent = await webdav.client.getFile(webdav.remotePath);
        if (rawContent) {
          let contentStr = rawContent;
          if (isPasswordEncryptedData(rawContent.trim())) {
            contentStr = await tryDecryptContent(rawContent.trim());
          }
          let importedConfig = JSON.parse(contentStr) as UserConfig;
          if (isValidUserConfig(importedConfig)) {
            hasCloudData = true;

            if (currentConfig) {
              const mergedConfig: UserConfig = {
                ...importedConfig,
                webdav: currentConfig.webdav,
              };
              await configStore.set('config', mergedConfig);
              await configStore.save();
            }
          }
        }
      } catch {
        // 云端文件不存在，跳过下载步骤
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

      updateConfigSyncStatus(profile,'success');
      await writeSyncLog('sync_settings', 'success', undefined, profile);
      toast.success('配置同步完成');

      if (hasCloudData) {
        setTimeout(() => {
          toast.info('请刷新页面以使配置生效');
        }, 1000);
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'user_cancelled') return;
      const errorCode = extractErrorCode(error);
      log.error('配置同步失败:', error);
      await writeSyncLog('sync_settings', 'failed', errorCode, profile);

      if (stage === 'upload') {
        updateConfigSyncStatus(profile,'partial', errorCode);
        toast.error('云端数据已合并到本地，但上传失败', errorCode);
      } else {
        updateConfigSyncStatus(profile,'failed', errorCode);
        toast.error('同步失败：无法获取云端配置', errorCode);
      }
    } finally {
      syncConfigLoading.value = false;
    }
  }

  async function syncHistory(profile: WebDAVProfile | null): Promise<void> {
    if (!profile) return;
    const webdav = await getWebDAVClientAndPath(profile, 'history', toast);
    if (!webdav) return;

    let stage: 'download' | 'upload' = 'download';

    try {
      syncHistoryLoading.value = true;

      // 步骤 1：拉取云端数据合并到本地
      let cloudItems: HistoryItem[] = [];
      try {
        const content = await webdav.client.getFile(webdav.remotePath);
        if (content) {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            cloudItems = parsed;
            await historyDB.importFromJSON(content, 'merge');
            invalidateCache();
            emitHistoryUpdated();
          }
        }
      } catch {
        // 云端文件不存在，跳过下载步骤
      }

      // 步骤 2：将本地数据合并上传到云端
      stage = 'upload';
      const localCount = await historyDB.getCount();
      if (localCount === 0 && cloudItems.length === 0) {
        toast.warn('没有可同步的历史记录');
        return;
      }

      const localJsonContent = await historyDB.exportToJSON();
      const localItems = JSON.parse(localJsonContent) as HistoryItem[];

      const itemMap = new Map<string, HistoryItem>();
      cloudItems.forEach(item => {
        if (item.id) itemMap.set(item.id, item);
      });
      localItems.forEach(item => {
        if (item.id) {
          const existing = itemMap.get(item.id);
          if (!existing || (item.timestamp && item.timestamp > (existing.timestamp || 0))) {
            itemMap.set(item.id, item);
          }
        } else {
          item.id = crypto.randomUUID();
          itemMap.set(item.id, item);
        }
      });

      const mergedItems = Array.from(itemMap.values());
      mergedItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      const jsonContent = JSON.stringify(mergedItems, null, 2);
      await webdav.client.putFile(webdav.remotePath, jsonContent);

      updateHistorySyncStatus(profile,'success');
      await writeSyncLog('sync_history', 'success', `共 ${mergedItems.length} 条记录`, profile);
      toast.success(`同步完成：共 ${mergedItems.length} 条记录`);
    } catch (error) {
      const errorCode = extractErrorCode(error);
      log.error('历史记录同步失败:', error);
      await writeSyncLog('sync_history', 'failed', errorCode, profile);

      if (stage === 'upload') {
        updateHistorySyncStatus(profile,'partial', errorCode);
        toast.error('云端数据已合并到本地，但上传失败', errorCode);
      } else {
        updateHistorySyncStatus(profile,'failed', errorCode);
        toast.error('同步失败：无法获取云端记录', errorCode);
      }
    } finally {
      syncHistoryLoading.value = false;
    }
  }

  return {
    uploadSettingsCloud,
    downloadSettingsOverwrite,
    downloadSettingsMerge,
    uploadHistoryForce,
    uploadHistoryMerge,
    uploadHistoryIncremental,
    downloadHistoryOverwrite,
    downloadHistoryMerge,
    syncConfig,
    syncHistory,
  };
}
