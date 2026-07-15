import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const {
  decryptWithPasswordMock,
  createBackupLocalOpsMock,
  createBackupCloudOpsMock,
  loadSyncStatusMock,
  saveSyncStatusMock,
  getProfileSyncRecordMock,
  getAllSyncRecordsMock,
  toggleUploadHistoryMenuMock,
  toggleDownloadSettingsMenuMock,
  toggleDownloadHistoryMenuMock,
  closeAllMenusMock,
  extractErrorCodeMock,
  getFullTimestampMock,
} = vi.hoisted(() => ({
  decryptWithPasswordMock: vi.fn(),
  createBackupLocalOpsMock: vi.fn(),
  createBackupCloudOpsMock: vi.fn(),
  loadSyncStatusMock: vi.fn(),
  saveSyncStatusMock: vi.fn(),
  getProfileSyncRecordMock: vi.fn(),
  getAllSyncRecordsMock: vi.fn(),
  toggleUploadHistoryMenuMock: vi.fn(),
  toggleDownloadSettingsMenuMock: vi.fn(),
  toggleDownloadHistoryMenuMock: vi.fn(),
  closeAllMenusMock: vi.fn(),
  extractErrorCodeMock: vi.fn(() => 'ERR_CODE'),
  getFullTimestampMock: vi.fn(() => '2026-04-23 12:00:00'),
}));

let mockState: ReturnType<typeof makeState>;
let capturedLocalDeps: any;
let capturedCloudDeps: any;

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    showConfig: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({
    confirm: vi.fn(),
    confirmThreeWay: vi.fn(),
  }),
}));

vi.mock('@/security/crypto', () => ({
  decryptWithPassword: decryptWithPasswordMock,
}));

vi.mock('@/composables/backup-sync/useBackupSyncState', () => ({
  useBackupSyncState: () => mockState,
}));

vi.mock('@/composables/backup-sync/useBackupLocal', () => ({
  createBackupLocalOps: createBackupLocalOpsMock.mockImplementation((deps: unknown) => {
    capturedLocalDeps = deps;
    return {
      exportSettingsLocal: vi.fn(),
      importSettingsLocal: vi.fn(),
      exportHistoryLocal: vi.fn(),
      importHistoryLocal: vi.fn(),
    };
  }),
}));

vi.mock('@/composables/backup-sync/useBackupCloud', () => ({
  createBackupCloudOps: createBackupCloudOpsMock.mockImplementation((deps: unknown) => {
    capturedCloudDeps = deps;
    return {
      uploadSettingsCloud: vi.fn(),
      downloadSettingsOverwrite: vi.fn(),
      downloadSettingsMerge: vi.fn(),
      uploadHistoryForce: vi.fn(),
      uploadHistoryMerge: vi.fn(),
      uploadHistoryIncremental: vi.fn(),
      downloadHistoryOverwrite: vi.fn(),
      downloadHistoryMerge: vi.fn(),
      syncConfig: vi.fn(),
      syncHistory: vi.fn(),
    };
  }),
}));

vi.mock('@/composables/backup-sync/backupSyncUtils', () => ({
  extractErrorCode: extractErrorCodeMock,
  getFullTimestamp: getFullTimestampMock,
}));

function makeState() {
  return {
    syncStatus: ref({ syncByProfile: {} }),
    exportSettingsLoading: ref(false),
    importSettingsLoading: ref(false),
    uploadSettingsLoading: ref(false),
    downloadSettingsLoading: ref(false),
    exportHistoryLoading: ref(false),
    importHistoryLoading: ref(false),
    importHistoryProgress: ref(0),
    uploadHistoryLoading: ref(false),
    downloadHistoryLoading: ref(false),
    syncConfigLoading: ref(false),
    syncHistoryLoading: ref(false),
    uploadHistoryMenuVisible: ref(false),
    downloadSettingsMenuVisible: ref(false),
    downloadHistoryMenuVisible: ref(false),
    configSectionExpanded: ref(false),
    historySectionExpanded: ref(false),
    needsReload: ref(false),
    passwordRequest: ref<{
      verify: (password: string) => Promise<boolean>;
      cancel: () => void;
    } | null>(null),
    loadSyncStatus: loadSyncStatusMock,
    saveSyncStatus: saveSyncStatusMock,
    getProfileSyncRecord: getProfileSyncRecordMock,
    getAllSyncRecords: getAllSyncRecordsMock,
    updateConfigSyncStatus: vi.fn(),
    updateHistorySyncStatus: vi.fn(),
    acquireCloudSync: vi.fn(() => true),
    releaseCloudSync: vi.fn(),
    toggleUploadHistoryMenu: toggleUploadHistoryMenuMock,
    toggleDownloadSettingsMenu: toggleDownloadSettingsMenuMock,
    toggleDownloadHistoryMenu: toggleDownloadHistoryMenuMock,
    closeAllMenus: closeAllMenusMock,
  };
}

const { useBackupSync } = await import('@/composables/backup-sync/useBackupSync');

describe('useBackupSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState = makeState();
    capturedLocalDeps = null;
    capturedCloudDeps = null;
  });

  it('returns the state refs and merged local/cloud operations from its submodules', () => {
    const result = useBackupSync();

    expect(result.syncStatus).toBe(mockState.syncStatus);
    expect(result.exportSettingsLoading).toBe(mockState.exportSettingsLoading);
    expect(result.uploadHistoryMenuVisible).toBe(mockState.uploadHistoryMenuVisible);
    expect(result.loadSyncStatus).toBe(loadSyncStatusMock);
    expect(result.closeAllMenus).toBe(closeAllMenusMock);
    expect(createBackupLocalOpsMock).toHaveBeenCalledTimes(1);
    expect(createBackupCloudOpsMock).toHaveBeenCalledTimes(1);
    expect(capturedLocalDeps.exportSettingsLoading).toBe(mockState.exportSettingsLoading);
    expect(capturedCloudDeps.updateConfigSyncStatus).toBe(mockState.updateConfigSyncStatus);
    expect(result.extractErrorCode).toBe(extractErrorCodeMock);
    expect(result.getFullTimestamp).toBe(getFullTimestampMock);
  });

  it('keeps passwordRequest open until decryption succeeds', async () => {
    decryptWithPasswordMock
      .mockRejectedValueOnce(new Error('wrong password'))
      .mockResolvedValueOnce('plain-text');

    useBackupSync();
    const decryptPromise = capturedCloudDeps.tryDecryptContent('encrypted');

    expect(mockState.passwordRequest.value).not.toBeNull();
    await expect(mockState.passwordRequest.value!.verify('first-try')).resolves.toBe(false);
    expect(mockState.passwordRequest.value).not.toBeNull();

    await expect(mockState.passwordRequest.value!.verify('second-try')).resolves.toBe(true);
    await expect(decryptPromise).resolves.toBe('plain-text');
    expect(mockState.passwordRequest.value).toBeNull();
  });

  it('rejects the pending decrypt flow when the user cancels the password dialog', async () => {
    useBackupSync();
    const decryptPromise = capturedLocalDeps.tryDecryptContent('encrypted');

    expect(mockState.passwordRequest.value).not.toBeNull();
    mockState.passwordRequest.value!.cancel();

    await expect(decryptPromise).rejects.toThrow('user_cancelled');
    expect(mockState.passwordRequest.value).toBeNull();
    expect(decryptWithPasswordMock).not.toHaveBeenCalled();
  });
});
