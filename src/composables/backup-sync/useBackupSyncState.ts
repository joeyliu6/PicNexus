// 备份与同步 - 状态管理（同步状态持久化、菜单控制）

import { ref, type Ref } from 'vue';
import type { SyncStatus, ProfileSyncRecord, WebDAVProfile } from '../../config/types';
import { syncStatusStore } from '../../store/instances';
import { createLogger } from '../../utils/logger';
import { getFullTimestamp } from './backupSyncUtils';

const log = createLogger('BackupSync');

export function useBackupSyncState() {
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

  // ==================== 同步状态管理 ====================

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

  return {
    // 状态
    syncStatus,
    exportSettingsLoading,
    importSettingsLoading,
    uploadSettingsLoading,
    downloadSettingsLoading,
    exportHistoryLoading,
    importHistoryLoading,
    importHistoryProgress,
    uploadHistoryLoading,
    downloadHistoryLoading,
    syncConfigLoading,
    syncHistoryLoading,
    uploadHistoryMenuVisible,
    downloadSettingsMenuVisible,
    downloadHistoryMenuVisible,
    configSectionExpanded,
    historySectionExpanded,
    passwordRequest,

    // 同步状态管理
    loadSyncStatus,
    saveSyncStatus,
    getProfileSyncRecord,
    getAllSyncRecords,
    updateConfigSyncStatus,
    updateHistorySyncStatus,

    // 菜单控制
    closeAllMenus,
    toggleUploadHistoryMenu,
    toggleDownloadSettingsMenu,
    toggleDownloadHistoryMenu,
  };
}
