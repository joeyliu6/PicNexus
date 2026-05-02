// src/composables/backup-sync/HistorySync.ts
// 云端历史记录同步：强制/合并/增量上传 + 覆盖/合并下载 + 双向同步

import { historyDB } from '../../services/HistoryDatabase';
import { mergeHistoryCollections } from '../../services/database/HistoryMerge';
import { invalidateCache } from '../useHistory';
import { emitHistoryUpdated } from '../../events/cacheEvents';
import type { WebDAVProfile, HistoryItem } from '../../config/types';
import { createLogger } from '../../utils/logger';
import { writeSyncLog, extractErrorCode, getWebDAVClientAndPath, isWebDAVNotFoundError } from './backupSyncUtils';
import type { BackupCloudDeps } from './useBackupCloud';

const log = createLogger('HistorySync');

export function createHistorySyncOps(deps: BackupCloudDeps) {
  const {
    toast, confirmDialog,
    updateHistorySyncStatus,
    uploadHistoryLoading, downloadHistoryLoading, syncHistoryLoading,
    uploadHistoryMenuVisible, downloadHistoryMenuVisible,
    acquireCloudSync, releaseCloudSync,
  } = deps;

  async function uploadHistoryForce(profile: WebDAVProfile | null): Promise<void> {
    uploadHistoryMenuVisible.value = false;

    const webdav = await getWebDAVClientAndPath(profile, 'history', toast);
    if (!webdav) return;

    const confirmed = await confirmDialog(
      '云端现有的所有记录将被删除，替换为本地数据。此操作不可撤销。',
      { header: '强制覆盖云端', acceptLabel: '覆盖', acceptClass: 'p-button-danger' }
    );
    if (!confirmed) return;
    if (!acquireCloudSync(toast)) return;

    try {
      uploadHistoryLoading.value = true;

      const count = await historyDB.getCount();
      if (count === 0) {
        toast.warn('没有可上传的历史记录');
        return;
      }

      const jsonContent = await historyDB.exportToJSON();
      await webdav.client.putFile(webdav.remotePath, jsonContent);

      updateHistorySyncStatus(profile, 'success');
      await writeSyncLog('upload_history_cloud', 'success', `${count} 条记录`, profile);
      toast.success(`已强制覆盖云端记录（${count} 条）`);
    } catch (error) {
      const errorCode = extractErrorCode(error);
      log.error('强制上传历史记录失败:', error);
      updateHistorySyncStatus(profile, 'failed', errorCode);
      await writeSyncLog('upload_history_cloud', 'failed', errorCode, profile);
      toast.error('上传失败', `${errorCode}\n请检查网络或 WebDAV 配置后重试`);
    } finally {
      uploadHistoryLoading.value = false;
      releaseCloudSync();
    }
  }

  async function uploadHistoryMerge(profile: WebDAVProfile | null): Promise<void> {
    uploadHistoryMenuVisible.value = false;

    const webdav = await getWebDAVClientAndPath(profile, 'history', toast);
    if (!webdav) return;
    if (!acquireCloudSync(toast)) return;

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
      } catch (downloadError) {
        if (downloadError instanceof Error && downloadError.message === 'user_cancelled') {
          throw downloadError;
        }
        if (!isWebDAVNotFoundError(downloadError)) {
          log.error('拉取云端历史失败，已中止以避免覆盖云端数据:', downloadError);
          throw downloadError;
        }
        log.info('云端历史文件不存在，将进行全量上传');
      }

      for (const item of localItems) {
        if (!item.id) item.id = crypto.randomUUID();
      }

      const { items: mergedItems, addedCount, updatedCount } = mergeHistoryCollections(cloudItems, localItems);

      const jsonContent = JSON.stringify(mergedItems, null, 2);
      await webdav.client.putFile(webdav.remotePath, jsonContent);

      updateHistorySyncStatus(profile, 'success');
      await writeSyncLog('upload_history_cloud', 'success', `共 ${mergedItems.length} 条`, profile);
      toast.success(
        '已合并上传',
        `共 ${mergedItems.length} 条记录，新增 ${addedCount} 条，更新 ${updatedCount} 条`
      );
    } catch (error) {
      const errorCode = extractErrorCode(error);
      log.error('智能合并上传失败:', error);
      updateHistorySyncStatus(profile, 'failed', errorCode);
      await writeSyncLog('upload_history_cloud', 'failed', errorCode, profile);
      toast.error('上传失败', `${errorCode}\n请检查网络或 WebDAV 配置后重试`);
    } finally {
      uploadHistoryLoading.value = false;
      releaseCloudSync();
    }
  }

  async function uploadHistoryIncremental(profile: WebDAVProfile | null): Promise<void> {
    uploadHistoryMenuVisible.value = false;

    const webdav = await getWebDAVClientAndPath(profile, 'history', toast);
    if (!webdav) return;
    if (!acquireCloudSync(toast)) return;

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
      } catch (downloadError) {
        if (downloadError instanceof Error && downloadError.message === 'user_cancelled') {
          throw downloadError;
        }
        if (!isWebDAVNotFoundError(downloadError)) {
          log.error('拉取云端历史失败，已中止以避免覆盖云端数据:', downloadError);
          throw downloadError;
        }
        log.info('云端历史文件不存在，将进行全量上传');
      }

      for (const item of localItems) {
        if (!item.id) item.id = crypto.randomUUID();
      }

      const { items: mergedItems, addedCount, updatedCount } = mergeHistoryCollections(cloudItems, localItems);

      if (addedCount === 0 && updatedCount === 0) {
        updateHistorySyncStatus(profile, 'success');
        toast.info('无需上传', '本地没有新增或更新的记录');
        return;
      }

      const jsonContent = JSON.stringify(mergedItems, null, 2);
      await webdav.client.putFile(webdav.remotePath, jsonContent);

      updateHistorySyncStatus(profile, 'success');
      await writeSyncLog(
        'upload_history_cloud',
        'success',
        `新增 ${addedCount} 条，更新 ${updatedCount} 条`,
        profile,
      );
      toast.success(
        '已增量上传',
        `新增 ${addedCount} 条、更新 ${updatedCount} 条记录到云端，共 ${mergedItems.length} 条`
      );
    } catch (error) {
      const errorCode = extractErrorCode(error);
      log.error('增量上传失败:', error);
      updateHistorySyncStatus(profile, 'failed', errorCode);
      await writeSyncLog('upload_history_cloud', 'failed', errorCode, profile);
      toast.error('上传失败', `${errorCode}\n请检查网络或 WebDAV 配置后重试`);
    } finally {
      uploadHistoryLoading.value = false;
      releaseCloudSync();
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
    if (!acquireCloudSync(toast)) return;

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

      updateHistorySyncStatus(profile, 'success');
      await writeSyncLog('download_history_cloud', 'success', `${cloudItems.length} 条记录`, profile);
      toast.success('已下载', `共 ${cloudItems.length} 条记录（覆盖本地）`);
    } catch (error) {
      const errorCode = extractErrorCode(error);
      log.error('下载历史记录失败:', error);
      updateHistorySyncStatus(profile, 'failed', errorCode);
      await writeSyncLog('download_history_cloud', 'failed', errorCode, profile);
      toast.error('下载失败', `${errorCode}\n请检查网络或 WebDAV 配置后重试`);
    } finally {
      downloadHistoryLoading.value = false;
      releaseCloudSync();
    }
  }

  async function downloadHistoryMerge(profile: WebDAVProfile | null): Promise<void> {
    downloadHistoryMenuVisible.value = false;

    const webdav = await getWebDAVClientAndPath(profile, 'history', toast);
    if (!webdav) return;
    if (!acquireCloudSync(toast)) return;

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
      updateHistorySyncStatus(profile, 'success');
      await writeSyncLog('download_history_cloud', 'success', `共 ${countAfter} 条，新增 ${addedCount} 条`, profile);
      toast.success(
        `下载完成：共 ${countAfter} 条记录`,
        `新增 ${addedCount} 条，合并 ${cloudItems.length - addedCount} 条`
      );
    } catch (error) {
      const errorCode = extractErrorCode(error);
      log.error('下载历史记录失败:', error);
      updateHistorySyncStatus(profile, 'failed', errorCode);
      await writeSyncLog('download_history_cloud', 'failed', errorCode, profile);
      toast.error('下载失败', `${errorCode}\n请检查网络或 WebDAV 配置后重试`);
    } finally {
      downloadHistoryLoading.value = false;
      releaseCloudSync();
    }
  }

  async function syncHistory(profile: WebDAVProfile | null): Promise<void> {
    if (!profile) return;
    const webdav = await getWebDAVClientAndPath(profile, 'history', toast);
    if (!webdav) return;
    if (!acquireCloudSync(toast)) return;

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
      } catch (downloadError) {
        // Why: 原实现是空 catch，会把 401/网络错/解密失败/JSON 异常和"云端文件不存在"
        // 一视同仁地吞掉，下一步的合并上传就会用本地数据整个覆盖云端，丢失增量。
        // 历史记录比配置更不可逆，所以只容忍"文件不存在"（404 / 路径不存在），
        // 其他错误必须抛出，让外层 catch 标记 failed 并提示用户，避免覆盖云端。
        if (downloadError instanceof Error && downloadError.message === 'user_cancelled') {
          throw downloadError;
        }
        if (!isWebDAVNotFoundError(downloadError)) {
          log.error('拉取云端历史失败，已中止以避免覆盖云端数据:', downloadError);
          throw downloadError;
        }
        log.info('云端历史文件不存在，将进行全量上传');
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

      for (const item of localItems) {
        if (!item.id) item.id = crypto.randomUUID();
      }

      const { items: mergedItems } = mergeHistoryCollections(cloudItems, localItems);

      const jsonContent = JSON.stringify(mergedItems, null, 2);
      await webdav.client.putFile(webdav.remotePath, jsonContent);

      updateHistorySyncStatus(profile, 'success');
      await writeSyncLog('sync_history', 'success', `共 ${mergedItems.length} 条记录`, profile);
      toast.success('已同步', `共 ${mergedItems.length} 条记录`);
    } catch (error) {
      const errorCode = extractErrorCode(error);
      log.error('历史记录同步失败:', error);
      await writeSyncLog('sync_history', 'failed', errorCode, profile);

      if (stage === 'upload') {
        updateHistorySyncStatus(profile, 'partial', errorCode);
        toast.error('云端数据已合并到本地，但上传失败', errorCode);
      } else {
        updateHistorySyncStatus(profile, 'failed', errorCode);
        toast.error('同步失败：无法获取云端记录', errorCode);
      }
    } finally {
      syncHistoryLoading.value = false;
      releaseCloudSync();
    }
  }

  return {
    uploadHistoryForce,
    uploadHistoryMerge,
    uploadHistoryIncremental,
    downloadHistoryOverwrite,
    downloadHistoryMerge,
    syncHistory,
  };
}
