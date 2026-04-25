// 备份与同步 - 类型定义

import type { Ref } from 'vue';
import type { SyncStatus, ProfileSyncRecord, WebDAVProfile } from '../../config/types';

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
  // verify: 验证密码，成功返回 true；失败返回 false（不关闭对话框，允许重试）
  // cancel: 用户取消或跳过，拒绝整个请求
  passwordRequest: Ref<{
    verify: (password: string) => Promise<boolean>;
    cancel: () => void;
  } | null>;

  // 配置同步后需要刷新页面才能生效（常驻 banner，由 UI 层渲染）
  needsReload: Ref<boolean>;

  // 工具函数
  extractErrorCode: (error: unknown) => string;
  getFullTimestamp: () => string;
}
