import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { useSettingsForm } from '../../../../composables/settings/useSettingsForm';
import { makeCustomS3Id } from '../../../../config/types';
import { createConfig } from '../../../factories/configFactory';
import { resetTauriMocks, setupInvokeResponses } from '../../../helpers/tauriMock';

const mockState = vi.hoisted(() => ({
  configStoreGet: vi.fn(),
  saveConfig: vi.fn(),
  toastShowConfig: vi.fn(),
  confirm: vi.fn(),
  loadHealthStatus: vi.fn(),
  evaluateConfig: vi.fn(),
  syncCustomS3Uploaders: vi.fn(),
}));

vi.mock('../../../../store/instances', () => ({
  configStore: {
    get: mockState.configStoreGet,
  },
}));

vi.mock('../../../../composables/useConfig', () => ({
  useConfigManager: () => ({
    saveConfig: mockState.saveConfig,
  }),
}));

vi.mock('../../../../composables/useToast', () => ({
  useToast: () => ({
    showConfig: mockState.toastShowConfig,
  }),
}));

vi.mock('../../../../composables/useConfirm', () => ({
  useConfirm: () => ({
    confirm: mockState.confirm,
  }),
}));

vi.mock('../../../../composables/useServiceHealth', () => ({
  useServiceHealth: () => ({
    loadHealthStatus: mockState.loadHealthStatus,
    evaluateConfig: mockState.evaluateConfig,
  }),
}));

