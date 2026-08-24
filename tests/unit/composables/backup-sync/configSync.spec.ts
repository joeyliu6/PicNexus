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

vi.mock('@/store/instances', () => ({
  configStore: {
    get: configStoreGetMock,
    set: configStoreSetMock,
    save: configStoreSaveMock,
  },
}));

vi.mock('@/config/types', async importOriginal => {
  const actual = await importOriginal<typeof import('@/config/types')>();
  return {
    ...actual,
    isValidUserConfig: isValidUserConfigMock,
  };
});

vi.mock('@/security/crypto', () => ({
  secureStorage: {
    isPasswordMode: isPasswordModeMock,
    encrypt: encryptMock,
  },
  isPasswordEncryptedData: isPasswordEncryptedDataMock,
}));

// isWebDAVNotFoundError 用真实实现：它是纯函数，而「拉取云端失败该不该中止」这条防覆盖
// 安全线正是本文件断言的对象。手抄副本会断言一段假逻辑——此前那份就已漏掉
// /file.*not.*exist/i 分支。
vi.mock('@/composables/backup-sync/backupSyncUtils', async () => {
  const actual = await vi.importActual<typeof import('@/composables/backup-sync/backupSyncUtils')>(
    '@/composables/backup-sync/backupSyncUtils',
  );
  return {
    ...actual,
    writeSyncLog: writeSyncLogMock,
    extractErrorCode: extractErrorCodeMock,
    getWebDAVClientAndPath: getWebDAVClientAndPathMock,
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

const { createConfigSyncOps } = await import('@/composables/backup-sync/ConfigSync');

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
      addRaw: vi.fn(),
      removeGroup: vi.fn(),
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
    needsReload: ref(false),
    acquireCloudSync: vi.fn(() => true),
    releaseCloudSync: vi.fn(),
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
    isPasswordModeMock.mockReturnValue(true);
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

  it('blocks config upload before WebDAV setup or locking when no backup password exists', async () => {
    isPasswordModeMock.mockReturnValue(false);
    const deps = makeDeps();
    const ops = createConfigSyncOps(deps);

    await ops.uploadSettingsCloud(profile);

    expect(getWebDAVClientAndPathMock).not.toHaveBeenCalled();
    expect(deps.acquireCloudSync).not.toHaveBeenCalled();
    expect(clientPutFileMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });

  it('blocks bidirectional config sync before network access when no backup password exists', async () => {
    isPasswordModeMock.mockReturnValue(false);
    const deps = makeDeps();
    const ops = createConfigSyncOps(deps);

    await ops.syncConfig(profile);

    expect(getWebDAVClientAndPathMock).not.toHaveBeenCalled();
    expect(deps.acquireCloudSync).not.toHaveBeenCalled();
    expect(clientGetFileMock).not.toHaveBeenCalled();
    expect(clientPutFileMock).not.toHaveBeenCalled();
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
    expect(deps.needsReload.value).toBe(true);
  });

  it('does not download overwrite settings when the destructive confirmation is rejected', async () => {
    confirmDialogMock.mockResolvedValueOnce(false);

    const deps = makeDeps();
    const ops = createConfigSyncOps(deps);

    await ops.downloadSettingsOverwrite(profile);

    expect(deps.downloadSettingsMenuVisible.value).toBe(false);
    expect(deps.acquireCloudSync).not.toHaveBeenCalled();
    expect(clientGetFileMock).not.toHaveBeenCalled();
    expect(configStoreSetMock).not.toHaveBeenCalled();
    expect(updateConfigSyncStatusMock).not.toHaveBeenCalled();
  });

  it('marks download overwrite as failed when cloud settings are not a valid config', async () => {
    clientGetFileMock.mockResolvedValueOnce(JSON.stringify({ results: [] }));
    isValidUserConfigMock.mockReturnValueOnce(false);

    const deps = makeDeps();
    const ops = createConfigSyncOps(deps);

    await ops.downloadSettingsOverwrite(profile);

    expect(configStoreSetMock).not.toHaveBeenCalled();
    expect(updateConfigSyncStatusMock).toHaveBeenCalledWith(profile, 'failed', expect.any(String));
    expect(writeSyncLogMock.mock.calls.some(([operation, result]) => (
      operation === 'download_settings_cloud' && result === 'success'
    ))).toBe(false);
    expect(toastShowConfigMock).toHaveBeenCalledWith('error', expect.any(Object));
    expect(deps.releaseCloudSync).toHaveBeenCalledTimes(1);
    expect(deps.downloadSettingsLoading.value).toBe(false);
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

  it('cancels syncConfig without uploading when the password dialog is cancelled during cloud download', async () => {
    clientGetFileMock.mockResolvedValueOnce('encrypted-payload');
    isPasswordEncryptedDataMock.mockReturnValueOnce(true);

    const deps = makeDeps();
    deps.tryDecryptContent.mockRejectedValueOnce(new Error('user_cancelled'));
    const ops = createConfigSyncOps(deps);

    await ops.syncConfig(profile);

    expect(clientPutFileMock).not.toHaveBeenCalled();
    expect(updateConfigSyncStatusMock).not.toHaveBeenCalled();
    expect(writeSyncLogMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(deps.releaseCloudSync).toHaveBeenCalledTimes(1);
    expect(deps.syncConfigLoading.value).toBe(false);
  });

  it('stops syncConfig before upload when cloud settings download fails with a non-404 WebDAV error', async () => {
    clientGetFileMock.mockRejectedValueOnce(new Error('401 Unauthorized'));
    extractErrorCodeMock.mockReturnValueOnce('AUTH_FAILED');

    const deps = makeDeps();
    const ops = createConfigSyncOps(deps);

    await ops.syncConfig(profile);

    expect(clientPutFileMock).not.toHaveBeenCalled();
    expect(configStoreSetMock).not.toHaveBeenCalled();
    expect(updateConfigSyncStatusMock).toHaveBeenCalledWith(profile, 'failed', 'AUTH_FAILED');
    expect(writeSyncLogMock).toHaveBeenCalledWith('sync_settings', 'failed', 'AUTH_FAILED', profile);
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });

  it('stops syncConfig before upload when cloud settings are not a valid config', async () => {
    clientGetFileMock.mockResolvedValueOnce(JSON.stringify({ results: [] }));
    isValidUserConfigMock.mockReturnValueOnce(false);
    extractErrorCodeMock.mockReturnValueOnce('INVALID_CLOUD_CONFIG');

    const deps = makeDeps();
    const ops = createConfigSyncOps(deps);

    await ops.syncConfig(profile);

    expect(clientPutFileMock).not.toHaveBeenCalled();
    expect(configStoreSetMock).not.toHaveBeenCalled();
    expect(updateConfigSyncStatusMock).toHaveBeenCalledWith(profile, 'failed', 'INVALID_CLOUD_CONFIG');
    expect(writeSyncLogMock).toHaveBeenCalledWith('sync_settings', 'failed', 'INVALID_CLOUD_CONFIG', profile);
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });

  // 云端 settings.json 是 0 字节（多半是上次 PUT 中断留下的）：此前 `if (rawContent)`
  // 把空串当成「首次同步」，步骤 2 直接拿本地配置盖掉云端。
  it('stops syncConfig before upload when the cloud config file is empty', async () => {
    clientGetFileMock.mockResolvedValueOnce('');

    const deps = makeDeps();
    const ops = createConfigSyncOps(deps);

    await ops.syncConfig(profile);

    expect(clientPutFileMock).not.toHaveBeenCalled();
    expect(configStoreSetMock).not.toHaveBeenCalled();
    expect(updateConfigSyncStatusMock).toHaveBeenCalledWith(profile, 'failed', 'SYNC_ERR');
    // stage 仍是 'download'、hasCloudData 仍是 false → 不能误报「云端数据已合并到本地」，
    // 也不能点亮需要重启的 banner。
    expect(updateConfigSyncStatusMock).not.toHaveBeenCalledWith(profile, 'partial', expect.anything());
    expect(deps.needsReload.value).toBe(false);
  });

  // 反向回归：云端**真的**还没有 settings.json（getFile 返回 null）是首次同步的正常路径，
  // 必须照常上传。上面那条中止若写成 `!rawContent` 就会把首次同步一起堵死。
  it('still uploads on first sync when the cloud config file does not exist', async () => {
    clientGetFileMock.mockResolvedValueOnce(null);

    const deps = makeDeps();
    const ops = createConfigSyncOps(deps);

    await ops.syncConfig(profile);

    expect(clientPutFileMock).toHaveBeenCalledTimes(1);
    expect(updateConfigSyncStatusMock).toHaveBeenCalledWith(profile, 'success');
  });
});
