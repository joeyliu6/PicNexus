// src/composables/useWebDAVSync.ts
// WebDAV 同步管理 Composable
// v2.10: 从 SettingsView.vue 中提取，提供统一的同步状态管理

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { Store } from '../store';
import { WebDAVClient } from '../utils/webdav';
import { historyDB } from '../services/HistoryDatabase';
import { useToast } from './useToast';
import type {
  UserConfig,
  SyncStatus,
  WebDAVProfile,
  HistoryItem
} from '../config/types';
import { isValidUserConfig, migrateConfig } from '../config/types';

// ==================== 类型定义 ====================

/** 同步操作类型 */
export type SyncOperation = 'upload' | 'download';

/** 同步目标 */
export type SyncTarget = 'settings' | 'history';

/** 冲突类型 */
export type ConflictType = 'local_newer' | 'remote_newer' | 'diverged';

/** 冲突解决策略 */
export type ConflictResolution = 'use_local' | 'use_remote' | 'merge' | 'cancel';

/** 冲突信息 */
export interface SyncConflict {
  target: SyncTarget;
  conflictType: ConflictType;
  localTimestamp: number | null;
  remoteTimestamp: number | null;
  message: string;
}

/** 同步进度阶段 */
export type SyncStage = 'idle' | 'connecting' | 'checking' | 'downloading' | 'uploading' | 'merging' | 'done' | 'error';

/** 同步进度 */
export interface SyncProgress {
  target: SyncTarget;
  operation: SyncOperation;
  stage: SyncStage;
  percent: number;
  message: string;
}

/** 同步结果 */
export interface SyncResult {
  success: boolean;
  target: SyncTarget;
  operation: SyncOperation;
  message: string;
  itemsAffected?: number;
  hadConflict?: boolean;
  resolution?: ConflictResolution;
}

// ==================== 存储实例（模块级别单例） ====================

const syncStatusStore = new Store('.sync-status.dat');
const configStore = new Store('.settings.dat');

// ==================== 共享状态 ====================

const syncStatus: Ref<SyncStatus> = ref({
  configLastSync: null,
  configSyncResult: null,
  configSyncError: undefined,
  historyLastSync: null,
  historySyncResult: null,
  historySyncError: undefined
});

const isSyncing = ref(false);
const currentProgress: Ref<SyncProgress | null> = ref(null);
const pendingConflict: Ref<SyncConflict | null> = ref(null);

// ==================== 辅助函数 ====================

/**
 * 格式化时间戳为字符串
 */
function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 获取远程文件路径
 */
function getRemotePath(profile: WebDAVProfile, target: SyncTarget): string {
  let remotePath = profile.remotePath || '/PicNexus/';
  if (!remotePath.endsWith('/')) {
    remotePath += '/';
  }
  return `${remotePath}${target}.json`;
}

// ==================== 主 Composable ====================

/**
 * WebDAV 同步管理 Composable
 *
 * @example
 * ```typescript
 * const {
 *   syncStatus,
 *   isSyncing,
 *   progress,
 *   uploadSettings,
 *   downloadSettings
 * } = useWebDAVSync();
 *
 * // 上传配置
 * await uploadSettings(activeProfile);
 *
 * // 下载配置（合并模式）
 * await downloadSettings(activeProfile, { mode: 'merge' });
 * ```
 */
