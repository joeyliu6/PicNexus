import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const {
  historyGetCountMock,
  historyExportToJSONMock,
  historyImportFromJSONMock,
  invalidateCacheMock,
  emitHistoryUpdatedMock,
  writeSyncLogMock,
  extractErrorCodeMock,
  getWebDAVClientAndPathMock,
  toastSuccessMock,
  toastWarnMock,
  toastInfoMock,
  toastErrorMock,
  confirmDialogMock,
  clientGetFileMock,
  clientPutFileMock,
  updateHistorySyncStatusMock,
} = vi.hoisted(() => ({
  historyGetCountMock: vi.fn(),
  historyExportToJSONMock: vi.fn(),
  historyImportFromJSONMock: vi.fn(),
  invalidateCacheMock: vi.fn(),
  emitHistoryUpdatedMock: vi.fn(),
  writeSyncLogMock: vi.fn(),
  extractErrorCodeMock: vi.fn(),
  getWebDAVClientAndPathMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastWarnMock: vi.fn(),
  toastInfoMock: vi.fn(),
  toastErrorMock: vi.fn(),
  confirmDialogMock: vi.fn(),
  clientGetFileMock: vi.fn(),
  clientPutFileMock: vi.fn(),
  updateHistorySyncStatusMock: vi.fn(),
}));

