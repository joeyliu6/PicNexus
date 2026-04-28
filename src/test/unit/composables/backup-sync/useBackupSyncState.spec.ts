import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  syncStatusStoreGetMock,
  syncStatusStoreSetMock,
  syncStatusStoreSaveMock,
  getFullTimestampMock,
} = vi.hoisted(() => ({
  syncStatusStoreGetMock: vi.fn(),
  syncStatusStoreSetMock: vi.fn(),
  syncStatusStoreSaveMock: vi.fn(),
  getFullTimestampMock: vi.fn(),
}));

vi.mock('../../../../store/instances', () => ({
  syncStatusStore: {
    get: syncStatusStoreGetMock,
    set: syncStatusStoreSetMock,
    save: syncStatusStoreSaveMock,
  },
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../../composables/backup-sync/backupSyncUtils', () => ({
  getFullTimestamp: getFullTimestampMock,
}));

const { useBackupSyncState } = await import('../../../../composables/backup-sync/useBackupSyncState');

const profile = {
  id: 'profile-1',
  name: 'Main WebDAV',
  url: 'https://dav.example.com',
  username: 'user',
  password: 'pass',
  remotePath: '/PicNexus/',
};

describe('useBackupSyncState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncStatusStoreGetMock.mockResolvedValue(undefined);
    syncStatusStoreSetMock.mockResolvedValue(undefined);
    syncStatusStoreSaveMock.mockResolvedValue(undefined);
    getFullTimestampMock.mockReturnValue('2026-04-28 17:00:00');
  });

  it('migrates legacy flat sync status into profile records and persists the migrated shape', async () => {
    syncStatusStoreGetMock.mockResolvedValueOnce({
      configLastSync: '2026-04-20 10:00:00',
      configSyncResult: 'failed',
      configSyncError: 'old config error',
      historyLastSync: '2026-04-21 10:00:00',
      historySyncResult: 'success',
      lastJdCheck: 123,
    });

    const state = useBackupSyncState();

    await state.loadSyncStatus();

    expect(state.syncStatus.value.lastJdCheck).toBe(123);
    expect(state.syncStatus.value.syncByProfile.__legacy__).toEqual(
      expect.objectContaining({
        configLastSync: '2026-04-20 10:00:00',
        configSyncResult: 'failed',
        configSyncError: 'old config error',
        historyLastSync: '2026-04-21 10:00:00',
        historySyncResult: 'success',
      }),
    );
    expect(syncStatusStoreSetMock).toHaveBeenCalledWith('status', state.syncStatus.value);
    expect(syncStatusStoreSaveMock).toHaveBeenCalledTimes(1);
  });

  it('updates config and history status per profile without touching null profiles', () => {
    const state = useBackupSyncState();

    state.updateConfigSyncStatus(profile, 'failed', 'network failed');
    state.updateHistorySyncStatus(profile, 'partial', 'upload failed');
    state.updateConfigSyncStatus(null, 'success');

    expect(state.getProfileSyncRecord('profile-1')).toEqual({
      providerName: 'Main WebDAV',
      configLastSync: '2026-04-28 17:00:00',
      configSyncResult: 'failed',
      configSyncError: 'network failed',
      historyLastSync: '2026-04-28 17:00:00',
      historySyncResult: 'partial',
      historySyncError: 'upload failed',
    });
    expect(syncStatusStoreSetMock).toHaveBeenCalledTimes(2);
  });

  it('serializes cloud operations with a shared lock and releases it explicitly', () => {
    const state = useBackupSyncState();
    const toast = { warn: vi.fn() };

    expect(state.acquireCloudSync(toast as never)).toBe(true);
    expect(state.isCloudSyncing.value).toBe(true);
    expect(state.acquireCloudSync(toast as never)).toBe(false);
    expect(toast.warn).toHaveBeenCalledTimes(1);

    state.releaseCloudSync();

    expect(state.isCloudSyncing.value).toBe(false);
    expect(state.acquireCloudSync(toast as never)).toBe(true);
  });

  it('keeps only one backup dropdown menu open at a time', () => {
    const state = useBackupSyncState();

    state.toggleUploadHistoryMenu();
    expect(state.uploadHistoryMenuVisible.value).toBe(true);

    state.toggleDownloadSettingsMenu();
    expect(state.uploadHistoryMenuVisible.value).toBe(false);
    expect(state.downloadSettingsMenuVisible.value).toBe(true);

    state.toggleDownloadHistoryMenu();
    expect(state.downloadSettingsMenuVisible.value).toBe(false);
    expect(state.downloadHistoryMenuVisible.value).toBe(true);

    state.closeAllMenus();
    expect(state.uploadHistoryMenuVisible.value).toBe(false);
    expect(state.downloadSettingsMenuVisible.value).toBe(false);
    expect(state.downloadHistoryMenuVisible.value).toBe(false);
  });
});
