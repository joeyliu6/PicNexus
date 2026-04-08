// 备份与同步 Composable - 主编排模块
// 从子模块组合：工具函数 + 状态管理 + 本地备份 + 云端同步

import { useToast } from '../useToast';
import { useConfirm } from '../useConfirm';
import { decryptWithPassword } from '../../crypto';
import { extractErrorCode, getFullTimestamp } from './backupSyncUtils';
import { useBackupSyncState } from './useBackupSyncState';
import { createBackupLocalOps } from './useBackupLocal';
import { createBackupCloudOps } from './useBackupCloud';

export type { UseBackupSyncReturn } from './types';

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
export function useBackupSync() {
  const toast = useToast();
  const { confirm: confirmDialog, confirmThreeWay } = useConfirm();

  // 状态管理
  const state = useBackupSyncState();

  /**
   * 解密加密内容：始终要求用户输入密码
   */
  async function tryDecryptContent(encryptedContent: string): Promise<string> {
    const password = await new Promise<string>((resolve, reject) => {
      state.passwordRequest.value = { resolve, reject };
    });

    try {
      const result = await decryptWithPassword(encryptedContent, password);
      state.passwordRequest.value = null;
      return result;
    } catch (error) {
      state.passwordRequest.value = null;
      throw error;
    }
  }

  // 本地备份操作
  const localOps = createBackupLocalOps({
    toast,
    confirmDialog,
    confirmThreeWay,
    tryDecryptContent,
    exportSettingsLoading: state.exportSettingsLoading,
    importSettingsLoading: state.importSettingsLoading,
    exportHistoryLoading: state.exportHistoryLoading,
    importHistoryLoading: state.importHistoryLoading,
    importHistoryProgress: state.importHistoryProgress,
  });

  // 云端同步操作
  const cloudOps = createBackupCloudOps({
    toast,
    confirmDialog,
    tryDecryptContent,
    updateConfigSyncStatus: state.updateConfigSyncStatus,
    updateHistorySyncStatus: state.updateHistorySyncStatus,
    uploadSettingsLoading: state.uploadSettingsLoading,
    downloadSettingsLoading: state.downloadSettingsLoading,
    uploadHistoryLoading: state.uploadHistoryLoading,
    downloadHistoryLoading: state.downloadHistoryLoading,
    syncConfigLoading: state.syncConfigLoading,
    syncHistoryLoading: state.syncHistoryLoading,
    uploadHistoryMenuVisible: state.uploadHistoryMenuVisible,
    downloadSettingsMenuVisible: state.downloadSettingsMenuVisible,
    downloadHistoryMenuVisible: state.downloadHistoryMenuVisible,
  });

  return {
    // 状态
    syncStatus: state.syncStatus,

    // Loading 状态
    exportSettingsLoading: state.exportSettingsLoading,
    importSettingsLoading: state.importSettingsLoading,
    uploadSettingsLoading: state.uploadSettingsLoading,
    downloadSettingsLoading: state.downloadSettingsLoading,
    exportHistoryLoading: state.exportHistoryLoading,
    importHistoryLoading: state.importHistoryLoading,
    importHistoryProgress: state.importHistoryProgress,
    uploadHistoryLoading: state.uploadHistoryLoading,
    downloadHistoryLoading: state.downloadHistoryLoading,

    // 下拉菜单状态
    uploadHistoryMenuVisible: state.uploadHistoryMenuVisible,
    downloadSettingsMenuVisible: state.downloadSettingsMenuVisible,
    downloadHistoryMenuVisible: state.downloadHistoryMenuVisible,

    // 折叠状态
    configSectionExpanded: state.configSectionExpanded,
    historySectionExpanded: state.historySectionExpanded,

    // 生命周期
    loadSyncStatus: state.loadSyncStatus,
    saveSyncStatus: state.saveSyncStatus,
    getProfileSyncRecord: state.getProfileSyncRecord,
    getAllSyncRecords: state.getAllSyncRecords,

    // 本地备份
    ...localOps,

    // 云端同步
    ...cloudOps,

    // 双向同步
    syncConfigLoading: state.syncConfigLoading,
    syncHistoryLoading: state.syncHistoryLoading,

    // 菜单控制
    toggleUploadHistoryMenu: state.toggleUploadHistoryMenu,
    toggleDownloadSettingsMenu: state.toggleDownloadSettingsMenu,
    toggleDownloadHistoryMenu: state.toggleDownloadHistoryMenu,
    closeAllMenus: state.closeAllMenus,

    // 密码请求
    passwordRequest: state.passwordRequest,

    // 工具函数
    extractErrorCode,
    getFullTimestamp,
  };
}