vi.mock('@/services/HistoryDatabase', () => ({
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

vi.mock('@/composables/backup-sync/backupSyncUtils', () => ({
  writeSyncLog: writeSyncLogMock,
  extractErrorCode: extractErrorCodeMock,
  getWebDAVClientAndPath: getWebDAVClientAndPathMock,
  isWebDAVNotFoundError: (error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    return /\b404\b/.test(msg) || /not\s*found/i.test(msg) || msg.includes('文件不存在');
  },
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { createHistorySyncOps } = await import('@/composables/backup-sync/HistorySync');

function makeDeps() {
  return {
    toast: {
      success: toastSuccessMock,
      warn: toastWarnMock,
      info: toastInfoMock,
      error: toastErrorMock,
      show: vi.fn(),
      clear: vi.fn(),
      showConfig: vi.fn(),
      silent: vi.fn(),
      addRaw: vi.fn(),
      removeGroup: vi.fn(),
    },
    confirmDialog: confirmDialogMock,
    tryDecryptContent: vi.fn(),
    updateConfigSyncStatus: vi.fn(),
    updateHistorySyncStatus: updateHistorySyncStatusMock,
    uploadSettingsLoading: ref(false),
    downloadSettingsLoading: ref(false),
    uploadHistoryLoading: ref(false),
    downloadHistoryLoading: ref(false),
    syncConfigLoading: ref(false),
    syncHistoryLoading: ref(false),
    uploadHistoryMenuVisible: ref(true),
    downloadSettingsMenuVisible: ref(false),
    downloadHistoryMenuVisible: ref(true),
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

describe('createHistorySyncOps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWebDAVClientAndPathMock.mockResolvedValue({
      client: {
        getFile: clientGetFileMock,
        putFile: clientPutFileMock,
      },
      remotePath: '/PicNexus/history.json',
    });
    historyGetCountMock.mockResolvedValue(2);
    historyExportToJSONMock.mockResolvedValue('[]');
    historyImportFromJSONMock.mockResolvedValue(undefined);
    clientGetFileMock.mockResolvedValue('[]');
    clientPutFileMock.mockResolvedValue(undefined);
    writeSyncLogMock.mockResolvedValue(undefined);
    extractErrorCodeMock.mockReturnValue('HISTORY_ERR');
    confirmDialogMock.mockResolvedValue(true);
    emitHistoryUpdatedMock.mockResolvedValue(undefined);
  });

  it('merges local and cloud history by id and timestamp before uploading', async () => {
    historyExportToJSONMock.mockResolvedValueOnce(JSON.stringify([
      { id: 'a', timestamp: 200 },
      { id: 'b', timestamp: 100 },
    ]));
    clientGetFileMock.mockResolvedValueOnce(JSON.stringify([
      { id: 'a', timestamp: 100 },
      { id: 'c', timestamp: 300 },
    ]));

    const deps = makeDeps();
    const ops = createHistorySyncOps(deps);

    await ops.uploadHistoryMerge(profile);

    const [, uploadedJson] = clientPutFileMock.mock.calls[0];
    expect(JSON.parse(uploadedJson as string)).toEqual([
      { id: 'c', timestamp: 300 },
      { id: 'a', timestamp: 200, isFavorited: false },
      { id: 'b', timestamp: 100 },
    ]);
    expect(updateHistorySyncStatusMock).toHaveBeenCalledWith(profile, 'success');
    expect(writeSyncLogMock).toHaveBeenCalledWith('upload_history_cloud', 'success', expect.any(String), profile);
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
  });

  it('force uploads local history after confirmation and closes the upload menu', async () => {
    historyGetCountMock.mockResolvedValueOnce(2);
    historyExportToJSONMock.mockResolvedValueOnce(JSON.stringify([
      { id: 'local-a', timestamp: 200 },
      { id: 'local-b', timestamp: 100 },
    ]));

    const deps = makeDeps();
    const ops = createHistorySyncOps(deps);

    await ops.uploadHistoryForce(profile);

    expect(deps.uploadHistoryMenuVisible.value).toBe(false);
    expect(confirmDialogMock).toHaveBeenCalledTimes(1);
    expect(clientPutFileMock).toHaveBeenCalledWith(
      '/PicNexus/history.json',
      JSON.stringify([
        { id: 'local-a', timestamp: 200 },
        { id: 'local-b', timestamp: 100 },
      ]),
    );
    expect(updateHistorySyncStatusMock).toHaveBeenCalledWith(profile, 'success');
    expect(writeSyncLogMock).toHaveBeenCalledWith('upload_history_cloud', 'success', expect.any(String), profile);
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
  });

  it('does not force upload history when confirmation is rejected', async () => {
    confirmDialogMock.mockResolvedValueOnce(false);

    const deps = makeDeps();
    const ops = createHistorySyncOps(deps);

    await ops.uploadHistoryForce(profile);

    expect(deps.uploadHistoryMenuVisible.value).toBe(false);
    expect(deps.acquireCloudSync).not.toHaveBeenCalled();
    expect(historyExportToJSONMock).not.toHaveBeenCalled();
    expect(clientPutFileMock).not.toHaveBeenCalled();
    expect(updateHistorySyncStatusMock).not.toHaveBeenCalled();
  });

  it('skips incremental upload when the cloud already has every local history id', async () => {
    historyExportToJSONMock.mockResolvedValueOnce(JSON.stringify([
      { id: 'a', timestamp: 200, isFavorited: false },
    ]));
    clientGetFileMock.mockResolvedValueOnce(JSON.stringify([
      { id: 'a', timestamp: 200, isFavorited: false },
    ]));

    const deps = makeDeps();
    const ops = createHistorySyncOps(deps);

    await ops.uploadHistoryIncremental(profile);

    expect(clientPutFileMock).not.toHaveBeenCalled();
    expect(updateHistorySyncStatusMock).toHaveBeenCalledWith(profile, 'success');
    expect(toastInfoMock).toHaveBeenCalledTimes(1);
  });

  it('incremental upload includes records whose only change is newer favorite metadata', async () => {
    historyExportToJSONMock.mockResolvedValueOnce(JSON.stringify([
      { id: 'a', timestamp: 200, isFavorited: true, favoriteUpdatedAt: 500, favoriteUpdatedBy: 'local' },
    ]));
    clientGetFileMock.mockResolvedValueOnce(JSON.stringify([
      { id: 'a', timestamp: 200, isFavorited: false, favoriteUpdatedAt: 100, favoriteUpdatedBy: 'cloud' },
    ]));

    const deps = makeDeps();
    const ops = createHistorySyncOps(deps);

    await ops.uploadHistoryIncremental(profile);

    const [, uploadedJson] = clientPutFileMock.mock.calls[0];
    expect(JSON.parse(uploadedJson as string)).toEqual([
      { id: 'a', timestamp: 200, isFavorited: true, favoriteUpdatedAt: 500, favoriteUpdatedBy: 'local' },
    ]);
    expect(updateHistorySyncStatusMock).toHaveBeenCalledWith(profile, 'success');
  });

  it('stops merge upload when cloud history download fails with a non-404 WebDAV error', async () => {
    historyExportToJSONMock.mockResolvedValueOnce(JSON.stringify([
      { id: 'local', timestamp: 200 },
    ]));
    clientGetFileMock.mockRejectedValueOnce(new Error('401 Unauthorized'));
    extractErrorCodeMock.mockReturnValueOnce('AUTH_FAILED');

    const deps = makeDeps();
    const ops = createHistorySyncOps(deps);

    await ops.uploadHistoryMerge(profile);

    expect(clientPutFileMock).not.toHaveBeenCalled();
    expect(updateHistorySyncStatusMock).toHaveBeenCalledWith(profile, 'failed', 'AUTH_FAILED');
    expect(writeSyncLogMock).toHaveBeenCalledWith('upload_history_cloud', 'failed', 'AUTH_FAILED', profile);
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });

  it('stops incremental upload when cloud history download fails with a non-404 WebDAV error', async () => {
    historyExportToJSONMock.mockResolvedValueOnce(JSON.stringify([
      { id: 'local', timestamp: 200 },
    ]));
    clientGetFileMock.mockRejectedValueOnce(new Error('500 Server Error'));
    extractErrorCodeMock.mockReturnValueOnce('SERVER_FAILED');

    const deps = makeDeps();
    const ops = createHistorySyncOps(deps);

    await ops.uploadHistoryIncremental(profile);

    expect(clientPutFileMock).not.toHaveBeenCalled();
    expect(updateHistorySyncStatusMock).toHaveBeenCalledWith(profile, 'failed', 'SERVER_FAILED');
    expect(writeSyncLogMock).toHaveBeenCalledWith('upload_history_cloud', 'failed', 'SERVER_FAILED', profile);
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });

  it('marks downloadHistoryOverwrite as failed when cloud data is not an array', async () => {
    clientGetFileMock.mockResolvedValueOnce(JSON.stringify({ invalid: true }));

    const deps = makeDeps();
    const ops = createHistorySyncOps(deps);

    await ops.downloadHistoryOverwrite(profile);

    expect(historyImportFromJSONMock).not.toHaveBeenCalled();
    expect(updateHistorySyncStatusMock).toHaveBeenCalledWith(profile, 'failed', 'HISTORY_ERR');
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(deps.downloadHistoryMenuVisible.value).toBe(false);
  });

  it('force downloads cloud history in replace mode and refreshes cached views', async () => {
    const cloudJson = JSON.stringify([
      { id: 'cloud-a', timestamp: 200 },
      { id: 'cloud-b', timestamp: 100 },
    ]);
    clientGetFileMock.mockResolvedValueOnce(cloudJson);

    const deps = makeDeps();
    const ops = createHistorySyncOps(deps);

    await ops.downloadHistoryOverwrite(profile);

    expect(historyImportFromJSONMock).toHaveBeenCalledWith(cloudJson, 'replace');
    expect(invalidateCacheMock).toHaveBeenCalledTimes(1);
    expect(emitHistoryUpdatedMock).toHaveBeenCalledTimes(1);
    expect(updateHistorySyncStatusMock).toHaveBeenCalledWith(profile, 'success');
    expect(writeSyncLogMock).toHaveBeenCalledWith('download_history_cloud', 'success', expect.any(String), profile);
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
  });

  it('marks syncHistory as partial when upload fails after cloud data has already been merged locally', async () => {
    clientGetFileMock.mockResolvedValueOnce(JSON.stringify([
      { id: 'cloud', timestamp: 100 },
    ]));
    historyGetCountMock.mockResolvedValueOnce(2);
    historyExportToJSONMock.mockResolvedValueOnce(JSON.stringify([
      { id: 'cloud', timestamp: 100 },
      { id: 'local', timestamp: 200 },
    ]));
    clientPutFileMock.mockRejectedValueOnce(new Error('upload failed'));
    extractErrorCodeMock.mockReturnValueOnce('UPLOAD_FAILED');

    const deps = makeDeps();
    const ops = createHistorySyncOps(deps);

    await ops.syncHistory(profile);

    expect(historyImportFromJSONMock).toHaveBeenCalledWith(JSON.stringify([
      { id: 'cloud', timestamp: 100 },
    ]), 'merge');
    expect(invalidateCacheMock).toHaveBeenCalledTimes(1);
    expect(emitHistoryUpdatedMock).toHaveBeenCalledTimes(1);
    expect(updateHistorySyncStatusMock).toHaveBeenCalledWith(profile, 'partial', 'UPLOAD_FAILED');
    expect(writeSyncLogMock).toHaveBeenCalledWith('sync_history', 'failed', 'UPLOAD_FAILED', profile);
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(deps.syncHistoryLoading.value).toBe(false);
  });

  it('stops syncHistory before upload when cloud download fails with a non-404 WebDAV error', async () => {
    clientGetFileMock.mockRejectedValueOnce(new Error('401 Unauthorized'));
    extractErrorCodeMock.mockReturnValueOnce('AUTH_FAILED');

    const deps = makeDeps();
    const ops = createHistorySyncOps(deps);

    await ops.syncHistory(profile);

    expect(historyImportFromJSONMock).not.toHaveBeenCalled();
    expect(historyExportToJSONMock).not.toHaveBeenCalled();
    expect(clientPutFileMock).not.toHaveBeenCalled();
    expect(updateHistorySyncStatusMock).toHaveBeenCalledWith(profile, 'failed', 'AUTH_FAILED');
    expect(writeSyncLogMock).toHaveBeenCalledWith('sync_history', 'failed', 'AUTH_FAILED', profile);
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(deps.releaseCloudSync).toHaveBeenCalledTimes(1);
  });
});
