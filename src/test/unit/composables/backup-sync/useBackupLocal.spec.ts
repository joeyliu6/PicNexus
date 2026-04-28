import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createConfig } from '../../../factories/configFactory';
import { createHistoryItem } from '../../../factories/historyFactory';
import {
  getDialogOpenMock,
  getDialogSaveMock,
  getFsMocks,
  resetTauriMocks,
} from '../../../helpers/tauriMock';

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
  isValidHistoryItemMock,
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
  isValidHistoryItemMock: vi.fn(),
  writeSyncLogMock: vi.fn(),
  toastShowConfigMock: vi.fn(),
  confirmDialogMock: vi.fn(),
  confirmThreeWayMock: vi.fn(),
  tryDecryptContentMock: vi.fn(),
}));

vi.mock('../../../../services/HistoryDatabase', () => ({
  historyDB: {
    getCount: historyGetCountMock,
    exportToJSON: historyExportToJSONMock,
    importFromJSON: historyImportFromJSONMock,
  },
}));

vi.mock('../../../../composables/useHistory', () => ({
  invalidateCache: invalidateCacheMock,
}));

vi.mock('../../../../events/cacheEvents', () => ({
  emitHistoryUpdated: emitHistoryUpdatedMock,
}));

vi.mock('../../../../store/instances', () => ({
  configStore: {
    get: configStoreGetMock,
    set: configStoreSetMock,
    save: configStoreSaveMock,
  },
}));

vi.mock('../../../../crypto', () => ({
  secureStorage: {
    isPasswordMode: isPasswordModeMock,
    encrypt: encryptMock,
  },
  isPasswordEncryptedData: isPasswordEncryptedDataMock,
}));

vi.mock('../../../../config/types', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../config/types')>();
  return {
    ...actual,
    isValidUserConfig: isValidUserConfigMock,
    isValidHistoryItem: isValidHistoryItemMock,
  };
});

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../../composables/backup-sync/backupSyncUtils', () => ({
  writeSyncLog: writeSyncLogMock,
}));

const { createBackupLocalOps } = await import('../../../../composables/backup-sync/useBackupLocal');
const dialogSaveMock = getDialogSaveMock();
const dialogOpenMock = getDialogOpenMock();
const { writeTextFile: writeTextFileMock, readTextFile: readTextFileMock } = getFsMocks();

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
    dialogSaveMock.mockResolvedValue('C:/backup.json');
    dialogOpenMock.mockResolvedValue('C:/backup.json');
    writeTextFileMock.mockResolvedValue(undefined);
    readTextFileMock.mockResolvedValue(JSON.stringify(createConfig()));
    historyGetCountMock.mockResolvedValue(2);
    historyExportToJSONMock.mockResolvedValue(JSON.stringify([createHistoryItem()]));
    historyImportFromJSONMock.mockResolvedValue(1);
    configStoreGetMock.mockResolvedValue(createConfig());
    configStoreSetMock.mockResolvedValue(undefined);
    configStoreSaveMock.mockResolvedValue(undefined);
    isPasswordModeMock.mockReturnValue(false);
    encryptMock.mockResolvedValue('encrypted-content');
    isPasswordEncryptedDataMock.mockReturnValue(false);
    isValidUserConfigMock.mockReturnValue(true);
    isValidHistoryItemMock.mockReturnValue(true);
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
    expect(writeTextFileMock).toHaveBeenCalledWith('C:/backup.json', 'ciphertext');
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
    readTextFileMock.mockResolvedValueOnce('encrypted-payload');
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
    readTextFileMock.mockResolvedValueOnce('encrypted-payload');
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

  it('warns and skips history export when there is no local history', async () => {
    historyGetCountMock.mockResolvedValueOnce(0);

    const deps = makeDeps();
    const ops = createBackupLocalOps(deps);

    await ops.exportHistoryLocal();

    expect(dialogSaveMock).not.toHaveBeenCalled();
    expect(writeTextFileMock).not.toHaveBeenCalled();
    expect(writeSyncLogMock).not.toHaveBeenCalled();
    expect(toastShowConfigMock).toHaveBeenCalledWith('warn', expect.any(Object));
    expect(deps.exportHistoryLoading.value).toBe(false);
  });

  it('rejects invalid history imports before touching the database or cache', async () => {
    readTextFileMock.mockResolvedValueOnce(JSON.stringify([{ id: '' }]));
    isValidHistoryItemMock.mockReturnValueOnce(false);

    const deps = makeDeps();
    const ops = createBackupLocalOps(deps);

    await ops.importHistoryLocal();

    expect(historyImportFromJSONMock).not.toHaveBeenCalled();
    expect(invalidateCacheMock).not.toHaveBeenCalled();
    expect(emitHistoryUpdatedMock).not.toHaveBeenCalled();
    expect(writeSyncLogMock).toHaveBeenCalledWith('import_history_local', 'failed', expect.any(String));
    expect(toastShowConfigMock).toHaveBeenCalledWith('error', expect.any(Object));
    expect(deps.importHistoryLoading.value).toBe(false);
    expect(deps.importHistoryProgress.value).toBe(0);
  });

  it('imports valid history in merge mode, updates progress, and refreshes history views', async () => {
    const items = [createHistoryItem({ id: 'remote-new' })];
    const content = JSON.stringify(items);
    const deps = makeDeps();
    const progressSnapshots: number[] = [];
    readTextFileMock.mockResolvedValueOnce(content);
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
