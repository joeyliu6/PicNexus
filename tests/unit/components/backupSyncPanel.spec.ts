import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mountWithDefaults } from '../helpers/vueMount';
import BackupSyncPanel from '@/components/settings/BackupSyncPanel.vue';
import DataItemCard from '@/components/settings/backup/DataItemCard.vue';
import type { WebDAVConfig } from '@/config/types';

const confirmRequireMock = vi.hoisted(() => vi.fn());

const backupFns = vi.hoisted(() => ({
  loadSyncStatus: vi.fn(),
  getProfileSyncRecord: vi.fn(),
  getAllSyncRecords: vi.fn(),
  exportSettingsLocal: vi.fn(),
  importSettingsLocal: vi.fn(),
  exportHistoryLocal: vi.fn(),
  importHistoryLocal: vi.fn(),
  syncConfig: vi.fn(),
  syncHistory: vi.fn(),
  uploadSettingsCloud: vi.fn(),
  downloadSettingsOverwrite: vi.fn(),
  uploadHistoryForce: vi.fn(),
  downloadHistoryOverwrite: vi.fn(),
}));

const backupRefs = vi.hoisted(() => ({
  passwordRequest: null as null | { value: null | { verify: (password: string) => Promise<boolean>; cancel: () => void } },
  needsReload: null as null | { value: boolean },
}));

vi.mock('primevue/useconfirm', () => ({
  useConfirm: () => ({
    require: confirmRequireMock,
  }),
}));

vi.mock('@/composables/useBackupSync', async () => {
  const { ref } = await import('vue');
  backupRefs.passwordRequest = ref(null);
  backupRefs.needsReload = ref(false);

  return {
    useBackupSync: () => ({
      exportSettingsLoading: ref(false),
      importSettingsLoading: ref(false),
      uploadSettingsLoading: ref(false),
      downloadSettingsLoading: ref(false),
      exportHistoryLoading: ref(false),
      importHistoryLoading: ref(false),
      uploadHistoryLoading: ref(false),
      downloadHistoryLoading: ref(false),
      syncConfigLoading: ref(false),
      syncHistoryLoading: ref(false),
      loadSyncStatus: backupFns.loadSyncStatus,
      getProfileSyncRecord: backupFns.getProfileSyncRecord,
      getAllSyncRecords: backupFns.getAllSyncRecords,
      exportSettingsLocal: backupFns.exportSettingsLocal,
      importSettingsLocal: backupFns.importSettingsLocal,
      exportHistoryLocal: backupFns.exportHistoryLocal,
      importHistoryLocal: backupFns.importHistoryLocal,
      syncConfig: backupFns.syncConfig,
      syncHistory: backupFns.syncHistory,
      uploadSettingsCloud: backupFns.uploadSettingsCloud,
      downloadSettingsOverwrite: backupFns.downloadSettingsOverwrite,
      uploadHistoryForce: backupFns.uploadHistoryForce,
      downloadHistoryOverwrite: backupFns.downloadHistoryOverwrite,
      passwordRequest: backupRefs.passwordRequest,
      needsReload: backupRefs.needsReload,
    }),
  };
});

const ButtonStub = {
  props: ['label', 'disabled', 'loading'],
  emits: ['click'],
  template: '<button class="button-stub" :disabled="disabled || loading" @click="$emit(\'click\', $event)">{{ label }}<slot /></button>',
};

function connectedWebdav(status: 'success' | 'failed' | undefined = 'success'): WebDAVConfig {
  return {
    activeId: 'nas',
    profiles: [
      {
        id: 'nas',
        name: 'NAS',
        url: 'https://dav.example.com',
        username: 'user',
        password: 'secret',
        remotePath: '/PicNexus/',
        connectionStatus: status,
      },
    ],
  };
}

function emptyWebdav(): WebDAVConfig {
  return {
    activeId: '',
    profiles: [],
  };
}