export function useWebDAVSync() {
  const toast = useToast();

  // ==================== 状态管理 ====================

  /**
   * 加载同步状态
   */
  async function loadSyncStatus(): Promise<void> {
    try {
      const saved = await syncStatusStore.get<SyncStatus>('status');
      if (saved) {
        syncStatus.value = { ...syncStatus.value, ...saved };
      }
    } catch (e) {
      console.error('[WebDAV同步] 加载同步状态失败:', e);
    }
  }

  /**
   * 保存同步状态
   */
  async function saveSyncStatus(): Promise<void> {
    try {
      await syncStatusStore.set('status', syncStatus.value);
      await syncStatusStore.save();
    } catch (e) {
      console.error('[WebDAV同步] 保存同步状态失败:', e);
    }
  }

  /**
   * 更新同步状态
   */
  function updateStatus(
    target: SyncTarget,
    result: 'success' | 'failed',
    error?: string
  ): void {
    const timestamp = formatTimestamp(new Date());

    if (target === 'settings') {
      syncStatus.value.configLastSync = timestamp;
      syncStatus.value.configSyncResult = result;
      syncStatus.value.configSyncError = error;
    } else {
      syncStatus.value.historyLastSync = timestamp;
      syncStatus.value.historySyncResult = result;
      syncStatus.value.historySyncError = error;
    }

    saveSyncStatus();
  }

  /**
   * 设置进度
   */
  function setProgress(
    target: SyncTarget,
    operation: SyncOperation,
    stage: SyncStage,
    percent: number,
    message: string
  ): void {
    currentProgress.value = { target, operation, stage, percent, message };
  }

  /**
   * 清除进度
   */
  function clearProgress(): void {
    currentProgress.value = null;
  }

  // ==================== WebDAV 客户端 ====================

  /**
   * 获取 WebDAV 客户端
   */
  async function getClient(profile: WebDAVProfile): Promise<WebDAVClient> {
    return await WebDAVClient.fromEncryptedConfig({
      url: profile.url,
      username: profile.username,
      password: profile.password,
      passwordEncrypted: profile.passwordEncrypted,
      remotePath: profile.remotePath
    });
  }

  // ==================== 配置同步 ====================

  /**
   * 上传配置到云端
   */
  async function uploadSettings(
    profile: WebDAVProfile,
    options: { force?: boolean } = {}
  ): Promise<SyncResult> {
    if (isSyncing.value) {
      return { success: false, target: 'settings', operation: 'upload', message: '正在同步中' };
    }

    isSyncing.value = true;
    setProgress('settings', 'upload', 'connecting', 10, '连接 WebDAV...');

    try {
      const client = await getClient(profile);
      const remotePath = getRemotePath(profile, 'settings');

      // 读取本地配置
      setProgress('settings', 'upload', 'uploading', 50, '上传配置...');
      const config = await configStore.get<UserConfig>('config');
      if (!config) {
        throw new Error('无法读取本地配置');
      }

      // 上传
      await client.putFile(remotePath, JSON.stringify(config, null, 2));

      setProgress('settings', 'upload', 'done', 100, '上传完成');
      updateStatus('settings', 'success');
      toast.success('上传成功', '配置已上传到云端');

      return { success: true, target: 'settings', operation: 'upload', message: '配置已上传到云端' };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setProgress('settings', 'upload', 'error', 0, errorMsg);
      updateStatus('settings', 'failed', errorMsg);
      toast.error('上传失败', errorMsg);
      return { success: false, target: 'settings', operation: 'upload', message: errorMsg };
    } finally {
      isSyncing.value = false;
      setTimeout(clearProgress, 2000);
    }
  }

  /**
   * 从云端下载配置
   */
  async function downloadSettings(
    profile: WebDAVProfile,
    options: { mode?: 'overwrite' | 'merge' } = {}
  ): Promise<SyncResult> {
    if (isSyncing.value) {
      return { success: false, target: 'settings', operation: 'download', message: '正在同步中' };
    }

    const mode = options.mode || 'merge';
    isSyncing.value = true;
    setProgress('settings', 'download', 'connecting', 10, '连接 WebDAV...');

    try {
      const client = await getClient(profile);
      const remotePath = getRemotePath(profile, 'settings');

      // 下载远程配置
      setProgress('settings', 'download', 'downloading', 40, '下载配置...');
      const content = await client.getFile(remotePath);

      if (!content) {
        throw new Error('云端配置文件不存在');
      }

      let importedConfig = JSON.parse(content) as UserConfig;

      // 验证配置格式
      if (!isValidUserConfig(importedConfig)) {
        throw new Error('云端配置格式无效');
      }

      importedConfig = migrateConfig(importedConfig);

      // 合并或覆盖
      setProgress('settings', 'download', 'merging', 70, '应用配置...');

      if (mode === 'merge') {
        // 合并模式：保留本地 WebDAV 配置
        const currentConfig = await configStore.get<UserConfig>('config');
        importedConfig = {
          ...importedConfig,
          webdav: currentConfig?.webdav || importedConfig.webdav
        };
      }

      await configStore.set('config', importedConfig);
      await configStore.save();

      setProgress('settings', 'download', 'done', 100, '下载完成');
      updateStatus('settings', 'success');

      const successMsg = mode === 'merge' ? '配置已合并（保留本地 WebDAV）' : '配置已覆盖';
      toast.success('下载成功', successMsg);

      return { success: true, target: 'settings', operation: 'download', message: successMsg };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setProgress('settings', 'download', 'error', 0, errorMsg);
      updateStatus('settings', 'failed', errorMsg);
      toast.error('下载失败', errorMsg);
      return { success: false, target: 'settings', operation: 'download', message: errorMsg };
    } finally {
      isSyncing.value = false;
      setTimeout(clearProgress, 2000);
    }
  }

  // ==================== 历史记录同步 ====================

  /**
   * 上传历史记录到云端
   */
  async function uploadHistory(
    profile: WebDAVProfile,
    options: { mode?: 'force' | 'merge' | 'incremental' } = {}
  ): Promise<SyncResult> {
    if (isSyncing.value) {
      return { success: false, target: 'history', operation: 'upload', message: '正在同步中' };
    }

    const mode = options.mode || 'merge';
    isSyncing.value = true;
    setProgress('history', 'upload', 'connecting', 10, '连接 WebDAV...');

    try {
      const client = await getClient(profile);
      const remotePath = getRemotePath(profile, 'history');

      // 读取本地历史记录
      setProgress('history', 'upload', 'downloading', 30, '读取本地记录...');
      await historyDB.open();
      const localItems: HistoryItem[] = [];
      for await (const batch of historyDB.getAllStream(1000)) {
        localItems.push(...batch);
      }

      let uploadItems: HistoryItem[] = localItems;

      if (mode === 'merge' || mode === 'incremental') {
        // 下载云端记录
        setProgress('history', 'upload', 'checking', 50, '读取云端记录...');
        const remoteContent = await client.getFile(remotePath);

        if (remoteContent) {
          const cloudItems = JSON.parse(remoteContent) as HistoryItem[];

          if (mode === 'incremental') {
            // 增量模式：只上传云端不存在的记录
            const cloudIds = new Set(cloudItems.map(item => item.id));
            const newItems = localItems.filter(item => !cloudIds.has(item.id));
            uploadItems = [...cloudItems, ...newItems];
          } else {
            // 合并模式：本地优先（基于时间戳）
            const itemMap = new Map<string, HistoryItem>();
            cloudItems.forEach(item => itemMap.set(item.id, item));
            localItems.forEach(item => {
              const existing = itemMap.get(item.id);
              if (!existing || (item.timestamp > (existing.timestamp || 0))) {
                itemMap.set(item.id, item);
              }
            });
            uploadItems = Array.from(itemMap.values());
          }
        }
      }

      // 上传
      setProgress('history', 'upload', 'uploading', 80, '上传记录...');
      await client.putFile(remotePath, JSON.stringify(uploadItems, null, 2));

      setProgress('history', 'upload', 'done', 100, '上传完成');
      updateStatus('history', 'success');
      toast.success('上传成功', `已上传 ${uploadItems.length} 条记录`);

      return {
        success: true,
        target: 'history',
        operation: 'upload',
        message: `已上传 ${uploadItems.length} 条记录`,
        itemsAffected: uploadItems.length
      };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setProgress('history', 'upload', 'error', 0, errorMsg);
      updateStatus('history', 'failed', errorMsg);
      toast.error('上传失败', errorMsg);
      return { success: false, target: 'history', operation: 'upload', message: errorMsg };
    } finally {
      isSyncing.value = false;
      setTimeout(clearProgress, 2000);
    }
  }

  /**
   * 从云端下载历史记录
   */
  async function downloadHistory(
    profile: WebDAVProfile,
    options: { mode?: 'overwrite' | 'merge' } = {}
  ): Promise<SyncResult> {
    if (isSyncing.value) {
      return { success: false, target: 'history', operation: 'download', message: '正在同步中' };
    }

    const mode = options.mode || 'merge';
    isSyncing.value = true;
    setProgress('history', 'download', 'connecting', 10, '连接 WebDAV...');

    try {
      const client = await getClient(profile);
      const remotePath = getRemotePath(profile, 'history');

      // 下载云端记录
      setProgress('history', 'download', 'downloading', 40, '下载记录...');
      const content = await client.getFile(remotePath);

      if (!content) {
        throw new Error('云端历史记录不存在');
      }

      const cloudItems = JSON.parse(content) as HistoryItem[];

      // 导入记录
      setProgress('history', 'download', 'merging', 70, '导入记录...');
      await historyDB.open();
      const mergeStrategy = mode === 'merge' ? 'merge' : 'replace';
      const importedCount = await historyDB.importFromJSON(JSON.stringify(cloudItems), mergeStrategy);

      setProgress('history', 'download', 'done', 100, '下载完成');
      updateStatus('history', 'success');

      const successMsg = `已导入 ${importedCount} 条记录`;
      toast.success('下载成功', successMsg);

      return {
        success: true,
        target: 'history',
        operation: 'download',
        message: successMsg,
        itemsAffected: importedCount
      };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setProgress('history', 'download', 'error', 0, errorMsg);
      updateStatus('history', 'failed', errorMsg);
      toast.error('下载失败', errorMsg);
      return { success: false, target: 'history', operation: 'download', message: errorMsg };
    } finally {
      isSyncing.value = false;
      setTimeout(clearProgress, 2000);
    }
  }

  // ==================== 冲突处理 ====================

  /**
   * 检测配置冲突
   */
  async function checkConfigConflict(
    profile: WebDAVProfile
  ): Promise<SyncConflict | null> {
    try {
      const client = await getClient(profile);
      const remotePath = getRemotePath(profile, 'settings');
      const remoteContent = await client.getFile(remotePath);

      if (!remoteContent) return null;

      const remoteConfig = JSON.parse(remoteContent);
      const localConfig = await configStore.get<UserConfig>('config');

      // 简单对比：检查配置是否相同
      const localJson = JSON.stringify(localConfig, null, 0);
      const remoteJson = JSON.stringify(remoteConfig, null, 0);

      if (localJson === remoteJson) {
        return null;
      }

      return {
        target: 'settings',
        conflictType: 'diverged',
        localTimestamp: null,
        remoteTimestamp: null,
        message: '本地配置与云端配置不一致'
      };
    } catch (e) {
      console.warn('[WebDAV同步] 冲突检测失败:', e);
      return null;
    }
  }

  /**
   * 设置待处理的冲突
   */
  function setPendingConflict(conflict: SyncConflict | null): void {
    pendingConflict.value = conflict;
  }

  /**
   * 清除待处理的冲突
   */
  function clearPendingConflict(): void {
    pendingConflict.value = null;
  }

  /**
   * 解决冲突
   */
  async function resolveConflict(
    profile: WebDAVProfile,
    resolution: ConflictResolution
  ): Promise<SyncResult> {
    if (!pendingConflict.value) {
      return {
        success: false,
        target: 'settings',
        operation: 'upload',
        message: '没有待解决的冲突'
      };
    }

    const conflict = pendingConflict.value;
    clearPendingConflict();

    switch (resolution) {
      case 'use_local':
        if (conflict.target === 'settings') {
          return uploadSettings(profile, { force: true });
        } else {
          return uploadHistory(profile, { mode: 'force' });
        }

      case 'use_remote':
        if (conflict.target === 'settings') {
          return downloadSettings(profile, { mode: 'overwrite' });
        } else {
          return downloadHistory(profile, { mode: 'overwrite' });
        }

      case 'merge':
        if (conflict.target === 'settings') {
          return downloadSettings(profile, { mode: 'merge' });
        } else {
          return downloadHistory(profile, { mode: 'merge' });
        }

      case 'cancel':
      default:
        return {
          success: false,
          target: conflict.target,
          operation: 'upload',
          message: '已取消',
          resolution: 'cancel'
        };
    }
  }

  // ==================== 返回值 ====================

  return {
    // 状态
    syncStatus: computed(() => syncStatus.value),
    isSyncing: computed(() => isSyncing.value),
    progress: computed(() => currentProgress.value),
    pendingConflict: computed(() => pendingConflict.value),

    // 生命周期
    loadSyncStatus,

    // 配置同步
    uploadSettings,
    downloadSettings,

    // 历史记录同步
    uploadHistory,
    downloadHistory,

    // 冲突处理
    checkConfigConflict,
    setPendingConflict,
    clearPendingConflict,
    resolveConflict
  };
}