vi.mock('../../../../uploaders', () => ({
  syncCustomS3Uploaders: mockState.syncCustomS3Uploaders,
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function r2Config() {
  return {
    enabled: true,
    accountId: 'a'.repeat(32),
    accessKeyId: 'ak',
    secretAccessKey: 'sk',
    bucketName: 'bucket',
    path: 'images/',
    publicDomain: 'https://cdn.example.com',
  };
}

describe('useSettingsForm', () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetTauriMocks();
    vi.clearAllMocks();
    setupInvokeResponses({
      'plugin:autostart|is_enabled': false,
      encrypt_webdav_password: (args: unknown) => {
        const { password } = args as { password?: string };
        return `encrypted:${String(password ?? '')}`;
      },
    });
    mockState.saveConfig.mockResolvedValue(undefined);
    mockState.confirm.mockResolvedValue(true);
    mockState.loadHealthStatus.mockResolvedValue(undefined);
  });

  it('removes an enabled host when its config is cleared and does not auto-enable it again', async () => {
    const api = useSettingsForm();
    mockState.configStoreGet.mockResolvedValue(createConfig({
      availableServices: ['jd', 'weibo'],
      services: {
        weibo: { enabled: true, cookie: 'SUB=old' },
      },
    }));

    await api.loadSettings();
    expect(api.availableServices.value).toEqual(['jd', 'weibo']);

    api.formData.value.weiboCookie = '';
    await nextTick();

    expect(api.availableServices.value).toEqual(['jd']);

    api.formData.value.weiboCookie = 'SUB=new';
    await nextTick();

    expect(api.availableServices.value).toEqual(['jd']);
    api.clearTimers();
  });

  it('saves services, enabled hosts, custom S3 profiles, WebDAV secrets, and extracted Nami token', async () => {
    const api = useSettingsForm();
    mockState.configStoreGet.mockResolvedValue(createConfig({ availableServices: ['jd'] }));

    const customProfile = {
      id: 'profile-1',
      name: 'Private S3',
      endpoint: 'https://s3.example.com',
      accessKeyId: 'custom-ak',
      secretAccessKey: 'custom-sk',
      region: 'auto',
      bucket: 'private-bucket',
      path: 'uploads/',
      publicDomain: 'https://assets.example.com',
    };

    api.formData.value.weiboCookie = 'SUB=abc';
    api.formData.value.r2 = r2Config();
    api.formData.value.smms.token = 'smms-token';
    api.formData.value.nami.cookie = 'foo=1; Auth-Token=NAMI123; bar=2';
    api.availableServices.value = ['jd', 'r2', 'smms', makeCustomS3Id(customProfile.id)];
    api.formData.value.custom_s3_profiles = [customProfile];
    api.formData.value.webdav.profiles = [{
      id: 'dav-1',
      name: 'Main WebDAV',
      url: 'https://dav.example.com',
      username: 'me',
      password: 'secret',
      remotePath: '/PicNexus/',
    }];
    api.formData.value.webdav.activeId = 'dav-1';

    await expect(api.saveSettings({ trackAdvancedStatus: true })).resolves.toBe(true);

    expect(mockState.saveConfig).toHaveBeenCalledTimes(1);
    const savedConfig = mockState.saveConfig.mock.calls[0][0];
    expect(savedConfig.availableServices).toEqual(['jd', 'r2', 'smms', 'custom_s3:profile-1']);
    expect(savedConfig.services.weibo.cookie).toBe('SUB=abc');
    expect(savedConfig.services.r2.accountId).toBe('a'.repeat(32));
    expect(savedConfig.services.smms.token).toBe('smms-token');
    expect(savedConfig.services.nami.authToken).toBe('NAMI123');
    expect(savedConfig.custom_s3_profiles).toEqual([customProfile]);
    expect(savedConfig.webdav.profiles[0]).toMatchObject({
      id: 'dav-1',
      password: '',
      passwordEncrypted: 'encrypted:secret',
    });
    expect(mockState.syncCustomS3Uploaders).toHaveBeenCalledWith([customProfile]);
    expect(mockState.evaluateConfig).toHaveBeenCalledWith(savedConfig);
    expect(api.advancedSaveState.value.status).toBe('saved');
    api.clearTimers();
  });

  it('shows save errors and reloads disk state after saveConfig rejects', async () => {
    const api = useSettingsForm();
    const staleConfig = createConfig({
      availableServices: ['jd'],
      services: {
        weibo: { enabled: true, cookie: 'SUB=on-disk' },
      },
    });
    const editedConfig = createConfig({
      availableServices: ['jd', 'weibo'],
      services: {
        weibo: { enabled: true, cookie: 'SUB=edited' },
      },
    });

    mockState.configStoreGet
      .mockResolvedValueOnce(editedConfig)
      .mockResolvedValueOnce(staleConfig);
    mockState.saveConfig.mockRejectedValueOnce(new Error('Disk full'));

    api.formData.value.weiboCookie = 'SUB=edited';
    api.availableServices.value = ['jd', 'weibo'];

    await expect(api.saveSettings({ trackAdvancedStatus: true })).resolves.toBe(false);

    expect(mockState.toastShowConfig).toHaveBeenCalledWith('error', expect.any(Object));
    expect(api.advancedSaveState.value.status).toBe('error');
    expect(api.advancedSaveState.value.message).toContain('Disk full');
    expect(api.formData.value.weiboCookie).toBe('SUB=on-disk');
    expect(api.availableServices.value).toEqual(['jd']);
  });

  it('does not delete the last enabled custom S3 host before another host is enabled', async () => {
    const api = useSettingsForm();
    const profile = {
      id: 'only',
      name: 'Only S3',
      endpoint: 'https://s3.example.com',
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      region: 'auto',
      bucket: 'bucket',
      path: '',
      publicDomain: 'https://cdn.example.com',
    };
    api.formData.value.custom_s3_profiles = [profile];
    api.availableServices.value = [makeCustomS3Id(profile.id)];

    await api.deleteCustomS3Profile(profile.id);

    expect(mockState.toastShowConfig).toHaveBeenCalledWith('warn', expect.any(Object));
    expect(mockState.confirm).not.toHaveBeenCalled();
    expect(api.formData.value.custom_s3_profiles).toEqual([profile]);
  });
});
