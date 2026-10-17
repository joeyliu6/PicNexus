// 云端上传记录同步：合并同步 / 用本机覆盖云端。
// 不弹通知：结果（上传、下载各几条）返回给调用方写在状态行，失败抛 SyncFailure。
// 没有「用云端覆盖本机」：S14 写明覆盖本机只动配置、上传记录不受影响，记录只做合并。

import { historyDB } from '@/services/database';
import { mergeHistoryCollections } from '@/services/database/HistoryMerge';
import { invalidateCache } from '@/composables/history/useHistory';
import { emitHistoryUpdated } from '@/events/cacheEvents';
import type { WebDAVProfile, HistoryItem } from '@/config/types';
import { createLogger } from '@/utils/logger';
import {
  writeSyncLog, extractErrorCode, getWebDAVClientAndPath, isWebDAVNotFoundError,
  parseCloudHistoryForUpload, SyncFailure, SYNC_NOT_CONFIGURED,
} from './backupSyncUtils';
import { recordSync } from './syncRecords';

const log = createLogger('HistorySync');

export interface HistorySyncResult {
  /** 推到云端的新增 + 更新条数 */
  uploaded: number;
  /** 从云端拉进本机的新增 + 更新条数 */
  downloaded: number;
  /** 合并后的总条数 */
  total: number;
}

async function client(profile: WebDAVProfile) {
  const webdav = await getWebDAVClientAndPath(profile, 'history');
  if (!webdav) throw new SyncFailure(SYNC_NOT_CONFIGURED, 'history');
  return webdav;
}

/** 合并同步：先把云端记录并进本机，再把合并结果传回云端（两边都没变化时不写云端） */
export async function syncHistory(profile: WebDAVProfile): Promise<HistorySyncResult> {
  const webdav = await client(profile);
  let cloudItems: HistoryItem[] = [];
  let downloaded = 0;

  // 步骤 1：拉取云端并合并进本机。只容忍「云端没这个文件」（首次同步）；认证、网络、格式错误必须中止——
  // 继续往下就会拿本机整个覆盖云端，历史记录比配置更不可逆
  try {
    let content: string | null;
    try {
      content = await webdav.client.getFile(webdav.remotePath);
    } catch (error) {
      if (!isWebDAVNotFoundError(error)) throw error;
      content = null;
    }
    // 不可用（0 字节 / 不是数组）在拿到内容之后判，与上面「文件不存在」的子串匹配无关
    const payload = parseCloudHistoryForUpload(content);
    if (payload.kind === 'unusable') throw new Error(payload.reason);
    if (payload.kind === 'items') {
      cloudItems = payload.items;
      const imported = await historyDB.importFromJSON(content as string, 'merge');
      downloaded = imported.added + imported.updated;
      if (downloaded > 0) {
        invalidateCache();
        emitHistoryUpdated();
      }
    }
  } catch (error) {
    const reason = extractErrorCode(error);
    log.error('拉取云端历史失败，已中止以避免覆盖云端数据:', error);
    await recordSync(profile, 'history', 'failed', reason);
    await writeSyncLog('sync_history', 'failed', reason, profile);
    throw new SyncFailure(reason, 'history');
  }

  // 步骤 2：把合并结果传回云端
  let uploaded = 0;
  let total = cloudItems.length;
  try {
    const localItems = await historyDB.getAllItems();
    for (const item of localItems) {
      if (!item.id) item.id = crypto.randomUUID();
    }
    const { items, addedCount, updatedCount } = mergeHistoryCollections(cloudItems, localItems);
    uploaded = addedCount + updatedCount;
    total = items.length;
    if (uploaded > 0) await webdav.client.putFile(webdav.remotePath, JSON.stringify(items, null, 2));
  } catch (error) {
    const reason = extractErrorCode(error);
    log.error('历史记录同步上传失败:', error);
    await recordSync(profile, 'history', downloaded > 0 ? 'partial' : 'failed', reason);
    await writeSyncLog('sync_history', 'failed', reason, profile);
    throw new SyncFailure(reason, 'history', downloaded > 0);
  }

  await recordSync(profile, 'history', 'success');
  const summary = uploaded || downloaded ? `上传 ${uploaded} 条 · 下载 ${downloaded} 条` : `无变化，共 ${total} 条记录`;
  await writeSyncLog('sync_history', 'success', summary, profile);
  return { uploaded, downloaded, total };
}

/** 用本机覆盖云端（上传记录）：云端文件损坏、合并同步被中止时的出路 */
export async function pushHistory(profile: WebDAVProfile): Promise<number> {
  const webdav = await client(profile);
  try {
    const count = await historyDB.getCount();
    await webdav.client.putFile(webdav.remotePath, await historyDB.exportToJSON());
    await recordSync(profile, 'history', 'success');
    await writeSyncLog('upload_history_cloud', 'success', `${count} 条记录`, profile);
    return count;
  } catch (error) {
    const reason = extractErrorCode(error);
    log.error('覆盖云端记录失败:', error);
    await recordSync(profile, 'history', 'failed', reason);
    await writeSyncLog('upload_history_cloud', 'failed', reason, profile);
    throw new SyncFailure(reason, 'history');
  }
}
