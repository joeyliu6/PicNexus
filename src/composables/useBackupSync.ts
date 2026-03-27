// 备份与同步 Composable
// 从 SettingsView.vue 中抽取，提供本地/云端备份功能

import { ref, type Ref } from 'vue';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import { WebDAVClient } from '../utils/webdav';
import { historyDB, type SyncLogOperation } from '../services/HistoryDatabase';
import { invalidateCache } from './useHistory';
import { emitHistoryUpdated } from '../events/cacheEvents';
import { useToast } from './useToast';
import { TOAST_MESSAGES } from '../constants';
import { useConfirm } from './useConfirm';
import type {
  UserConfig,
  SyncStatus,
  ProfileSyncRecord,
  WebDAVProfile,
  HistoryItem
} from '../config/types';
import { DEFAULT_CONFIG, isValidUserConfig, isValidHistoryItem } from '../config/types';
import { configStore, syncStatusStore } from '../store/instances';
import { secureStorage, isPasswordEncryptedData, decryptWithPassword } from '../crypto';
import { createLogger } from '../utils/logger';

const log = createLogger('BackupSync');

/**
 * 写入同步操作日志（静默失败，不影响主流程）
 */
async function writeSyncLog(
  operation: SyncLogOperation,
  result: 'success' | 'failed',
  details?: string,
  profile?: WebDAVProfile | null
): Promise<void> {
  try {
    await historyDB.addSyncLog({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      operation,
      result,
      details,
      profileId: profile?.id ?? undefined,
      profileName: profile?.name ?? undefined,
    });
  } catch (e) {
    log.warn('写入同步日志失败:', e);
  }
}

// ==================== 类型定义 ====================

/** useBackupSync 返回值类型 */
export interface UseBackupSyncReturn {
  // 状态
  syncStatus: Ref<SyncStatus>;
  getProfileSyncRecord: (profileId: string) => ProfileSyncRecord | null;
  getAllSyncRecords: () => Record<string, ProfileSyncRecord>;

  // Loading 状态
  exportSettingsLoading: Ref<boolean>;
  importSettingsLoading: Ref<boolean>;
  uploadSettingsLoading: Ref<boolean>;
  downloadSettingsLoading: Ref<boolean>;
  exportHistoryLoading: Ref<boolean>;
  importHistoryLoading: Ref<boolean>;
  importHistoryProgress: Ref<number>;
  uploadHistoryLoading: Ref<boolean>;
  downloadHistoryLoading: Ref<boolean>;

  // 下拉菜单状态
  uploadHistoryMenuVisible: Ref<boolean>;
  downloadSettingsMenuVisible: Ref<boolean>;
  downloadHistoryMenuVisible: Ref<boolean>;

  // 折叠状态
  configSectionExpanded: Ref<boolean>;
  historySectionExpanded: Ref<boolean>;

  // 生命周期
  loadSyncStatus: () => Promise<void>;
  saveSyncStatus: () => Promise<void>;

  // 本地备份
  exportSettingsLocal: () => Promise<void>;
  importSettingsLocal: () => Promise<void>;
  exportHistoryLocal: () => Promise<void>;
  importHistoryLocal: () => Promise<void>;

  // 云端同步
  uploadSettingsCloud: (profile: WebDAVProfile | null) => Promise<void>;
  downloadSettingsOverwrite: (profile: WebDAVProfile | null) => Promise<void>;
  downloadSettingsMerge: (profile: WebDAVProfile | null) => Promise<void>;
  uploadHistoryForce: (profile: WebDAVProfile | null) => Promise<void>;
  uploadHistoryMerge: (profile: WebDAVProfile | null) => Promise<void>;
  uploadHistoryIncremental: (profile: WebDAVProfile | null) => Promise<void>;
  downloadHistoryOverwrite: (profile: WebDAVProfile | null) => Promise<void>;
  downloadHistoryMerge: (profile: WebDAVProfile | null) => Promise<void>;

  // 双向同步
  syncConfigLoading: Ref<boolean>;
  syncHistoryLoading: Ref<boolean>;
  syncConfig: (profile: WebDAVProfile | null) => Promise<void>;
  syncHistory: (profile: WebDAVProfile | null) => Promise<void>;

  // 菜单控制
  toggleUploadHistoryMenu: () => void;
  toggleDownloadSettingsMenu: () => void;
  toggleDownloadHistoryMenu: () => void;
  closeAllMenus: () => void;

  // 密码请求（用于导入/下载加密数据时弹窗）
  passwordRequest: Ref<{ resolve: (password: string) => void; reject: (reason?: Error) => void } | null>;

