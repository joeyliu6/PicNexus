import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { useSettingsForm } from '../../../../composables/settings/useSettingsForm';
import { DEFAULT_CONFIG, makeCustomS3Id, type UserConfig } from '../../../../config/types';
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
    api.formData.value.publicServiceRiskAccepted = true;

    await expect(api.saveSettings({ trackAdvancedStatus: true })).resolves.toBe(true);

    expect(mockState.saveConfig).toHaveBeenCalledTimes(1);
    const savedConfig = mockState.saveConfig.mock.calls[0][0];
    expect(savedConfig.availableServices).toEqual(['jd', 'r2', 'smms', 'custom_s3:profile-1']);
    expect(savedConfig.services.weibo.cookie).toBe('SUB=abc');
    expect(savedConfig.services.r2.accountId).toBe('a'.repeat(32));
    expect(savedConfig.services.smms.token).toBe('smms-token');
    expect(savedConfig.services.nami.authToken).toBe('NAMI123');
    expect(savedConfig.publicServiceRiskAccepted).toBe(true);
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

  it('restores DEFAULT_CONFIG without clearing history or cache state', async () => {
    const api = useSettingsForm();
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
    api.formData.value.smms.token = 'smms-token';
    api.formData.value.custom_s3_profiles = [customProfile];
    api.formData.value.webdav.profiles = [{
      id: 'dav-1',
      name: 'Main WebDAV',
      url: 'https://dav.example.com',
      username: 'me',
      password: 'secret',
      remotePath: '/PicNexus/',
    }];
    api.availableServices.value = ['smms', makeCustomS3Id(customProfile.id)];

    await expect(api.resetToDefaultSettings()).resolves.toBe(true);

    expect(mockState.saveConfig).toHaveBeenCalledTimes(1);
    const savedConfig = mockState.saveConfig.mock.calls[0][0];
    expect(savedConfig.enabledServices).toEqual(['jd', 'qiyu']);
    expect(savedConfig).toMatchObject({
      ...DEFAULT_CONFIG,
      onboardingCompleted: false,
    });
    expect(api.formData.value.weiboCookie).toBe('');
    expect(api.formData.value.smms.token).toBe('');
    expect(api.formData.value.custom_s3_profiles).toEqual([]);
    expect(api.formData.value.webdav).toEqual({ profiles: [], activeId: null });
    expect(api.formData.value.globalShortcut).toEqual(DEFAULT_CONFIG.globalShortcut);
    expect(api.availableServices.value).toEqual(DEFAULT_CONFIG.availableServices);
    expect(mockState.syncCustomS3Uploaders).toHaveBeenLastCalledWith([]);
    expect(mockState.evaluateConfig).toHaveBeenLastCalledWith(savedConfig);
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

  it('reports configured services including cookie, token, cloud, and custom S3 providers', () => {
    const api = useSettingsForm();

    expect(api.serviceConfigStatus.value).toMatchObject({
      upyun: false,
      weibo: false,
      zhihu: false,
      nowcoder: false,
      nami: false,
      bilibili: false,
      chaoxing: false,
      smms: false,
      github: false,
      imgur: false,
      jd: true,
      qiyu: true,
    });

    api.formData.value.tencent = {
      secretId: 'sid',
      secretKey: 'skey',
      region: 'ap-shanghai',
      bucket: 'bucket',
      path: 'images/',
      publicDomain: 'https://cos.example.com',
    };
    api.formData.value.aliyun = {
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      region: 'oss-cn-hangzhou',
      bucket: 'bucket',
      path: 'images/',
      publicDomain: 'https://oss.example.com',
    };
    api.formData.value.qiniu = {
      accessKey: 'ak',
      secretKey: 'sk',
      region: 'z0',
      bucket: 'bucket',
      path: 'images/',
      publicDomain: 'https://qiniu.example.com',
    };
    api.formData.value.upyun = {
      operator: 'operator',
      password: 'password',
      bucket: 'bucket',
      path: 'images/',
      publicDomain: 'https://upyun.example.com',
    };
    api.formData.value.weiboCookie = ' SUB=abc ';
    api.formData.value.zhihu.cookie = ' z_c0=abc ';
    api.formData.value.nowcoder.cookie = ' NOWCODER=abc ';
    api.formData.value.nami.cookie = ' nami=abc ';
    api.formData.value.bilibili.cookie = ' SESSDATA=abc ';
    api.formData.value.chaoxing.cookie = ' UID=abc ';
    api.formData.value.smms.token = ' token ';
    api.formData.value.github = {
      enabled: true,
      token: ' ghp_token ',
      owner: ' owner ',
      repo: ' repo ',
      branch: 'main',
      path: 'images/',
    };
    api.formData.value.imgur.clientId = ' imgur-client ';
    api.formData.value.custom_s3_profiles = [
      {
        id: 'complete',
        name: 'Complete S3',
        endpoint: 'https://s3.example.com',
        accessKeyId: 'ak',
        secretAccessKey: 'sk',
        region: 'auto',
        bucket: 'bucket',
        path: '',
        publicDomain: '',
      },
      {
        id: 'partial',
        name: 'Partial S3',
        endpoint: 'https://s3.example.com',
        accessKeyId: '',
        secretAccessKey: 'sk',
        region: 'auto',
        bucket: 'bucket',
        path: '',
        publicDomain: '',
      },
    ];

    expect(api.serviceConfigStatus.value).toMatchObject({
      tencent: true,
      aliyun: true,
      qiniu: true,
      upyun: true,
      weibo: true,
      zhihu: true,
      nowcoder: true,
      nami: true,
      bilibili: true,
      chaoxing: true,
      smms: true,
      github: true,
      imgur: true,
      [makeCustomS3Id('complete')]: true,
      [makeCustomS3Id('partial')]: false,
    });
  });

  it('extracts message from structured Tauri errors without stringifying JSON', () => {
    const api = useSettingsForm();

    expect(api.errorToString({
      type: 'AUTH',
      data: { message: 'Cookie 无效或已过期' },
    })).toBe('Cookie 无效或已过期');
  });

  it('loads legacy custom S3 settings, WebDAV passwords, link defaults, and autostart state', async () => {
    const api = useSettingsForm();
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_710_000_000_000);
    const mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    setupInvokeResponses({
      'plugin:autostart|is_enabled': true,
      decrypt_webdav_password: (args: unknown) => {
        const { encrypted } = args as { encrypted?: string };
        if (encrypted === 'bad-cipher') throw new Error('decrypt failed');
        return `plain:${String(encrypted)}`;
      },
      encrypt_webdav_password: (args: unknown) => {
        const { password } = args as { password?: string };
        return `encrypted:${String(password ?? '')}`;
      },
    });
    const config = createConfig({
      enabledServices: ['custom_s3'],
      availableServices: ['custom_s3'],
      services: {
        custom_s3: {
          endpoint: 'https://legacy-s3.example.com',
          accessKeyId: 'legacy-ak',
          secretAccessKey: 'legacy-sk',
          region: 'auto',
          bucket: 'legacy-bucket',
          path: 'legacy/',
          publicDomain: 'https://legacy.example.com',
        },
      } as unknown as UserConfig['services'],
      custom_s3_profiles: [],
      webdav: {
        profiles: [
          {
            id: 'dav-ok',
            name: 'OK',
            url: 'https://dav.example.com',
            username: 'me',
            password: '',
            passwordEncrypted: 'cipher',
            remotePath: '/PicNexus/',
          },
          {
            id: 'dav-bad',
            name: 'Bad',
            url: 'https://dav.example.com',
            username: 'me',
            password: '',
            passwordEncrypted: 'bad-cipher',
            remotePath: '/PicNexus/',
          },
        ],
        activeId: 'dav-ok',
      },
      linkPrefixConfig: {
        enabled: false,
        selectedIndex: 3,
        prefixList: [],
      },
      appBehavior: {
        autoStart: false,
        minimizeToTrayOnStart: true,
        closeToTray: undefined,
      } as unknown as UserConfig['appBehavior'],
      linkOutput: {
        defaultFormat: 'markdown',
        customTemplate: '![image]({url})',
        autoCopy: false,
      },
      publicServiceRiskAccepted: true,
    });
    mockState.configStoreGet.mockResolvedValue(config);

    await api.loadSettings();

    expect(api.formData.value.custom_s3_profiles).toHaveLength(1);
    const migratedProfile = api.formData.value.custom_s3_profiles[0];
    expect(migratedProfile).toMatchObject({
      endpoint: 'https://legacy-s3.example.com',
      accessKeyId: 'legacy-ak',
      bucket: 'legacy-bucket',
    });
    expect(api.availableServices.value).toEqual([makeCustomS3Id(migratedProfile.id)]);
    expect(api.formData.value.webdav.profiles).toMatchObject([
      { id: 'dav-ok', password: 'plain:cipher' },
      { id: 'dav-bad', password: '' },
    ]);
    expect(api.formData.value.webdav.activeId).toBe('dav-ok');
    expect(api.formData.value.linkPrefixEnabled).toBe(false);
    expect(api.formData.value.linkPrefixList.length).toBeGreaterThan(0);
    expect(api.formData.value.linkOutput.defaultFormat).toBe('markdown');
    expect(api.formData.value.publicServiceRiskAccepted).toBe(true);
    expect(api.formData.value.appBehavior.autoStart).toBe(true);
    expect(api.formData.value.appBehavior.closeToTray).toBe(true);
    expect(mockState.syncCustomS3Uploaders).toHaveBeenCalledWith([migratedProfile]);
    dateNowSpy.mockRestore();
    mathRandomSpy.mockRestore();
  });

  it('validates S3 field length, R2 account id, public domain, and valid configs', () => {
    const api = useSettingsForm();

    expect(api.validateS3Config('r2', {
      accountId: '',
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      bucketName: 'bucket',
      publicDomain: 'https://cdn.example.com',
    })).toContain('accountId');
    expect(api.validateS3Config('r2', {
      accountId: 'not-a-r2-account-id',
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      bucketName: 'bucket',
      publicDomain: 'https://cdn.example.com',
    })).toContain('Account ID');
    expect(api.validateS3Config('r2', {
      accountId: 'a'.repeat(32),
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      bucketName: 'bucket',
      publicDomain: 'cdn.example.com',
    })).toContain('http://');
    expect(api.validateS3Config('r2', r2Config())).toBeNull();
    expect(api.validateS3Config('jd', {})).toBeNull();
  });

  it('debounces saves with advanced status and can cancel pending work', async () => {
    vi.useFakeTimers();
    const api = useSettingsForm();
    mockState.configStoreGet.mockResolvedValue(createConfig({ availableServices: ['jd'] }));

    api.debouncedSaveSettingsWithStatus();
    api.debouncedSaveSettings();
    api.cancelDebouncedSave();
    await vi.advanceTimersByTimeAsync(500);
    expect(mockState.saveConfig).not.toHaveBeenCalled();

    api.debouncedSaveSettingsWithStatus();
    await vi.advanceTimersByTimeAsync(500);
    expect(mockState.saveConfig).toHaveBeenCalledTimes(1);
    expect(api.advancedSaveState.value.status).toBe('saved');

    await vi.advanceTimersByTimeAsync(1800);
    expect(api.advancedSaveState.value.status).toBe('idle');
  });

  it('keeps existing WebDAV encrypted password when encryption fails during save', async () => {
    const api = useSettingsForm();
    mockState.configStoreGet.mockResolvedValue(createConfig({ availableServices: ['jd'] }));
    setupInvokeResponses({
      'plugin:autostart|is_enabled': false,
      encrypt_webdav_password: new Error('encrypt failed'),
    });
    api.formData.value.webdav.profiles = [{
      id: 'dav-1',
      name: 'Main WebDAV',
      url: 'https://dav.example.com',
      username: 'me',
      password: 'new-secret',
      passwordEncrypted: 'old-cipher',
      remotePath: '/PicNexus/',
    }];

    await expect(api.saveSettings()).resolves.toBe(true);

    const savedConfig = mockState.saveConfig.mock.calls[0][0];
    expect(savedConfig.webdav.profiles[0]).toMatchObject({
      password: '',
      passwordEncrypted: 'old-cipher',
    });
  });

  it('manages link prefixes, custom S3 profiles, and WebDAV profiles without changing business logic', async () => {
    const api = useSettingsForm();
    mockState.configStoreGet.mockResolvedValue(createConfig({ availableServices: ['jd'] }));
    api.formData.value.linkPrefixList = [
      { name: 'A', template: 'https://a.example/{url}' },
      { name: 'B', template: 'https://b.example/{url}' },
      { name: 'C', template: 'https://c.example/{url}' },
    ];
    api.formData.value.selectedPrefixIndex = 2;

    api.updatePrefix(-1, { name: 'Ignored', template: '{url}' });
    expect(api.formData.value.linkPrefixList[0].name).toBe('A');

    api.updatePrefix(1, { name: 'B2', template: 'https://b2.example/{url}' });
    expect(api.formData.value.linkPrefixList[1].name).toBe('B2');

    api.removePrefix(0);
    expect(api.formData.value.selectedPrefixIndex).toBe(1);

    api.removePrefix(1);
    expect(api.formData.value.selectedPrefixIndex).toBe(0);
    expect(mockState.toastShowConfig).toHaveBeenCalledWith('info', expect.any(Object));

    api.removePrefix(0);
    expect(api.formData.value.linkPrefixList).toHaveLength(1);

    api.addPrefix({ name: 'D', template: 'https://d.example/{url}' });
    expect(api.formData.value.linkPrefixList.at(-1)?.name).toBe('D');

    api.resetToDefaultPrefixes();
    expect(api.formData.value.selectedPrefixIndex).toBe(0);
    expect(api.formData.value.linkPrefixList.length).toBeGreaterThan(1);

    api.formData.value.custom_s3_profiles = [{
      id: 'profile-1',
      name: 'Private S3',
      endpoint: 'https://s3.example.com',
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      region: 'auto',
      bucket: 'bucket',
      path: '',
      publicDomain: '',
    }];
    api.availableServices.value = ['jd', makeCustomS3Id('profile-1')];
    api.formData.value.editorServer.typoraService = makeCustomS3Id('profile-1');
    api.formData.value.editorServer.obsidianService = makeCustomS3Id('profile-1');

    mockState.confirm.mockResolvedValueOnce(false);
    await api.deleteCustomS3Profile('profile-1');
    expect(api.formData.value.custom_s3_profiles).toHaveLength(1);

    mockState.confirm.mockResolvedValueOnce(true);
    await api.deleteCustomS3Profile('profile-1');
    expect(api.formData.value.custom_s3_profiles).toEqual([]);
    expect(api.availableServices.value).toEqual(['jd']);
    expect(api.formData.value.editorServer.typoraService).toBe('');
    expect(api.formData.value.editorServer.obsidianService).toBe('');

    api.updateCustomS3Profile({
      id: 'missing',
      name: 'Missing',
      endpoint: '',
      accessKeyId: '',
      secretAccessKey: '',
      region: '',
      bucket: '',
      path: '',
      publicDomain: '',
    });
    expect(api.formData.value.custom_s3_profiles).toEqual([]);

    api.addCustomS3Profile();
    expect(api.formData.value.custom_s3_profiles).toHaveLength(1);

    const addedProfile = api.formData.value.custom_s3_profiles[0];
    api.updateCustomS3Profile({ ...addedProfile, name: 'Renamed S3' });
    expect(api.formData.value.custom_s3_profiles[0].name).toBe('Renamed S3');

    api.addWebDAVProfile();
    expect(api.formData.value.webdav.profiles).toHaveLength(1);
    const firstWebDAVId = api.formData.value.webdav.activeId!;

    api.addWebDAVProfile();
    const secondWebDAVId = api.formData.value.webdav.activeId!;
    expect(api.formData.value.webdav.profiles).toHaveLength(2);

    api.switchWebDAVProfile(firstWebDAVId);
    expect(api.formData.value.webdav.activeId).toBe(firstWebDAVId);

    mockState.confirm.mockResolvedValueOnce(false);
    await api.deleteWebDAVProfile(firstWebDAVId);
    expect(api.formData.value.webdav.profiles).toHaveLength(2);

    mockState.confirm.mockResolvedValueOnce(true);
    await api.deleteWebDAVProfile(firstWebDAVId);
    expect(api.formData.value.webdav.activeId).toBe(secondWebDAVId);

    mockState.confirm.mockResolvedValueOnce(true);
    await api.deleteWebDAVProfile(secondWebDAVId);
    expect(api.formData.value.webdav.activeId).toBeNull();
  });
});