describe('DataItemCard backup and cloud actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits local backup actions and disables cloud sync when WebDAV is unavailable', async () => {
    const wrapper = mountWithDefaults(DataItemCard, {
      props: {
        type: 'config',
        syncStatus: { lastSync: null, result: null },
        isCloudEnabled: false,
        cloudHint: 'WebDAV unavailable',
        localLoading: { export: false, import: false },
        cloudLoading: { sync: false, forceUpload: false, forceDownload: false },
      },
      global: { stubs: { Button: ButtonStub } },
    });

    const buttons = wrapper.findAll('.button-stub');
    await buttons[0].trigger('click');
    await buttons[1].trigger('click');

    expect(wrapper.emitted('export-local')).toHaveLength(1);
    expect(wrapper.emitted('import-local')).toHaveLength(1);
    expect(wrapper.find('.cloud-hint-text').exists()).toBe(true);
    expect(buttons[2].attributes('disabled')).toBeDefined();
    expect(wrapper.find('.dropdown-menu').exists()).toBe(false);
  });

  it('shows failed cloud state and emits force upload/download from the more menu', async () => {
    const wrapper = mountWithDefaults(DataItemCard, {
      props: {
        type: 'history',
        syncStatus: {
          lastSync: new Date(Date.now() - 60_000).toISOString(),
          result: 'failed',
          error: 'remote rejected',
        },
        isCloudEnabled: true,
        providerName: 'NAS',
        localLoading: { export: false, import: false },
        cloudLoading: { sync: false, forceUpload: false, forceDownload: false },
      },
      global: { stubs: { Button: ButtonStub } },
    });

    expect(wrapper.get('.status-badge').classes()).toContain('failed');
    expect(wrapper.get('.status-badge').attributes('data-tooltip')).toContain('remote rejected');

    await wrapper.findAll('.button-stub')[3].trigger('click');
    await wrapper.findAll('.dropdown-item')[0].trigger('click');

    await wrapper.findAll('.button-stub')[3].trigger('click');
    await wrapper.findAll('.dropdown-item')[1].trigger('click');

    expect(wrapper.emitted('force-upload')).toHaveLength(1);
    expect(wrapper.emitted('force-download')).toHaveLength(1);
  });
});

