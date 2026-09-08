import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const {
  historyGetCountMock,
  historyExportToJSONMock,
  historyGetAllItemsMock,
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
  historyGetAllItemsMock: vi.fn(),
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
    getAllItems: historyGetAllItemsMock,
    importFromJSON: historyImportFromJSONMock,
  },
}));

vi.mock('@/composables/useHistory', () => ({
  invalidateCache: invalidateCacheMock,
}));

vi.mock('@/events/cacheEvents', () => ({
  emitHistoryUpdated: emitHistoryUpdatedMock,
}));

// Why 只桩掉有副作用的三个（写日志 / 翻译错误码 / 建 WebDAV 客户端），
// isWebDAVNotFoundError 与 parseCloudHistoryForUpload 用**真实实现**：
// 它们是纯函数，而且「云端数据不可用要不要中止」这条防覆盖安全线正是本文件要断言的东西，
// 手抄一份副本等于断言一段假逻辑（此前那份副本就已经漏掉了 /file.*not.*exist/i 分支）。
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
    historyGetAllItemsMock.mockResolvedValue([]);
    // 真实签名是 Promise<HistoryImportResult>；此前桩成 undefined，
    // 导致 toast 里插出 `undefined 条` 也能被 expect.any(String) 放过（假绿）。
    historyImportFromJSONMock.mockResolvedValue({
      total: 2, imported: 2, added: 2, updated: 0, skipped: 0,
    });
    clientGetFileMock.mockResolvedValue('[]');
    clientPutFileMock.mockResolvedValue(undefined);
    writeSyncLogMock.mockResolvedValue(undefined);
    extractErrorCodeMock.mockReturnValue('HISTORY_ERR');
    confirmDialogMock.mockResolvedValue(true);
    emitHistoryUpdatedMock.mockResolvedValue(undefined);
  });

  it('merges local and cloud history by id and timestamp before uploading', async () => {
    historyGetAllItemsMock.mockResolvedValueOnce([
      { id: 'a', timestamp: 200 },
      { id: 'b', timestamp: 100 },
    ]);
    clientGetFileMock.mockResolvedValueOnce(JSON.stringify([
      { id: 'a', timestamp: 100 },
      { id: 'c', timestamp: 300 },
    ]));

    const deps = makeDeps();
    const ops = createHistorySyncOps(deps);

    await ops.syncHistory(profile);

    const [, uploadedJson] = clientPutFileMock.mock.calls[0];
    expect(JSON.parse(uploadedJson as string)).toEqual([
      { id: 'c', timestamp: 300 },
      { id: 'a', timestamp: 200, isFavorited: false },
      { id: 'b', timestamp: 100 },
    ]);
    expect(updateHistorySyncStatusMock).toHaveBeenCalledWith(profile, 'success');
    expect(writeSyncLogMock).toHaveBeenCalledWith('sync_history', 'success', expect.any(String), profile);
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

  // 两个方向都没有差异时，「同步」必须说实话：不写云端，且提示是「已是最新」而不是「已同步」。
  // 此前这里无条件 putFile 并弹「已同步，共 N 条记录」，一条没动也这么说——
  // 用户没法从提示里分辨「真同步了」和「其实什么都没发生」。
  it('reports 已是最新 and skips the cloud write when neither side changed', async () => {
    historyGetAllItemsMock.mockResolvedValueOnce([
      { id: 'a', timestamp: 200, isFavorited: false },
    ]);
    clientGetFileMock.mockResolvedValueOnce(JSON.stringify([
      { id: 'a', timestamp: 200, isFavorited: false },
    ]));
    historyImportFromJSONMock.mockResolvedValueOnce({
      total: 1, imported: 0, added: 0, updated: 0, skipped: 0,
    });

    const deps = makeDeps();
    const ops = createHistorySyncOps(deps);

    await ops.syncHistory(profile);

    expect(clientPutFileMock).not.toHaveBeenCalled();
    expect(updateHistorySyncStatusMock).toHaveBeenCalledWith(profile, 'success');
    expect(toastInfoMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(writeSyncLogMock).toHaveBeenCalledWith(
      'sync_history', 'success', expect.stringContaining('无变化'), profile,
    );
  });

  // 只有拉取方向有变化：云端没有可推的新东西，所以不写云端，但提示必须说出「拉取」发生了什么
  it('reports only the pull direction when the cloud had nothing new to receive', async () => {
    historyGetAllItemsMock.mockResolvedValueOnce([
      { id: 'a', timestamp: 200, isFavorited: false },
    ]);
    clientGetFileMock.mockResolvedValueOnce(JSON.stringify([
      { id: 'a', timestamp: 200, isFavorited: false },
    ]));
    historyImportFromJSONMock.mockResolvedValueOnce({
      total: 1, imported: 1, added: 1, updated: 0, skipped: 0,
    });

    const deps = makeDeps();
    const ops = createHistorySyncOps(deps);

    await ops.syncHistory(profile);

    expect(clientPutFileMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    const [, detail] = toastSuccessMock.mock.calls[0];
    expect(detail).toContain('拉取新增 1 条');
    expect(detail).not.toContain('推送');
  });

  it('sync upload includes records whose only change is newer favorite metadata', async () => {
    historyGetAllItemsMock.mockResolvedValueOnce([
      { id: 'a', timestamp: 200, isFavorited: true, favoriteUpdatedAt: 500, favoriteUpdatedBy: 'local' },
    ]);
    clientGetFileMock.mockResolvedValueOnce(JSON.stringify([
      { id: 'a', timestamp: 200, isFavorited: false, favoriteUpdatedAt: 100, favoriteUpdatedBy: 'cloud' },
    ]));

    const deps = makeDeps();
    const ops = createHistorySyncOps(deps);

    await ops.syncHistory(profile);

    const [, uploadedJson] = clientPutFileMock.mock.calls[0];
    expect(JSON.parse(uploadedJson as string)).toEqual([
      { id: 'a', timestamp: 200, isFavorited: true, favoriteUpdatedAt: 500, favoriteUpdatedBy: 'local' },
    ]);
    expect(updateHistorySyncStatusMock).toHaveBeenCalledWith(profile, 'success');
  });

  // ==================== 防「静默覆盖云端」回归 ====================
  //
  // 三个上传方向的入口在拉取云端时，此前只认「抛异常」这一种失败形态。云端文件是
  // 0 字节、或是合法 JSON 但不是数组时，两者都不抛异常，cloudItems 保持 []，
  // 第二步就把本地那份 putFile 上去，把只存在于其他设备的记录整份抹掉，还报「已同步」。
  // 断言的核心是同一条：**putFile 绝不能被调用**。
  describe.each([
    ['云端文件是 0 字节', ''],
    ['云端内容是合法 JSON 但不是数组', JSON.stringify({ items: [] })],
  ])('拒绝在「%s」时覆盖云端', (_label, payload) => {
    beforeEach(() => {
      historyGetAllItemsMock.mockResolvedValue([{ id: 'local-only', timestamp: 200 }]);
    });

    it('syncHistory 中止，不写云端也不导入本地', async () => {
      clientGetFileMock.mockResolvedValueOnce(payload);
      const ops = createHistorySyncOps(makeDeps());

      await ops.syncHistory(profile);

      expect(clientPutFileMock).not.toHaveBeenCalled();
      expect(historyImportFromJSONMock).not.toHaveBeenCalled();
      // stage 仍是 'download' → 必须是 failed 而不是 partial，
      // 更不能报「云端数据已合并到本地」——步骤 1 其实什么都没合并。
      expect(updateHistorySyncStatusMock).toHaveBeenCalledWith(profile, 'failed', 'HISTORY_ERR');
      expect(updateHistorySyncStatusMock).not.toHaveBeenCalledWith(profile, 'partial', expect.anything());
    });
  });

  // 反向回归：云端文件**真的不存在**（getFile 返回 null，HTTP 404）是首次同步的正常路径，
  // 必须照常全量上传。上面那条中止逻辑若写成 `if (!content)` 就会把这条路一起堵死。
  it('首次同步（云端返回 null）仍照常全量上传', async () => {
    historyGetAllItemsMock.mockResolvedValue([{ id: 'local-only', timestamp: 200 }]);
    clientGetFileMock.mockResolvedValueOnce(null);

    const ops = createHistorySyncOps(makeDeps());

    await ops.syncHistory(profile);

    expect(clientPutFileMock).toHaveBeenCalledTimes(1);
    const [, uploadedJson] = clientPutFileMock.mock.calls[0];
    expect(JSON.parse(uploadedJson as string)).toEqual([{ id: 'local-only', timestamp: 200 }]);
    expect(updateHistorySyncStatusMock).toHaveBeenCalledWith(profile, 'success');
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
    historyImportFromJSONMock.mockResolvedValueOnce({
      total: 2, imported: 2, added: 2, updated: 0, skipped: 0,
    });

    const deps = makeDeps();
    const ops = createHistorySyncOps(deps);

    await ops.downloadHistoryOverwrite(profile);

    expect(historyImportFromJSONMock).toHaveBeenCalledWith(cloudJson, 'replace');
    expect(invalidateCacheMock).toHaveBeenCalledTimes(1);
    expect(emitHistoryUpdatedMock).toHaveBeenCalledTimes(1);
    expect(updateHistorySyncStatusMock).toHaveBeenCalledWith(profile, 'success');
    // 日志/toast 用真实入库数，而不是云端文件里写了多少条
    expect(writeSyncLogMock).toHaveBeenCalledWith(
      'download_history_cloud', 'success', expect.stringContaining('2 条记录'), profile);
    expect(toastSuccessMock).toHaveBeenCalledWith('已下载', expect.stringContaining('2 条记录'));
  });

  // 云端有格式无效记录时，导入返回值会把跳过条数报给用户，而不是静默少报
  it('reports skipped records on downloadHistoryOverwrite', async () => {
    const cloudJson = JSON.stringify([
      { id: 'ok', timestamp: 200 },
      { id: 'broken', localFileName: '' },
    ]);
    clientGetFileMock.mockResolvedValueOnce(cloudJson);
    historyImportFromJSONMock.mockResolvedValueOnce({
      total: 2, imported: 1, added: 1, updated: 0, skipped: 1,
    });

    const deps = makeDeps();
    const ops = createHistorySyncOps(deps);

    await ops.downloadHistoryOverwrite(profile);

    expect(writeSyncLogMock).toHaveBeenCalledWith(
      'download_history_cloud', 'success', expect.stringContaining('跳过 1 条格式无效记录'), profile);
    expect(toastSuccessMock).toHaveBeenCalledWith(
      '已下载', expect.stringContaining('跳过 1 条格式无效记录'));
  });

  it('marks syncHistory as partial when upload fails after cloud data has already been merged locally', async () => {
    clientGetFileMock.mockResolvedValueOnce(JSON.stringify([
      { id: 'cloud', timestamp: 100 },
    ]));
    historyGetCountMock.mockResolvedValueOnce(2);
    historyGetAllItemsMock.mockResolvedValueOnce([
      { id: 'cloud', timestamp: 100 },
      { id: 'local', timestamp: 200 },
    ]);
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
    expect(historyGetAllItemsMock).not.toHaveBeenCalled();
    expect(clientPutFileMock).not.toHaveBeenCalled();
    expect(updateHistorySyncStatusMock).toHaveBeenCalledWith(profile, 'failed', 'AUTH_FAILED');
    expect(writeSyncLogMock).toHaveBeenCalledWith('sync_history', 'failed', 'AUTH_FAILED', profile);
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(deps.releaseCloudSync).toHaveBeenCalledTimes(1);
  });
});
