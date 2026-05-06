// 备份与同步 - 本地导入导出操作

import type { Ref } from 'vue';
import { historyDB } from '../../services/HistoryDatabase';
import { invalidateCache } from '../useHistory';
import { emitHistoryUpdated } from '../../events/cacheEvents';
import { useToast } from '../useToast';
import { TOAST_MESSAGES } from '../../constants';
import { useConfirm } from '../useConfirm';
import type { UserConfig } from '../../config/types';
import { DEFAULT_CONFIG, isValidUserConfig, isValidHistoryItem } from '../../config/types';
import { configStore } from '../../store/instances';
import { secureStorage, isPasswordEncryptedData } from '../../crypto';
import { createLogger } from '../../utils/logger';
import { exportTextFile, importTextFile } from '../../utils/userFiles';
import { writeSyncLog } from './backupSyncUtils';

const log = createLogger('BackupSync');

export interface BackupLocalDeps {
  toast: ReturnType<typeof useToast>;
  confirmDialog: ReturnType<typeof useConfirm>['confirm'];
  confirmThreeWay: ReturnType<typeof useConfirm>['confirmThreeWay'];
  tryDecryptContent: (content: string) => Promise<string>;
  exportSettingsLoading: Ref<boolean>;
  importSettingsLoading: Ref<boolean>;
  exportHistoryLoading: Ref<boolean>;
  importHistoryLoading: Ref<boolean>;
  importHistoryProgress: Ref<number>;
}

export function createBackupLocalOps(deps: BackupLocalDeps) {
  const {
    toast, confirmDialog, confirmThreeWay, tryDecryptContent,
    exportSettingsLoading, importSettingsLoading,
    exportHistoryLoading, importHistoryLoading, importHistoryProgress,
  } = deps;

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

      const filePath = await exportTextFile(
        'picnexus_settings.json',
        [{ name: 'JSON', extensions: ['json'] }],
        outputContent,
      );

      if (!filePath) {
        toast.showConfig('warn', TOAST_MESSAGES.common.cancelled);
        return;
      }

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

  async function importSettingsLocal(): Promise<void> {
    try {
      importSettingsLoading.value = true;

      const content = await importTextFile([{ name: 'JSON', extensions: ['json'] }]);

      if (content === null) {
        toast.showConfig('warn', TOAST_MESSAGES.common.cancelled);
        return;
      }

      let jsonContent = content;
      if (isPasswordEncryptedData(content.trim())) {
        jsonContent = await tryDecryptContent(content.trim());
      }

      const importedConfig = JSON.parse(jsonContent) as UserConfig;

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

  async function exportHistoryLocal(): Promise<void> {
    try {
      exportHistoryLoading.value = true;

      const count = await historyDB.getCount();
      if (count === 0) {
        toast.showConfig('warn', TOAST_MESSAGES.sync.noHistory);
        return;
      }

      const jsonContent = await historyDB.exportToJSON();

      const filePath = await exportTextFile(
        'picnexus_history.json',
        [{ name: 'JSON', extensions: ['json'] }],
        jsonContent,
      );

      if (!filePath) {
        toast.showConfig('warn', TOAST_MESSAGES.common.cancelled);
        return;
      }

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

  async function importHistoryLocal(): Promise<void> {
    try {
      importHistoryLoading.value = true;
      importHistoryProgress.value = 0;

      const content = await importTextFile([{ name: 'JSON', extensions: ['json'] }]);

      if (content === null) {
        toast.showConfig('warn', TOAST_MESSAGES.common.cancelled);
        return;
      }

      const confirmed = await confirmDialog(
        '导入将以合并方式写入本地历史记录，已有记录不会被删除。\n是否继续？',
        '导入历史记录'
      );
      if (!confirmed) return;

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

  return {
    exportSettingsLocal,
    importSettingsLocal,
    exportHistoryLocal,
    importHistoryLocal,
  };
}
