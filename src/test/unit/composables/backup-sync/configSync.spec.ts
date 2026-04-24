import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const {
  configStoreGetMock,
  configStoreSetMock,
  configStoreSaveMock,
  isValidUserConfigMock,
  isPasswordModeMock,
  encryptMock,
  isPasswordEncryptedDataMock,
  writeSyncLogMock,
  extractErrorCodeMock,
  getWebDAVClientAndPathMock,
  toastShowConfigMock,
  toastSuccessMock,
  toastErrorMock,
  toastInfoMock,
  confirmDialogMock,
  clientGetFileMock,
  clientPutFileMock,
  updateConfigSyncStatusMock,
} = vi.hoisted(() => ({
  configStoreGetMock: vi.fn(),
  configStoreSetMock: vi.fn(),
  configStoreSaveMock: vi.fn(),
  isValidUserConfigMock: vi.fn(),
  isPasswordModeMock: vi.fn(),
  encryptMock: vi.fn(),
  isPasswordEncryptedDataMock: vi.fn(),
  writeSyncLogMock: vi.fn(),
  extractErrorCodeMock: vi.fn(),
  getWebDAVClientAndPathMock: vi.fn(),
  toastShowConfigMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
  confirmDialogMock: vi.fn(),
  clientGetFileMock: vi.fn(),
  clientPutFileMock: vi.fn(),
  updateConfigSyncStatusMock: vi.fn(),
}));

vi.mock('../../../../store/instances', () => ({
  configStore: {
    get: configStoreGetMock,
    set: configStoreSetMock,
    save: configStoreSaveMock,
  },
}));

vi.mock('../../../../config/types', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../config/types')>();
  return {
    ...actual,
    isValidUserConfig: isValidUserConfigMock,
  };
});

vi.mock('../../../../crypto', () => ({
  secureStorage: {
    isPasswordMode: isPasswordModeMock,
    encrypt: encryptMock,
  },
  isPasswordEncryptedData: isPasswordEncryptedDataMock,
}));