  // 工具函数
  extractErrorCode: (error: unknown) => string;
  getFullTimestamp: () => string;
}

// ==================== 辅助函数 ====================

/**
 * 获取当前时间的完整格式字符串
 */
function getFullTimestamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

/**
 * 提取错误码（用于显示具体错误信息）
 */
function extractErrorCode(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);

  // 尝试提取 HTTP 状态码
  // 优先匹配 "HTTP 401"、"status: 401"、"status code 401" 等明确格式
  const httpMatch = msg.match(/(?:HTTP|status(?:\s*code)?)[:\s]*(\d{3})/i)
    // 如果没有明确格式，只匹配 4xx/5xx 错误码（避免误匹配端口号等）
    || msg.match(/\b([45]\d{2})\b/);
  if (httpMatch) {
    const code = httpMatch[1];
    const statusTexts: Record<string, string> = {
      '401': 'HTTP 401: 认证失败',
      '403': 'HTTP 403: 访问被拒绝',
      '404': 'HTTP 404: 文件不存在',
      '500': 'HTTP 500: 服务器错误',
      '502': 'HTTP 502: 网关错误',
      '503': 'HTTP 503: 服务不可用',
      '507': 'HTTP 507: 存储空间不足',
    };
    return statusTexts[code] || `HTTP ${code}`;
  }

  // 网络错误
  if (msg.includes('ECONNREFUSED')) return 'ECONNREFUSED: 连接被拒绝';
  if (msg.includes('ETIMEDOUT')) return 'ETIMEDOUT: 连接超时';
  if (msg.includes('ENOTFOUND')) return 'ENOTFOUND: 域名解析失败';
  if (msg.includes('fetch')) return '网络错误: 无法连接服务器';

  // 返回原始消息（截断）
  return msg.length > 50 ? msg.substring(0, 50) + '...' : msg;
}

/**
 * 获取 WebDAV 客户端和远程路径
 */
async function getWebDAVClientAndPath(
  profile: WebDAVProfile | null,
  fileType: 'settings' | 'history',
  toast: ReturnType<typeof useToast>
): Promise<{ client: WebDAVClient; remotePath: string } | null> {
  if (!profile || !profile.url || !profile.username || (!profile.password && !profile.passwordEncrypted)) {
    toast.showConfig('warn', TOAST_MESSAGES.sync.noWebDAV);
    return null;
  }

  const client = await WebDAVClient.fromEncryptedConfig({
    url: profile.url,
    username: profile.username,
    password: profile.password,
    passwordEncrypted: profile.passwordEncrypted,
    remotePath: profile.remotePath,
  });

  let remotePath = profile.remotePath || '/PicNexus/';
  if (remotePath.endsWith('/')) {
    remotePath += `${fileType}.json`;
  } else if (!remotePath.toLowerCase().endsWith('.json')) {
    remotePath += `/${fileType}.json`;
  } else {
    remotePath = remotePath.replace(/[^/]+\.json$/i, `${fileType}.json`);
  }

  return { client, remotePath };
}

// ==================== 主 Composable ====================

/**
 * 备份与同步 Composable
 *
 * @example
 * ```typescript
 * const {
 *   syncStatus,
 *   exportSettingsLocal,
 *   importSettingsLocal,
 *   uploadSettingsCloud
 * } = useBackupSync();
 *
 * // 导出配置到本地
 * await exportSettingsLocal();
 *
 * // 上传到云端
 * await uploadSettingsCloud(activeProfile);
 * ```
 */
