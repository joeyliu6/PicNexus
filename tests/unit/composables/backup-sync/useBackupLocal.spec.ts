import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createConfig } from '../../factories/configFactory';
import { createHistoryItem } from '../../factories/historyFactory';
import {
  getInvokeMock,
  resetTauriMocks,
} from '../../helpers/tauriMock';

const {
  historyGetCountMock,
  historyExportToJSONMock,
  historyImportFromJSONMock,
  invalidateCacheMock,
  emitHistoryUpdatedMock,
  configStoreGetMock,
  configStoreSetMock,
  configStoreSaveMock,
  isPasswordModeMock,
  encryptMock,
  isPasswordEncryptedDataMock,
  isValidUserConfigMock,
  writeSyncLogMock,
  toastShowConfigMock,
  confirmDialogMock,
  confirmThreeWayMock,
  tryDecryptContentMock,
} = vi.hoisted(() => ({
  historyGetCountMock: vi.fn(),
  historyExportToJSONMock: vi.fn(),
  historyImportFromJSONMock: vi.fn(),
  invalidateCacheMock: vi.fn(),
  emitHistoryUpdatedMock: vi.fn(),
  configStoreGetMock: vi.fn(),
  configStoreSetMock: vi.fn(),
  configStoreSaveMock: vi.fn(),
  isPasswordModeMock: vi.fn(),
  encryptMock: vi.fn(),
  isPasswordEncryptedDataMock: vi.fn(),
  isValidUserConfigMock: vi.fn(),
  writeSyncLogMock: vi.fn(),
  toastShowConfigMock: vi.fn(),
  confirmDialogMock: vi.fn(),
  confirmThreeWayMock: vi.fn(),
  tryDecryptContentMock: vi.fn(),
}));

vi.mock('@/services/database', () => ({
  historyDB: {
    getCount: historyGetCountMock,
    exportToJSON: historyExportToJSONMock,
    importFromJSON: historyImportFromJSONMock,
  },
}));

vi.mock('@/composables/useHistory', () => ({
  invalidateCache: invalidateCacheMock,
}));

vi.mock('@/events/cacheEvents', () => ({
  emitHistoryUpdated: emitHistoryUpdatedMock,
}));

vi.mock('@/store/instances', () => ({
  configStore: {
    get: configStoreGetMock,
    set: configStoreSetMock,
    save: configStoreSaveMock,
  },
}));

vi.mock('@/security/crypto', () => ({
  secureStorage: {
    isPasswordMode: isPasswordModeMock,
    encrypt: encryptMock,
  },
  isPasswordEncryptedData: isPasswordEncryptedDataMock,
}));

vi.mock('@/config/types', async importOriginal => {
  const actual = await importOriginal<typeof import('@/config/types')>();
  return {
    ...actual,
    isValidUserConfig: isValidUserConfigMock,
  };
});

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/composables/backup-sync/backupSyncUtils', () => ({
  writeSyncLog: writeSyncLogMock,
}));

const { createBackupLocalOps } = await import('@/composables/backup-sync/useBackupLocal');
const invokeMock = getInvokeMock();

function makeDeps() {
  return {
    toast: {
      showConfig: toastShowConfigMock,
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      show: vi.fn(),
      clear: vi.fn(),
      silent: vi.fn(),
      addRaw: vi.fn(),
      removeGroup: vi.fn(),
    },
    confirmDialog: confirmDialogMock,
    confirmThreeWay: confirmThreeWayMock,
    tryDecryptContent: tryDecryptContentMock,
    exportSettingsLoading: ref(false),
    importSettingsLoading: ref(false),
    exportHistoryLoading: ref(false),
    importHistoryLoading: ref(false),
    importHistoryProgress: ref(0),
  };
}

