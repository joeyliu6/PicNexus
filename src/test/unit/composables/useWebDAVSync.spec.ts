import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConfig } from '../../factories/configFactory';
import { createHistoryItem } from '../../factories/historyFactory';

const {
  webDAVFromEncryptedConfigMock,
  clientPutFileMock,
  clientGetFileMock,
  configStoreGetMock,
  configStoreSetMock,
  configStoreSaveMock,
  syncStatusStoreGetMock,
  syncStatusStoreSetMock,
  syncStatusStoreSaveMock,
  historyOpenMock,
  historyGetAllStreamMock,
  historyImportFromJSONMock,
  toastSuccessMock,
  toastErrorMock,
  formatTimestampFullMock,
} = vi.hoisted(() => ({
  webDAVFromEncryptedConfigMock: vi.fn(),
  clientPutFileMock: vi.fn(),
  clientGetFileMock: vi.fn(),
  configStoreGetMock: vi.fn(),
  configStoreSetMock: vi.fn(),
  configStoreSaveMock: vi.fn(),
  syncStatusStoreGetMock: vi.fn(),
  syncStatusStoreSetMock: vi.fn(),
  syncStatusStoreSaveMock: vi.fn(),
  historyOpenMock: vi.fn(),
  historyGetAllStreamMock: vi.fn(),
  historyImportFromJSONMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  formatTimestampFullMock: vi.fn(),
}));

vi.mock('../../../utils/webdav', () => ({
  WebDAVClient: {
    fromEncryptedConfig: webDAVFromEncryptedConfigMock,
  },
}));

vi.mock('../../../store/instances', () => ({
  configStore: {
    get: configStoreGetMock,
    set: configStoreSetMock,
    save: configStoreSaveMock,
  },
  syncStatusStore: {
    get: syncStatusStoreGetMock,
    set: syncStatusStoreSetMock,
    save: syncStatusStoreSaveMock,
  },
}));

vi.mock('../../../services/HistoryDatabase', () => ({
  historyDB: {
    open: historyOpenMock,
    getAllStream: historyGetAllStreamMock,
    importFromJSON: historyImportFromJSONMock,
  },
}));

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    warn: vi.fn(),
    info: vi.fn(),
    showConfig: vi.fn(),
  }),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../utils/formatters', () => ({
  formatTimestampFull: formatTimestampFullMock,
}));

const { useWebDAVSync } = await import('../../../composables/useWebDAVSync');

const profile = {
  id: 'profile-1',
  name: 'Main WebDAV',
  url: 'https://dav.example.com',
  username: 'user',
  password: 'pass',
  remotePath: '/PicNexus/',
};

async function* streamBatches<T>(batches: T[][]): AsyncGenerator<T[]> {
  for (const batch of batches) {
    yield batch;
  }
}

describe('useWebDAVSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    webDAVFromEncryptedConfigMock.mockResolvedValue({
      putFile: clientPutFileMock,
      getFile: clientGetFileMock,
    });
    clientPutFileMock.mockResolvedValue(undefined);
    clientGetFileMock.mockResolvedValue(null);
    configStoreGetMock.mockResolvedValue(createConfig());
    configStoreSetMock.mockResolvedValue(undefined);
    configStoreSaveMock.mockResolvedValue(undefined);
    syncStatusStoreGetMock.mockResolvedValue(undefined);
    syncStatusStoreSetMock.mockResolvedValue(undefined);
    syncStatusStoreSaveMock.mockResolvedValue(undefined);
    historyOpenMock.mockResolvedValue(undefined);
    historyGetAllStreamMock.mockImplementation(() => streamBatches([[createHistoryItem({ id: 'local' })]]));
    historyImportFromJSONMock.mockResolvedValue(1);
    formatTimestampFullMock.mockReturnValue('2026-04-28 17:30:00');
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
  });

  it('reports WebDAV connection failures through result, progress, toast, and persisted sync status', async () => {
    webDAVFromEncryptedConfigMock.mockRejectedValueOnce(new Error('ECONNREFUSED 127.0.0.1'));
    const sync = useWebDAVSync();

    const result = await sync.uploadSettings(profile);

    expect(result).toEqual({
      success: false,
      target: 'settings',
      operation: 'upload',
      message: 'ECONNREFUSED 127.0.0.1',
    });
    expect(sync.isSyncing.value).toBe(false);
    expect(sync.progress.value).toEqual({
      target: 'settings',
      operation: 'upload',
      stage: 'error',
      percent: 0,
      message: 'ECONNREFUSED 127.0.0.1',
    });
    expect(syncStatusStoreSetMock).toHaveBeenCalledWith(
      'status',
      expect.objectContaining({
        syncByProfile: expect.objectContaining({
          'profile-1': expect.objectContaining({
            configSyncResult: 'failed',
            configSyncError: 'ECONNREFUSED 127.0.0.1',
          }),
        }),
      }),
    );
    expect(toastErrorMock).toHaveBeenCalledWith(expect.any(String), 'ECONNREFUSED 127.0.0.1');

    await vi.runOnlyPendingTimersAsync();
    expect(sync.progress.value).toBeNull();
  });

  it('rejects invalid downloaded settings before saving local config', async () => {
    clientGetFileMock.mockResolvedValueOnce(JSON.stringify({ services: {} }));
    const sync = useWebDAVSync();

    const result = await sync.downloadSettings(profile, { mode: 'overwrite' });

    expect(result.success).toBe(false);
    expect(result.target).toBe('settings');
    expect(result.operation).toBe('download');
    expect(configStoreSetMock).not.toHaveBeenCalled();
    expect(configStoreSaveMock).not.toHaveBeenCalled();
    expect(sync.progress.value?.stage).toBe('error');
    expect(syncStatusStoreSetMock).toHaveBeenCalledWith(
      'status',
      expect.objectContaining({
        syncByProfile: expect.objectContaining({
          'profile-1': expect.objectContaining({ configSyncResult: 'failed' }),
        }),
      }),
    );
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });

  it('increments history upload without reuploading ids that already exist in cloud history', async () => {
    const localItems = [
      createHistoryItem({ id: 'existing', timestamp: 200 }),
      createHistoryItem({ id: 'new-local', timestamp: 100 }),
    ];
    historyGetAllStreamMock.mockImplementationOnce(() => streamBatches([localItems]));
    clientGetFileMock.mockResolvedValueOnce(JSON.stringify([
      createHistoryItem({ id: 'existing', timestamp: 50 }),
      { noId: true },
    ]));
    const sync = useWebDAVSync();

    const result = await sync.uploadHistory(profile, { mode: 'incremental' });

    const uploaded = JSON.parse(clientPutFileMock.mock.calls[0][1] as string) as Array<{ id: string }>;
    expect(uploaded.map(item => item.id)).toEqual(['existing', 'new-local']);
    expect(result.success).toBe(true);
    expect(result.itemsAffected).toBe(2);
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
  });

  it('stops history download when cloud data is not an array', async () => {
    clientGetFileMock.mockResolvedValueOnce(JSON.stringify({ invalid: true }));
    const sync = useWebDAVSync();

    const result = await sync.downloadHistory(profile, { mode: 'merge' });

    expect(result.success).toBe(false);
    expect(historyImportFromJSONMock).not.toHaveBeenCalled();
    expect(sync.progress.value?.stage).toBe('error');
    expect(syncStatusStoreSetMock).toHaveBeenCalledWith(
      'status',
      expect.objectContaining({
        syncByProfile: expect.objectContaining({
          'profile-1': expect.objectContaining({ historySyncResult: 'failed' }),
        }),
      }),
    );
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });
});
