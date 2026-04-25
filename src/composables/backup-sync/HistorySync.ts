// src/composables/backup-sync/HistorySync.ts
// 云端历史记录同步：强制/合并/增量上传 + 覆盖/合并下载 + 双向同步

import { historyDB } from '../../services/HistoryDatabase';
import { invalidateCache } from '../useHistory';
import { emitHistoryUpdated } from '../../events/cacheEvents';
import type { WebDAVProfile, HistoryItem } from '../../config/types';
import { createLogger } from '../../utils/logger';
import { writeSyncLog, extractErrorCode, getWebDAVClientAndPath } from './backupSyncUtils';
import type { BackupCloudDeps } from './useBackupCloud';

const log = createLogger('HistorySync');

export function createHistorySyncOps(deps: BackupCloudDeps) {
  const {
    toast, confirmDialog,
    updateHistorySyncStatus,
    uploadHistoryLoading, downloadHistoryLoading, syncHistoryLoading,
    uploadHistoryMenuVisible, downloadHistoryMenuVisible,
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
      } catch {
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

      // 真正的"新增"应为本地独有的记录数（云端 id 集合的差集），
      // 而不是 mergedItems.length - cloudItems.length —— 后者在时间戳更新、
      // 或云端文件不存在（cloudItems=[]）等场景下会严重高估，误导用户
      const cloudIds = new Set(cloudItems.map(i => i.id).filter(Boolean));
      const newCount = localItems.reduce(
        (acc, item) => acc + (item.id && !cloudIds.has(item.id) ? 1 : 0),
        0,
      );
      updateHistorySyncStatus(profile, 'success');
      await writeSyncLog('upload_history_cloud', 'success', `共 ${mergedItems.length} 条`, profile);
      toast.success(
        '已合并上传',
        `共 ${mergedItems.length} 条记录，${newCount > 0 ? `新增 ${newCount} 条到云端` : '云端数据已是最新'}`
      );
    } catch (error) {
      const errorCode = extractErrorCode(error);
      log.error('智能合并上传失败:', error);
      updateHistorySyncStatus(profile, 'failed', errorCode);
      await writeSyncLog('upload_history_cloud', 'failed', errorCode, profile);
      toast.error('上传失败', `${errorCode}\n请检查网络或 WebDAV 配置后重试`);
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
      } catch {
        log.info('云端文件不存在，将进行全量上传');
      }

      const newItems = localItems.filter(item => item.id && !cloudIdSet.has(item.id));

      if (newItems.length === 0) {
        updateHistorySyncStatus(profile, 'success');
        toast.info('无需上传', '本地没有新增的记录');
        return;
      }

      const mergedItems = [...cloudItems, ...newItems];
      mergedItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      const jsonContent = JSON.stringify(mergedItems, null, 2);
      await webdav.client.putFile(webdav.remotePath, jsonContent);

      updateHistorySyncStatus(profile, 'success');
      await writeSyncLog('upload_history_cloud', 'success', `新增 ${newItems.length} 条`, profile);
      toast.success(
        '已增量上传',
        `新增 ${newItems.length} 条记录到云端，共 ${mergedItems.length} 条`
      );
    } catch (error) {
      const errorCode = extractErrorCode(error);
      log.error('增量上传失败:', error);
      updateHistorySyncStatus(profile, 'failed', errorCode);
      await writeSyncLog('upload_history_cloud', 'failed', errorCode, profile);
      toast.error('上传失败', `${errorCode}\n请检查网络或 WebDAV 配置后重试`);
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