describe('BackupSyncPanel P1 orchestration', () => {
  const passwordSectionApi = {
    openRestoreDialog: vi.fn(),
    openSetPasswordDialog: vi.fn(),
    onRestoreSuccess: vi.fn(),
    onRestoreFailed: vi.fn(),
    isPasswordMode: vi.fn(() => false),
  };

  const BackupPasswordSectionStub = defineComponent({
    emits: ['restore-confirm', 'restore-cancel'],
    setup(_, { emit, expose }) {
      expose(passwordSectionApi);
      return () => h('section', { class: 'password-section-stub' }, [
        h('button', { class: 'restore-confirm-stub', onClick: () => emit('restore-confirm', 'secret') }, 'confirm'),
        h('button', { class: 'restore-cancel-stub', onClick: () => emit('restore-cancel') }, 'cancel'),
      ]);
    },
  });

  const WebDAVConfigStub = defineComponent({
    props: ['modelValue', 'testing'],
    emits: ['update:modelValue', 'save', 'test'],
    setup(_, { emit }) {
      return () => h('section', { class: 'webdav-stub' }, [
        h('button', { class: 'webdav-save-stub', onClick: () => emit('save') }, 'save'),
        h('button', { class: 'webdav-test-stub', onClick: () => emit('test') }, 'test'),
      ]);
    },
  });

  const DataItemCardStub = defineComponent({
    props: ['type', 'isCloudEnabled', 'cloudHint'],
    emits: ['export-local', 'import-local', 'sync-cloud', 'force-upload', 'force-download'],
    setup(props, { emit }) {
      return () => h('section', { class: `data-card-stub data-card-${props.type}` }, [
        h('span', { class: 'cloud-hint-stub' }, String(props.cloudHint ?? '')),
        h('button', { class: `export-${props.type}`, onClick: () => emit('export-local') }, 'export'),
        h('button', { class: `import-${props.type}`, onClick: () => emit('import-local') }, 'import'),
        h('button', { class: `sync-${props.type}`, onClick: () => emit('sync-cloud') }, 'sync'),
        h('button', { class: `upload-${props.type}`, onClick: () => emit('force-upload') }, 'upload'),
        h('button', { class: `download-${props.type}`, onClick: () => emit('force-download') }, 'download'),
      ]);
    },
  });

  function mountPanel(webdavConfig: WebDAVConfig = connectedWebdav()) {
    return mountWithDefaults(BackupSyncPanel, {
      props: {
        webdavConfig,
        webdavTesting: false,
      },
      global: {
        stubs: {
          Divider: { template: '<hr />' },
          ReloadBanner: { template: '<section class="reload-banner-stub" />' },
          BackupPasswordSection: BackupPasswordSectionStub,
          WebDAVConfigCollapsible: WebDAVConfigStub,
          DataItemCard: DataItemCardStub,
          SyncHistoryLog: {
            template: '<section class="sync-log-stub" />',
            methods: { refresh: vi.fn() },
          },
        },
      },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    passwordSectionApi.isPasswordMode.mockReturnValue(true);
    backupRefs.passwordRequest!.value = null;
    backupRefs.needsReload!.value = false;
    backupFns.getProfileSyncRecord.mockReturnValue(null);
    backupFns.getAllSyncRecords.mockReturnValue({});
    confirmRequireMock.mockImplementation((options: { accept?: () => void; reject?: () => void }) => {
      options.accept?.();
    });
  });

  it('runs local backup/import and cloud sync handlers, including the no-password export guide', async () => {
    passwordSectionApi.isPasswordMode.mockReturnValue(false);
    const wrapper = mountPanel();
    await nextTick();

    await wrapper.get('.export-config').trigger('click');
    passwordSectionApi.isPasswordMode.mockReturnValue(true);
    await wrapper.get('.import-config').trigger('click');
    await wrapper.get('.export-history').trigger('click');
    await wrapper.get('.import-history').trigger('click');
    await wrapper.get('.sync-config').trigger('click');
    await wrapper.get('.sync-history').trigger('click');
    await wrapper.get('.upload-config').trigger('click');
    await wrapper.get('.download-config').trigger('click');
    await wrapper.get('.upload-history').trigger('click');
    await wrapper.get('.download-history').trigger('click');

    expect(confirmRequireMock).toHaveBeenCalled();
    expect(backupFns.exportSettingsLocal).toHaveBeenCalled();
    expect(backupFns.importSettingsLocal).toHaveBeenCalled();
    expect(backupFns.exportHistoryLocal).toHaveBeenCalled();
    expect(backupFns.importHistoryLocal).toHaveBeenCalled();
    expect(backupFns.syncConfig).toHaveBeenCalledWith(connectedWebdav().profiles[0]);
    expect(backupFns.syncHistory).toHaveBeenCalledWith(connectedWebdav().profiles[0]);
    expect(backupFns.uploadSettingsCloud).toHaveBeenCalledWith(connectedWebdav().profiles[0]);
    expect(backupFns.downloadSettingsOverwrite).toHaveBeenCalledWith(connectedWebdav().profiles[0]);
    expect(backupFns.uploadHistoryForce).toHaveBeenCalledWith(connectedWebdav().profiles[0]);
    expect(backupFns.downloadHistoryOverwrite).toHaveBeenCalledWith(connectedWebdav().profiles[0]);
  });

  it('opens password setup instead of uploading or syncing config without a password', async () => {
    passwordSectionApi.isPasswordMode.mockReturnValue(false);
    const wrapper = mountPanel();
    await nextTick();

    await wrapper.get('.sync-config').trigger('click');
    await wrapper.get('.upload-config').trigger('click');

    expect(passwordSectionApi.openSetPasswordDialog).toHaveBeenCalledTimes(2);
    expect(backupFns.syncConfig).not.toHaveBeenCalled();
    expect(backupFns.uploadSettingsCloud).not.toHaveBeenCalled();
  });

  it('opens the password setup dialog when the export guide is rejected', async () => {
    passwordSectionApi.isPasswordMode.mockReturnValue(false);
    confirmRequireMock.mockImplementationOnce((options: { reject?: () => void }) => {
      options.reject?.();
    });

    const wrapper = mountPanel();
    await nextTick();

    await wrapper.get('.export-config').trigger('click');

    expect(confirmRequireMock).toHaveBeenCalledTimes(1);
    expect(passwordSectionApi.openSetPasswordDialog).toHaveBeenCalledTimes(1);
    expect(backupFns.exportSettingsLocal).not.toHaveBeenCalled();
  });

  it('opens restore password dialog, handles verify success, and cancels failed restore flows', async () => {
    const verify = vi.fn().mockResolvedValue(true);
    const cancel = vi.fn();
    const wrapper = mountPanel();

    backupRefs.passwordRequest!.value = { verify, cancel };
    await nextTick();

    expect(passwordSectionApi.openRestoreDialog).toHaveBeenCalled();

    await wrapper.get('.restore-confirm-stub').trigger('click');
    await nextTick();

    expect(verify).toHaveBeenCalledWith('secret');
    expect(passwordSectionApi.onRestoreSuccess).toHaveBeenCalled();

    await wrapper.get('.restore-cancel-stub').trigger('click');
    expect(cancel).toHaveBeenCalled();
  });

  it('keeps the password restore dialog open when verification fails', async () => {
    const verify = vi.fn().mockResolvedValue(false);
    const cancel = vi.fn();
    const wrapper = mountPanel();

    backupRefs.passwordRequest!.value = { verify, cancel };
    await nextTick();

    await wrapper.get('.restore-confirm-stub').trigger('click');
    await nextTick();

    expect(verify).toHaveBeenCalledWith('secret');
    expect(passwordSectionApi.onRestoreFailed).toHaveBeenCalledTimes(1);
    expect(passwordSectionApi.onRestoreSuccess).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('passes WebDAV error hints to data cards when the active profile failed connection', () => {
    const wrapper = mountPanel(connectedWebdav('failed'));

    expect(wrapper.findAll('.cloud-hint-stub')[0].text()).toContain('连接失败');
    expect(wrapper.emitted('save')).toBeUndefined();
  });

  it('forwards WebDAV save and connection test events', async () => {
    const wrapper = mountPanel(emptyWebdav());

    await wrapper.get('.webdav-save-stub').trigger('click');
    await wrapper.get('.webdav-test-stub').trigger('click');

    expect(wrapper.emitted('save')).toHaveLength(1);
    expect(wrapper.emitted('testWebDAV')).toHaveLength(1);
  });
});
