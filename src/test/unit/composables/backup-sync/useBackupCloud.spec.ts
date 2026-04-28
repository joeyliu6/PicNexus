import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const {
  createConfigSyncOpsMock,
  createHistorySyncOpsMock,
  uploadSettingsCloudMock,
  syncConfigMock,
  uploadHistoryForceMock,
  syncHistoryMock,
} = vi.hoisted(() => ({
  createConfigSyncOpsMock: vi.fn(),
  createHistorySyncOpsMock: vi.fn(),
  uploadSettingsCloudMock: vi.fn(),
  syncConfigMock: vi.fn(),
  uploadHistoryForceMock: vi.fn(),
  syncHistoryMock: vi.fn(),
}));

vi.mock('../../../../composables/backup-sync/ConfigSync', () => ({
  createConfigSyncOps: createConfigSyncOpsMock.mockReturnValue({
    uploadSettingsCloud: uploadSettingsCloudMock,
    syncConfig: syncConfigMock,
  }),
}));

vi.mock('../../../../composables/backup-sync/HistorySync', () => ({
  createHistorySyncOps: createHistorySyncOpsMock.mockReturnValue({
    uploadHistoryForce: uploadHistoryForceMock,
    syncHistory: syncHistoryMock,
  }),
}));

const { createBackupCloudOps } = await import('../../../../composables/backup-sync/useBackupCloud');

function makeDeps() {
  return {
    toast: {
      showConfig: vi.fn(),
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
    confirmDialog: vi.fn(),
    tryDecryptContent: vi.fn(),
    updateConfigSyncStatus: vi.fn(),
    updateHistorySyncStatus: vi.fn(),
    uploadSettingsLoading: ref(false),
    downloadSettingsLoading: ref(false),
    uploadHistoryLoading: ref(false),
    downloadHistoryLoading: ref(false),
    syncConfigLoading: ref(false),
    syncHistoryLoading: ref(false),
    uploadHistoryMenuVisible: ref(false),
    downloadSettingsMenuVisible: ref(false),
    downloadHistoryMenuVisible: ref(false),
    needsReload: ref(false),
    acquireCloudSync: vi.fn(() => true),
    releaseCloudSync: vi.fn(),
  };
}

describe('createBackupCloudOps', () => {
  it('combines config and history sync operation groups with the same dependency bundle', () => {
    const deps = makeDeps();

    const ops = createBackupCloudOps(deps);

    expect(createConfigSyncOpsMock).toHaveBeenCalledWith(deps);
    expect(createHistorySyncOpsMock).toHaveBeenCalledWith(deps);
    expect(ops.uploadSettingsCloud).toBe(uploadSettingsCloudMock);
    expect(ops.syncConfig).toBe(syncConfigMock);
    expect(ops.uploadHistoryForce).toBe(uploadHistoryForceMock);
    expect(ops.syncHistory).toBe(syncHistoryMock);
  });
});