describe('createBackupLocalOps', () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.clearAllMocks();
    vi.useRealTimers();
    invokeMock.mockImplementation(async (command) => {
      if (command === 'export_text_file') return 'C:/backup.json';
      if (command === 'import_text_file') return JSON.stringify(createConfig());
      return undefined;
    });
    historyGetCountMock.mockResolvedValue(2);
    historyExportToJSONMock.mockResolvedValue(JSON.stringify([createHistoryItem()]));
    historyImportFromJSONMock.mockResolvedValue({ total: 1, imported: 1, added: 1, updated: 0, skipped: 0 });
    configStoreGetMock.mockResolvedValue(createConfig());
    configStoreSetMock.mockResolvedValue(undefined);
    configStoreSaveMock.mockResolvedValue(undefined);
    isPasswordModeMock.mockReturnValue(false);
    encryptMock.mockResolvedValue('encrypted-content');
    isPasswordEncryptedDataMock.mockReturnValue(false);
    isValidUserConfigMock.mockReturnValue(true);
    writeSyncLogMock.mockResolvedValue(undefined);
    confirmDialogMock.mockResolvedValue(true);
    confirmThreeWayMock.mockResolvedValue('accept');
    tryDecryptContentMock.mockResolvedValue(JSON.stringify(createConfig()));
  });

  it('exports settings after resetting invalid local config and encrypting password-mode output', async () => {
    configStoreGetMock.mockResolvedValueOnce({ broken: true });
    isValidUserConfigMock.mockReturnValueOnce(false);
    isPasswordModeMock.mockReturnValueOnce(true);
    encryptMock.mockResolvedValueOnce('ciphertext');

    const deps = makeDeps();
    const ops = createBackupLocalOps(deps);

    await ops.exportSettingsLocal();

    expect(configStoreSetMock).toHaveBeenCalledWith(
      'config',
      expect.objectContaining({ enabledServices: expect.any(Array) }),
    );
    expect(configStoreSaveMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('export_text_file', {
      defaultPath: 'picnexus_settings.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      content: 'ciphertext',
    });
    expect(writeSyncLogMock).toHaveBeenCalledWith('export_settings_local', 'success');
    expect(toastShowConfigMock).toHaveBeenCalledWith('warn', expect.any(Object));
    expect(toastShowConfigMock).toHaveBeenCalledWith('success', expect.any(Object));
    expect(deps.exportSettingsLoading.value).toBe(false);
  });

  it('imports encrypted settings and preserves local WebDAV when the user chooses the safe merge path', async () => {
    vi.useFakeTimers();
    const localConfig = createConfig({
      webdav: {
        activeId: 'local',
        profiles: [{
          id: 'local',
          name: 'Local NAS',
          url: 'https://local.example.com',
          username: 'local',
          password: 'local-pass',
          remotePath: '/Local/',
        }],
      },
    });
    const importedConfig = createConfig({
      enabledServices: ['smms'],
      webdav: {
        activeId: 'cloud',
        profiles: [{
          id: 'cloud',
          name: 'Cloud NAS',
          url: 'https://cloud.example.com',
          username: 'cloud',
          password: 'cloud-pass',
          remotePath: '/Cloud/',
        }],
      },
    });
    invokeMock.mockImplementation(async (command) => {
      if (command === 'import_text_file') return 'encrypted-payload';
      if (command === 'export_text_file') return 'C:/backup.json';
      return undefined;
    });
    isPasswordEncryptedDataMock.mockReturnValueOnce(true);
    tryDecryptContentMock.mockResolvedValueOnce(JSON.stringify(importedConfig));
    configStoreGetMock.mockResolvedValueOnce(localConfig);
    confirmThreeWayMock.mockResolvedValueOnce('reject');

    const deps = makeDeps();
    const ops = createBackupLocalOps(deps);

    await ops.importSettingsLocal();
    await vi.runAllTimersAsync();

    expect(tryDecryptContentMock).toHaveBeenCalledWith('encrypted-payload');
    expect(configStoreSetMock).toHaveBeenCalledWith('config', {
      ...importedConfig,
      webdav: localConfig.webdav,
    });
    expect(writeSyncLogMock).toHaveBeenCalledWith('import_settings_local', 'success');
    expect(toastShowConfigMock).toHaveBeenCalledWith('success', expect.any(Object));
    expect(toastShowConfigMock).toHaveBeenCalledWith('info', expect.any(Object));
    expect(deps.importSettingsLoading.value).toBe(false);
  });

  it('does not show an error toast when encrypted settings import is cancelled from the password dialog', async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === 'import_text_file') return 'encrypted-payload';
      if (command === 'export_text_file') return 'C:/backup.json';
      return undefined;
    });
    isPasswordEncryptedDataMock.mockReturnValueOnce(true);
    tryDecryptContentMock.mockRejectedValueOnce(new Error('user_cancelled'));

    const deps = makeDeps();
    const ops = createBackupLocalOps(deps);

    await ops.importSettingsLocal();

    expect(configStoreSetMock).not.toHaveBeenCalled();
    expect(writeSyncLogMock).not.toHaveBeenCalled();
    expect(toastShowConfigMock).not.toHaveBeenCalledWith('error', expect.anything());
    expect(deps.importSettingsLoading.value).toBe(false);
  });

  it('treats empty imported settings files as invalid JSON instead of cancel', async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === 'import_text_file') return '';
      if (command === 'export_text_file') return 'C:/backup.json';
      return undefined;
    });

    const deps = makeDeps();
    const ops = createBackupLocalOps(deps);

    await ops.importSettingsLocal();

    expect(writeSyncLogMock).toHaveBeenCalledWith(
      'import_settings_local',
      'failed',
      expect.stringContaining('JSON'),
    );
    expect(toastShowConfigMock).toHaveBeenCalledWith('error', expect.any(Object));
    expect(toastShowConfigMock.mock.calls.some(([severity]) => severity === 'warn')).toBe(false);
  });

  it('warns and skips history export when there is no local history', async () => {
    historyGetCountMock.mockResolvedValueOnce(0);

    const deps = makeDeps();
    const ops = createBackupLocalOps(deps);

    await ops.exportHistoryLocal();

    expect(invokeMock).not.toHaveBeenCalledWith('export_text_file', expect.anything());
    expect(writeSyncLogMock).not.toHaveBeenCalled();
    expect(toastShowConfigMock).toHaveBeenCalledWith('warn', expect.any(Object));
    expect(deps.exportHistoryLoading.value).toBe(false);
  });

  // 判定权已统一收归底层 importFromJSON（config/validators 的 isImportableHistoryItem），
  // 此处不再有本地前置校验——整份无效时由底层抛错，失败路径的其余保证不变。
  it('rejects fully invalid history imports without touching the cache', async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === 'import_text_file') return JSON.stringify([{ id: '' }]);
      if (command === 'export_text_file') return 'C:/backup.json';
      return undefined;
    });
    historyImportFromJSONMock.mockRejectedValueOnce(
      new Error('导入数据格式不匹配，请检查文件是否为 PicNexus 导出的历史记录'),
    );

    const deps = makeDeps();
    const ops = createBackupLocalOps(deps);

    await ops.importHistoryLocal();

    expect(invalidateCacheMock).not.toHaveBeenCalled();
    expect(emitHistoryUpdatedMock).not.toHaveBeenCalled();
    expect(writeSyncLogMock).toHaveBeenCalledWith('import_history_local', 'failed', expect.any(String));
    expect(toastShowConfigMock).toHaveBeenCalledWith('error', expect.any(Object));
    expect(deps.importHistoryLoading.value).toBe(false);
    expect(deps.importHistoryProgress.value).toBe(0);
  });

  // 回归：部分记录无效时不再整份失败，而是导入其余记录并把跳过条数报给用户。
  // 这正是「本地导入」与「云端下载」此前结论不一致的那一格。
  it('imports the remaining records and reports how many were skipped', async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === 'import_text_file') {
        return JSON.stringify([createHistoryItem({ id: 'good' }), { id: 'bad' }]);
      }
      if (command === 'export_text_file') return 'C:/backup.json';
      return undefined;
    });
    historyImportFromJSONMock.mockResolvedValueOnce({
      total: 2, imported: 1, added: 1, updated: 0, skipped: 1,
    });
    historyGetCountMock.mockResolvedValue(1);

    const deps = makeDeps();
    const ops = createBackupLocalOps(deps);

    await ops.importHistoryLocal();

    expect(historyImportFromJSONMock).toHaveBeenCalled();
    expect(invalidateCacheMock).toHaveBeenCalled();
    expect(writeSyncLogMock).toHaveBeenCalledWith(
      'import_history_local',
      'success',
      expect.stringContaining('跳过 1 条'),
    );
    expect(toastShowConfigMock).toHaveBeenCalledWith('success', expect.any(Object));
  });

  it('treats empty imported history files as invalid JSON instead of cancel', async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === 'import_text_file') return '';
      if (command === 'export_text_file') return 'C:/backup.json';
      return undefined;
    });

    const deps = makeDeps();
    const ops = createBackupLocalOps(deps);

    await ops.importHistoryLocal();

    expect(historyImportFromJSONMock).not.toHaveBeenCalled();
    expect(writeSyncLogMock).toHaveBeenCalledWith(
      'import_history_local',
      'failed',
      expect.stringContaining('JSON'),
    );
    expect(toastShowConfigMock).toHaveBeenCalledWith('error', expect.any(Object));
    expect(toastShowConfigMock.mock.calls.some(([severity]) => severity === 'warn')).toBe(false);
  });

  it('imports valid history in merge mode, updates progress, and refreshes history views', async () => {
    const items = [createHistoryItem({ id: 'remote-new' })];
    const content = JSON.stringify(items);
    const deps = makeDeps();
    const progressSnapshots: number[] = [];
    invokeMock.mockImplementation(async (command) => {
      if (command === 'import_text_file') return content;
      if (command === 'export_text_file') return 'C:/backup.json';
      return undefined;
    });
    historyGetCountMock
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);
    historyImportFromJSONMock.mockImplementation(async (
      _content: string,
      _mode: string,
      onProgress: (current: number, total: number) => void,
    ) => {
      onProgress(1, 2);
      progressSnapshots.push(deps.importHistoryProgress.value);
      onProgress(2, 2);
      progressSnapshots.push(deps.importHistoryProgress.value);
      return 1;
    });

    const ops = createBackupLocalOps(deps);

    await ops.importHistoryLocal();

    expect(historyImportFromJSONMock).toHaveBeenCalledWith(content, 'merge', expect.any(Function));
    expect(progressSnapshots).toEqual([50, 100]);
    expect(invalidateCacheMock).toHaveBeenCalledTimes(1);
    expect(emitHistoryUpdatedMock).toHaveBeenCalledTimes(1);
    expect(writeSyncLogMock).toHaveBeenCalledWith('import_history_local', 'success', expect.any(String));
    expect(toastShowConfigMock).toHaveBeenCalledWith('success', expect.any(Object));
    expect(deps.importHistoryProgress.value).toBe(0);
  });
});
