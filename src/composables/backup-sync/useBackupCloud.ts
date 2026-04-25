// 备份与同步 - 云端同步操作（门面：聚合 ConfigSync + HistorySync）

import type { Ref } from 'vue';
import { useToast } from '../useToast';
import { useConfirm } from '../useConfirm';
import type { WebDAVProfile } from '../../config/types';
import { createConfigSyncOps } from './ConfigSync';
import { createHistorySyncOps } from './HistorySync';

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
  needsReload: Ref<boolean>;
}

export function createBackupCloudOps(deps: BackupCloudDeps) {
  const configSync = createConfigSyncOps(deps);
  const historySync = createHistorySyncOps(deps);

  return {
    ...configSync,
    ...historySync,
  };
}