export function useBackupSync(): UseBackupSyncReturn {
  const toast = useToast();
  const { confirm: confirmDialog, confirmThreeWay } = useConfirm();

  // ==================== 状态 ====================

  const syncStatus = ref<SyncStatus>({
    syncByProfile: {},
  });

  // Loading 状态
  const exportSettingsLoading = ref(false);
  const importSettingsLoading = ref(false);
  const uploadSettingsLoading = ref(false);
  const downloadSettingsLoading = ref(false);
  const exportHistoryLoading = ref(false);
  const importHistoryLoading = ref(false);
  const importHistoryProgress = ref(0);
  const uploadHistoryLoading = ref(false);
  const downloadHistoryLoading = ref(false);
  const syncConfigLoading = ref(false);
  const syncHistoryLoading = ref(false);

  // 下拉菜单状态
  const uploadHistoryMenuVisible = ref(false);
  const downloadSettingsMenuVisible = ref(false);
  const downloadHistoryMenuVisible = ref(false);

  // 折叠状态（默认关闭）
  const configSectionExpanded = ref(false);
  const historySectionExpanded = ref(false);

  // 密码请求状态（导入/下载加密数据时使用）
  const passwordRequest = ref<{ resolve: (password: string) => void; reject: (reason?: Error) => void } | null>(null);

  /**
   * 解密加密内容：始终要求用户输入密码
   */
  async function tryDecryptContent(encryptedContent: string): Promise<string> {
    const password = await new Promise<string>((resolve, reject) => {
      passwordRequest.value = { resolve, reject };
    });

    try {
      const result = await decryptWithPassword(encryptedContent, password);
      passwordRequest.value = null;
      return result;
    } catch (error) {
      passwordRequest.value = null;
      throw error;
    }
  }

  // ==================== 状态管理 ====================

  /**
   * 加载同步状态
   */
  async function loadSyncStatus(): Promise<void> {
    try {
      const saved = await syncStatusStore.get<Record<string, unknown>>('status');
      if (!saved) return;

      if ('syncByProfile' in saved) {
        syncStatus.value = saved as unknown as SyncStatus;
      } else {
        const legacy = saved as {
          configLastSync?: string | null;
          configSyncResult?: 'success' | 'failed' | null;
          configSyncError?: string;
          historyLastSync?: string | null;
          historySyncResult?: 'success' | 'failed' | null;
          historySyncError?: string;
          lastJdCheck?: number;
          qiyuCheckStatus?: SyncStatus['qiyuCheckStatus'];
        };
        const migrated: SyncStatus = {
          syncByProfile: {},
          lastJdCheck: legacy.lastJdCheck,
          qiyuCheckStatus: legacy.qiyuCheckStatus,
        };
        if (legacy.configLastSync || legacy.historyLastSync) {
          migrated.syncByProfile['__legacy__'] = {
            providerName: '未知服务',
            configLastSync: legacy.configLastSync ?? null,
            configSyncResult: legacy.configSyncResult ?? null,
            configSyncError: legacy.configSyncError,
            historyLastSync: legacy.historyLastSync ?? null,
            historySyncResult: legacy.historySyncResult ?? null,
            historySyncError: legacy.historySyncError,
          };
        }
        syncStatus.value = migrated;
        await saveSyncStatus();
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

  function ensureProfileRecord(profileId: string, profileName: string): ProfileSyncRecord {
    const profiles = syncStatus.value.syncByProfile;
    if (!profiles[profileId]) {
      profiles[profileId] = {
        providerName: profileName,
        configLastSync: null,
        configSyncResult: null,
        historyLastSync: null,
        historySyncResult: null,
      };
    }
    profiles[profileId].providerName = profileName;
    return profiles[profileId];
  }

  function updateConfigSyncStatus(profile: WebDAVProfile | null, result: 'success' | 'failed' | 'partial', error?: string): void {
    if (!profile) return;
    const record = ensureProfileRecord(profile.id, profile.name);
    record.configLastSync = getFullTimestamp();
    record.configSyncResult = result;
    record.configSyncError = error;
    saveSyncStatus();
  }

  function updateHistorySyncStatus(profile: WebDAVProfile | null, result: 'success' | 'failed' | 'partial', error?: string): void {
    if (!profile) return;
    const record = ensureProfileRecord(profile.id, profile.name);
    record.historyLastSync = getFullTimestamp();
    record.historySyncResult = result;
    record.historySyncError = error;
    saveSyncStatus();
  }

  function getProfileSyncRecord(profileId: string): ProfileSyncRecord | null {
    return syncStatus.value.syncByProfile[profileId] ?? null;
  }

  function getAllSyncRecords(): Record<string, ProfileSyncRecord> {
    return syncStatus.value.syncByProfile;
  }

  // ==================== 菜单控制 ====================

  function closeAllMenus(): void {
    uploadHistoryMenuVisible.value = false;
    downloadSettingsMenuVisible.value = false;
    downloadHistoryMenuVisible.value = false;
  }

  function createMenuToggle(menuVisible: Ref<boolean>) {
    return (): void => {
      const willOpen = !menuVisible.value;
      closeAllMenus();
      menuVisible.value = willOpen;
    };
  }

  const toggleUploadHistoryMenu = createMenuToggle(uploadHistoryMenuVisible);
  const toggleDownloadSettingsMenu = createMenuToggle(downloadSettingsMenuVisible);
  const toggleDownloadHistoryMenu = createMenuToggle(downloadHistoryMenuVisible);

  // ==================== 本地备份 ====================

  /**
   * 导出配置到本地文件
   */
  async function exportSettingsLocal(): Promise<void> {
    try {
      exportSettingsLoading.value = true;

      let config = await configStore.get<UserConfig>('config');

      if (!config || !isValidUserConfig(config)) {
        log.error('配置数据格式异常，使用默认配置');
        config = { ...DEFAULT_CONFIG };
        await configStore.set('config', config);
        await configStore.save();
        toast.showConfig('warn', TOAST_MESSAGES.config.resetWarning);
      }

      const jsonContent = JSON.stringify(config, null, 2);

      let outputContent = jsonContent;
      if (secureStorage.isPasswordMode()) {
        outputContent = await secureStorage.encrypt(jsonContent);
      }

      const filePath = await save({
        defaultPath: 'picnexus_settings.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });

      if (!filePath) {
        toast.showConfig('warn', TOAST_MESSAGES.common.cancelled);
        return;
      }

      await writeTextFile(filePath, outputContent);
      await writeSyncLog('export_settings_local', 'success');
      toast.showConfig('success', TOAST_MESSAGES.common.exportSuccess(1));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('导出配置失败:', error);
      await writeSyncLog('export_settings_local', 'failed', errorMsg);
      toast.showConfig('error', TOAST_MESSAGES.common.exportFailed(errorMsg));
    } finally {
      exportSettingsLoading.value = false;
    }
  }

  /**
   * 从本地文件导入配置
   */
  async function importSettingsLocal(): Promise<void> {
    try {
      importSettingsLoading.value = true;

      const filePath = await open({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        multiple: false
      });

      if (!filePath || Array.isArray(filePath)) {
        toast.showConfig('warn', TOAST_MESSAGES.common.cancelled);
        return;
      }

      const content = await readTextFile(filePath);

      let jsonContent = content;
      if (isPasswordEncryptedData(content.trim())) {
        jsonContent = await tryDecryptContent(content.trim());
      }

      let importedConfig = JSON.parse(jsonContent) as UserConfig;

      if (!isValidUserConfig(importedConfig)) {
        toast.showConfig('error', TOAST_MESSAGES.common.importFailed('文件内容不是有效的配置数据格式'));
        return;
      }

      const currentConfig = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;

      const result = await confirmThreeWay({
        header: '导入配置',
        message: '检测到配置文件包含 WebDAV 连接信息，请选择导入方式：',
        acceptLabel: '覆盖',
        rejectLabel: '仅保留 WebDAV 配置',
        icon: 'pi pi-exclamation-triangle'
      });

      if (result === 'dismiss') {
        toast.showConfig('warn', TOAST_MESSAGES.common.cancelled);
        return;
      }

      const shouldOverwriteWebDAV = result === 'accept';

      const mergedConfig: UserConfig = {
        ...importedConfig,
        webdav: shouldOverwriteWebDAV ? importedConfig.webdav : currentConfig.webdav
      };

      await configStore.set('config', mergedConfig);
      await configStore.save();

      await writeSyncLog('import_settings_local', 'success');
      toast.showConfig('success', TOAST_MESSAGES.common.importSuccess('配置已从本地文件导入'));

      setTimeout(() => {
        toast.showConfig('info', TOAST_MESSAGES.sync.refreshHint);
      }, 1000);
    } catch (error) {
      if (error instanceof Error && error.message === 'user_cancelled') return;
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('导入配置失败:', error);
      await writeSyncLog('import_settings_local', 'failed', errorMsg);

      if (errorMsg.includes('JSON')) {
        toast.showConfig('error', TOAST_MESSAGES.common.importFailed('JSON 格式错误，请检查文件格式'));
      } else {
        toast.showConfig('error', TOAST_MESSAGES.common.importFailed(errorMsg));
      }
    } finally {
      importSettingsLoading.value = false;
    }
  }

  /**
   * 导出历史记录到本地文件
   */
  async function exportHistoryLocal(): Promise<void> {
    try {
      exportHistoryLoading.value = true;

      const count = await historyDB.getCount();
      if (count === 0) {
        toast.showConfig('warn', TOAST_MESSAGES.sync.noHistory);
        return;
      }

      const jsonContent = await historyDB.exportToJSON();

      const filePath = await save({
        defaultPath: 'picnexus_history.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });

      if (!filePath) {
        toast.showConfig('warn', TOAST_MESSAGES.common.cancelled);
        return;
      }

      await writeTextFile(filePath, jsonContent);
      await writeSyncLog('export_history_local', 'success', `${count} 条记录`);
      toast.showConfig('success', TOAST_MESSAGES.common.exportSuccess(count));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('导出历史记录失败:', error);
      await writeSyncLog('export_history_local', 'failed', errorMsg);
      toast.showConfig('error', TOAST_MESSAGES.common.exportFailed(errorMsg));
    } finally {
      exportHistoryLoading.value = false;
    }
  }

  /**
   * 从本地文件导入历史记录（合并）
   */
  async function importHistoryLocal(): Promise<void> {
    try {
      importHistoryLoading.value = true;
      importHistoryProgress.value = 0;

      const filePath = await open({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        multiple: false
      });

      if (!filePath || Array.isArray(filePath)) {
        toast.showConfig('warn', TOAST_MESSAGES.common.cancelled);
        return;
      }

      const confirmed = await confirmDialog(
        '导入将以合并方式写入本地历史记录，已有记录不会被删除。\n是否继续？',
        '导入历史记录'
      );
      if (!confirmed) return;

      const content = await readTextFile(filePath);
      const parsed = JSON.parse(content);

      if (!Array.isArray(parsed)) {
        throw new Error('JSON 格式错误：期望数组格式');
      }

      // 验证每条记录的格式
      const invalidIndex = parsed.findIndex(item => !isValidHistoryItem(item));
      if (invalidIndex !== -1) {
        throw new Error(`第 ${invalidIndex + 1} 条记录格式无效`);
      }

      const countBefore = await historyDB.getCount();

      await historyDB.importFromJSON(
        content,
        'merge',
        (current, total) => {
          importHistoryProgress.value = total > 0 ? Math.round((current / total) * 100) : 100;
        }
      );

      const countAfter = await historyDB.getCount();

      invalidateCache();
      emitHistoryUpdated();

      const addedCount = countAfter - countBefore;
      await writeSyncLog('import_history_local', 'success', `新增 ${addedCount} 条，共 ${countAfter} 条`);
      toast.showConfig('success', TOAST_MESSAGES.common.importSuccess(
        `共 ${countAfter} 条记录，新增 ${addedCount} 条`
      ));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('导入历史记录失败:', error);
      await writeSyncLog('import_history_local', 'failed', errorMsg);

      if (errorMsg.includes('JSON')) {
        toast.showConfig('error', TOAST_MESSAGES.common.importFailed('JSON 格式错误，请检查文件格式'));
      } else {
        toast.showConfig('error', TOAST_MESSAGES.common.importFailed(errorMsg));
      }
    } finally {
      importHistoryLoading.value = false;
      importHistoryProgress.value = 0;
    }
  }

  // ==================== 云端同步 - 配置 ====================

  /**
   * 上传配置到云端
   */
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

  /**
   * 从云端下载配置 - 覆盖本地
   */
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

  /**
   * 从云端下载配置 - 合并（保留本地 WebDAV 配置）
   */
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

  /**
   * 上传历史记录 - 强制覆盖
   */
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

  /**
   * 智能合并上传历史记录
   */
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

  /**
   * 仅上传本地新增的历史记录
   */
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

  /**
   * 从云端下载历史记录 - 覆盖本地
   */
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

  /**
   * 从云端下载历史记录 - 智能合并
   */
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

  /**
   * 双向同步配置文件：拉取云端 → 合并 → 推送
   */
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

  /**
   * 双向同步历史记录：拉取云端 → 合并 → 推送
   */
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

  // ==================== 返回值 ====================

  return {
    // 状态
    syncStatus,

    // Loading 状态
    exportSettingsLoading,
    importSettingsLoading,
    uploadSettingsLoading,
    downloadSettingsLoading,
    exportHistoryLoading,
    importHistoryLoading,
    importHistoryProgress,
    uploadHistoryLoading,
    downloadHistoryLoading,

    // 下拉菜单状态
    uploadHistoryMenuVisible,
    downloadSettingsMenuVisible,
    downloadHistoryMenuVisible,

    // 折叠状态
    configSectionExpanded,
    historySectionExpanded,

    // 生命周期
    loadSyncStatus,
    saveSyncStatus,
    getProfileSyncRecord,
    getAllSyncRecords,

    // 本地备份
    exportSettingsLocal,
    importSettingsLocal,
    exportHistoryLocal,
    importHistoryLocal,

    // 云端同步
    uploadSettingsCloud,
    downloadSettingsOverwrite,
    downloadSettingsMerge,
    uploadHistoryForce,
    uploadHistoryMerge,
    uploadHistoryIncremental,
    downloadHistoryOverwrite,
    downloadHistoryMerge,

    // 双向同步
    syncConfigLoading,
    syncHistoryLoading,
    syncConfig,
    syncHistory,

    // 菜单控制
    toggleUploadHistoryMenu,
    toggleDownloadSettingsMenu,
    toggleDownloadHistoryMenu,
    closeAllMenus,

    // 密码请求
    passwordRequest,

    // 工具函数
    extractErrorCode,
    getFullTimestamp
  };
}