vi.mock('../../../../composables/backup-sync/backupSyncUtils', () => ({
  writeSyncLog: writeSyncLogMock,
  extractErrorCode: extractErrorCodeMock,
  getWebDAVClientAndPath: getWebDAVClientAndPathMock,
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { createConfigSyncOps } = await import('../../../../composables/backup-sync/ConfigSync');

function makeDeps() {
  return {
    toast: {
      showConfig: toastShowConfigMock,
      success: toastSuccessMock,
      error: toastErrorMock,
      info: toastInfoMock,
      warn: vi.fn(),
      show: vi.fn(),
      clear: vi.fn(),
      silent: vi.fn(),
    },
    confirmDialog: confirmDialogMock,
    tryDecryptContent: vi.fn(),
    updateConfigSyncStatus: updateConfigSyncStatusMock,
    updateHistorySyncStatus: vi.fn(),
    uploadSettingsLoading: ref(false),
    downloadSettingsLoading: ref(false),
    uploadHistoryLoading: ref(false),
    downloadHistoryLoading: ref(false),
    syncConfigLoading: ref(false),
    syncHistoryLoading: ref(false),
    uploadHistoryMenuVisible: ref(false),
    downloadSettingsMenuVisible: ref(true),
    downloadHistoryMenuVisible: ref(false),
  };
}

const profile = {
  id: 'profile-1',
  name: 'Main WebDAV',
  url: 'https://dav.example.com',
  username: 'user',
  password: 'pass',
  remotePath: '/PicNexus/',
};

describe('createConfigSyncOps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    getWebDAVClientAndPathMock.mockResolvedValue({
      client: {
        getFile: clientGetFileMock,
        putFile: clientPutFileMock,
      },
      remotePath: '/PicNexus/settings.json',
    });
    configStoreGetMock.mockResolvedValue({ current: true });
    configStoreSetMock.mockResolvedValue(undefined);
    configStoreSaveMock.mockResolvedValue(undefined);
    clientPutFileMock.mockResolvedValue(undefined);
    clientGetFileMock.mockResolvedValue(JSON.stringify({ cloud: true }));
    isValidUserConfigMock.mockReturnValue(true);
    isPasswordModeMock.mockReturnValue(false);
    encryptMock.mockResolvedValue('encrypted');
    isPasswordEncryptedDataMock.mockReturnValue(false);
    writeSyncLogMock.mockResolvedValue(undefined);
    extractErrorCodeMock.mockReturnValue('SYNC_ERR');
    confirmDialogMock.mockResolvedValue(true);
  });

  it('uploads the local config to WebDAV and encrypts it when password mode is enabled', async () => {
    isPasswordModeMock.mockReturnValue(true);
    configStoreGetMock.mockResolvedValueOnce({ local: true });
    encryptMock.mockResolvedValueOnce('encrypted-config');

    const deps = makeDeps();
    const ops = createConfigSyncOps(deps);

    await ops.uploadSettingsCloud(profile);

    expect(clientPutFileMock).toHaveBeenCalledWith('/PicNexus/settings.json', 'encrypted-config');
    expect(updateConfigSyncStatusMock).toHaveBeenCalledWith(profile, 'success');
    expect(writeSyncLogMock).toHaveBeenCalledWith('upload_settings_cloud', 'success', undefined, profile);
    expect(deps.uploadSettingsLoading.value).toBe(false);
    expect(toastShowConfigMock).toHaveBeenCalledWith('success', expect.any(Object));
  });

  it('downloads encrypted settings, decrypts them and saves the imported config', async () => {
    vi.useFakeTimers();
    clientGetFileMock.mockResolvedValueOnce('encrypted-payload');
    isPasswordEncryptedDataMock.mockReturnValueOnce(true);

    const deps = makeDeps();
    deps.tryDecryptContent.mockResolvedValueOnce(JSON.stringify({ fromCloud: true }));
    const ops = createConfigSyncOps(deps);

    await ops.downloadSettingsOverwrite(profile);
    await vi.runAllTimersAsync();

    expect(deps.downloadSettingsMenuVisible.value).toBe(false);
    expect(deps.tryDecryptContent).toHaveBeenCalledWith('encrypted-payload');
    expect(configStoreSetMock).toHaveBeenCalledWith('config', { fromCloud: true });
    expect(configStoreSaveMock).toHaveBeenCalledTimes(1);
    expect(updateConfigSyncStatusMock).toHaveBeenCalledWith(profile, 'success');
    expect(toastShowConfigMock).toHaveBeenCalledWith('success', expect.any(Object));
    expect(toastShowConfigMock).toHaveBeenCalledWith('info', expect.any(Object));
  });

  it('merges downloaded settings while preserving the current WebDAV config', async () => {
    configStoreGetMock.mockResolvedValueOnce({
      webdav: { url: 'https://local.example.com' },
      keepLocal: true,
    });
    clientGetFileMock.mockResolvedValueOnce(JSON.stringify({
      webdav: { url: 'https://cloud.example.com' },
      fromCloud: true,
    }));

    const deps = makeDeps();
    const ops = createConfigSyncOps(deps);

    await ops.downloadSettingsMerge(profile);

    expect(configStoreSetMock).toHaveBeenCalledWith('config', {
      webdav: { url: 'https://local.example.com' },
      fromCloud: true,
    });
    expect(updateConfigSyncStatusMock).toHaveBeenCalledWith(profile, 'success');
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
  });

  it('marks syncConfig as partial when upload fails after cloud data has already been merged locally', async () => {
    clientGetFileMock.mockResolvedValueOnce(JSON.stringify({
      webdav: { url: 'https://cloud.example.com' },
      remoteFlag: true,
    }));
    configStoreGetMock
      .mockResolvedValueOnce({ webdav: { url: 'https://local.example.com' } })
      .mockResolvedValueOnce({
        webdav: { url: 'https://local.example.com' },
        remoteFlag: true,
      });
    clientPutFileMock.mockRejectedValueOnce(new Error('put failed'));
    extractErrorCodeMock.mockReturnValueOnce('PUT_FAILED');

    const deps = makeDeps();
    const ops = createConfigSyncOps(deps);

    await ops.syncConfig(profile);

    expect(configStoreSetMock).toHaveBeenCalledWith('config', {
      webdav: { url: 'https://local.example.com' },
      remoteFlag: true,
    });
    expect(updateConfigSyncStatusMock).toHaveBeenCalledWith(profile, 'partial', 'PUT_FAILED');
    expect(writeSyncLogMock).toHaveBeenCalledWith('sync_settings', 'failed', 'PUT_FAILED', profile);
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(deps.syncConfigLoading.value).toBe(false);
  });
});
