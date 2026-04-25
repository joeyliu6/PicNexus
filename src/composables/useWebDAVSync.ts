// WebDAV 同步管理 Composable
// v2.10: 从 SettingsView.vue 中提取，提供统一的同步状态管理

import { ref, computed, type Ref } from 'vue';
import { configStore, syncStatusStore } from '../store/instances';
import { WebDAVClient } from '../utils/webdav';
import { historyDB } from '../services/HistoryDatabase';
import { useToast } from './useToast';
import type {
  UserConfig,
  SyncStatus,
  WebDAVProfile,
  HistoryItem
} from '../config/types';
import { isValidUserConfig } from '../config/types';
import { createLogger } from '../utils/logger';
import { formatTimestampFull } from '../utils/formatters';

const log = createLogger('WebDAVSync');

// ==================== 数据验证 ====================

/**
 * 验证云端历史记录数据格式
 * 确保解析后的数据是 HistoryItem 数组，防止损坏/篡改的数据导致运行时崩溃
 */
function validateHistoryItems(data: unknown): HistoryItem[] {
  if (!Array.isArray(data)) {
    throw new Error(
      `云端历史记录格式无效：期望数组，实际为 ${typeof data}`
    );
  }

  return data.filter((item: unknown) => {
    if (typeof item !== 'object' || item === null) return false;
    const record = item as Record<string, unknown>;
    return typeof record.id === 'string' && record.id.length > 0;
  }) as HistoryItem[];
}

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

// ==================== 共享状态 ====================

const syncStatus: Ref<SyncStatus> = ref({
  syncByProfile: {},
});

const isSyncing = ref(false);
const currentProgress: Ref<SyncProgress | null> = ref(null);
const pendingConflict: Ref<SyncConflict | null> = ref(null);

// Why: 多次同步共享同一 currentProgress ref，若每次 finally 裸跑 setTimeout(clearProgress, 2000)，
// 旧 timer 会在下一次同步进行中触发，把正在显示的进度条硬清空。保存 id 以便新调用先取消旧 timer。
let pendingClearTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleClearProgress(delayMs = 2000): void {
  if (pendingClearTimer !== null) {
    clearTimeout(pendingClearTimer);
  }
  pendingClearTimer = setTimeout(() => {
    currentProgress.value = null;
    pendingClearTimer = null;
  }, delayMs);
}

// ==================== 辅助函数 ====================

/** 格式化时间戳为字符串（统一来源 utils/formatters） */
const formatTimestamp = formatTimestampFull;

/**
 * 稳定键序序列化：递归对对象 key 排序，保证等价对象产生相同字符串
 * Why: 配置对象在不同版本/迁移路径下插入顺序不同，直接 stringify 对比会误判为"有冲突"
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => {
    return JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]);
  });
  return '{' + parts.join(',') + '}';
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
      log.error('加载同步状态失败:', e);
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
      log.error('保存同步状态失败:', e);
    }
  }

  /**
   * 更新同步状态
   */
  function updateStatus(
    target: SyncTarget,
    result: 'success' | 'failed',
    profile?: WebDAVProfile,
    error?: string
  ): void {
    if (!profile) return;
    const timestamp = formatTimestamp(new Date());
    const profileId = profile.id;

    if (!syncStatus.value.syncByProfile[profileId]) {
      syncStatus.value.syncByProfile[profileId] = {
        providerName: profile.name,
        configLastSync: null,
        configSyncResult: null,
        historyLastSync: null,
        historySyncResult: null,
      };
    }

    const record = syncStatus.value.syncByProfile[profileId];
    record.providerName = profile.name;

    if (target === 'settings') {
      record.configLastSync = timestamp;
      record.configSyncResult = result;
      record.configSyncError = error;
    } else {
      record.historyLastSync = timestamp;
      record.historySyncResult = result;
      record.historySyncError = error;
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
    _options: { force?: boolean } = {}
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
      updateStatus('settings', 'success', profile);
      toast.success('上传成功', '配置已上传到云端');

      return { success: true, target: 'settings', operation: 'upload', message: '配置已上传到云端' };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setProgress('settings', 'upload', 'error', 0, errorMsg);
      updateStatus('settings', 'failed', profile, errorMsg);
      toast.error('上传失败', errorMsg);
      return { success: false, target: 'settings', operation: 'upload', message: errorMsg };
    } finally {
      isSyncing.value = false;
      scheduleClearProgress();
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
      updateStatus('settings', 'success', profile);

      const successMsg = mode === 'merge' ? '配置已合并（保留本地 WebDAV）' : '配置已覆盖';
      toast.success('下载成功', successMsg);

      return { success: true, target: 'settings', operation: 'download', message: successMsg };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setProgress('settings', 'download', 'error', 0, errorMsg);
      updateStatus('settings', 'failed', profile, errorMsg);
      toast.error('下载失败', errorMsg);
      return { success: false, target: 'settings', operation: 'download', message: errorMsg };
    } finally {
      isSyncing.value = false;
      scheduleClearProgress();
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
          const cloudItems = validateHistoryItems(JSON.parse(remoteContent));

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
      updateStatus('history', 'success', profile);
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
      updateStatus('history', 'failed', profile, errorMsg);
      toast.error('上传失败', errorMsg);
      return { success: false, target: 'history', operation: 'upload', message: errorMsg };
    } finally {
      isSyncing.value = false;
      scheduleClearProgress();
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

      const cloudItems = validateHistoryItems(JSON.parse(content));

      // 导入记录
      setProgress('history', 'download', 'merging', 70, '导入记录...');
      await historyDB.open();
      const mergeStrategy = mode === 'merge' ? 'merge' : 'replace';
      const importedCount = await historyDB.importFromJSON(JSON.stringify(cloudItems), mergeStrategy);

      setProgress('history', 'download', 'done', 100, '下载完成');
      updateStatus('history', 'success', profile);

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
      updateStatus('history', 'failed', profile, errorMsg);
      toast.error('下载失败', errorMsg);
      return { success: false, target: 'history', operation: 'download', message: errorMsg };
    } finally {
      isSyncing.value = false;
      scheduleClearProgress();
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
      if (typeof remoteConfig !== 'object' || remoteConfig === null || Array.isArray(remoteConfig)) {
        log.warn('远程配置格式无效，跳过冲突检测');
        return null;
      }
      const localConfig = await configStore.get<UserConfig>('config');

      // Why: 直接 JSON.stringify 依赖属性插入顺序，等价对象因键序不同会误报冲突
      // （例如不同版本写入顺序不同），改用稳定键序比较
      if (stableStringify(localConfig) === stableStringify(remoteConfig)) {
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
      log.warn('冲突检测失败:', e);
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
