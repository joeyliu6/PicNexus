import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { useSettingsForm } from '@/composables/settings/useSettingsForm';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';
import { createConfig } from '../../factories/configFactory';
import { resetTauriMocks, setupInvokeResponses } from '../../helpers/tauriMock';

const mockState = vi.hoisted(() => ({
  configStoreGet: vi.fn(),
  saveConfig: vi.fn(),
  toastShowConfig: vi.fn(),
  confirm: vi.fn(),
  loadHealthStatus: vi.fn(),
  evaluateConfig: vi.fn(),
  syncCustomS3Uploaders: vi.fn(),
  syncWebDAVUploaders: vi.fn(),
}));

// WebDAV 备份密码的加解密。
//
// ⚠️ 这里 mock 的必须是**真实存在**的模块导出。此前 spec 用 setupInvokeResponses
// 伪造了 `encrypt_webdav_password` / `decrypt_webdav_password` 两个 Tauri 命令，
// 而它们在 Rust 侧从未实现——测试自己发明了一个后端，于是单测全绿、生产每次
// 保存都把备份密码静默清空。mock 只能替换真实依赖，不能凭空发明一个。
vi.mock('@/utils/webdav', () => ({
  WebDAVClient: {
    encryptPassword: vi.fn(async (password: string) => `encrypted:${password}`),
    decryptPassword: vi.fn(async (encrypted: string) => {
      if (encrypted === 'bad-cipher') throw new Error('decrypt failed');
      return `plain:${encrypted}`;
    }),
  },
}));

vi.mock('@/store/instances', () => ({
  configStore: {
    get: mockState.configStoreGet,
  },
}));

vi.mock('@/composables/useConfig', () => ({
  useConfigManager: () => ({
    saveConfig: mockState.saveConfig,
  }),
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    showConfig: mockState.toastShowConfig,
  }),
}));

vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({
    confirm: mockState.confirm,
  }),
}));

vi.mock('@/composables/service/useServiceHealth', () => ({
  useServiceHealth: () => ({
    loadHealthStatus: mockState.loadHealthStatus,
    evaluateConfig: mockState.evaluateConfig,
  }),
}));

vi.mock('@/uploaders', () => ({
  syncCustomS3Uploaders: mockState.syncCustomS3Uploaders,
  syncWebDAVUploaders: mockState.syncWebDAVUploaders,
}));

vi.mock('@/utils/logger', () => ({
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
    });
    mockState.saveConfig.mockResolvedValue(undefined);
    mockState.confirm.mockResolvedValue(true);
    mockState.loadHealthStatus.mockResolvedValue(undefined);
  });

  it('saves its own settings and never writes host config (the 图床 page owns it)', async () => {
    const api = useSettingsForm();
    const onDisk = createConfig({
      availableServices: ['jd', 'r2'],
      enabledServices: ['r2'],
      publicServiceRiskAccepted: true,
      services: { ...DEFAULT_CONFIG.services, r2: r2Config(), weibo: { enabled: true, cookie: 'SUB=fresh' } } as UserConfig['services'],
      custom_s3_profiles: [{ id: 'p1', name: 'MinIO', endpoint: 'https://s3.example.com', accessKeyId: 'a', secretAccessKey: 's', region: 'r', bucket: 'b', path: '', publicDomain: '' }],
      linkPrefixConfig: { enabled: false, selectedIndex: 0, prefixList: [] },
    });
    mockState.configStoreGet.mockResolvedValue(onDisk);

    api.formData.value.webdav.profiles = [{
      id: 'dav-1',
      name: 'Main WebDAV',
      url: 'https://dav.example.com',
      username: 'me',
      password: 'secret',
      remotePath: '/PicNexus/',
    }];
    api.formData.value.webdav.activeId = 'dav-1';
    api.formData.value.analyticsEnabled = false;

    await expect(api.saveSettings({ trackAdvancedStatus: true })).resolves.toBe(true);

    const savedConfig = mockState.saveConfig.mock.calls[0][0];
    expect(savedConfig.analytics).toEqual({ enabled: false });
    expect(savedConfig.webdav.profiles[0]).toMatchObject({ id: 'dav-1', password: '', passwordEncrypted: 'encrypted:secret' });
    // 图床页刚改过的东西原样留着：设置页开着也不会用旧值把它们盖掉
    expect(savedConfig.services.weibo.cookie).toBe('SUB=fresh');
    expect(savedConfig.services.r2).toEqual(r2Config());
    expect(savedConfig.availableServices).toEqual(['jd', 'r2']);
    expect(savedConfig.enabledServices).toEqual(['r2']);
    expect(savedConfig.publicServiceRiskAccepted).toBe(true);
    expect(savedConfig.custom_s3_profiles).toEqual(onDisk.custom_s3_profiles);
    expect(savedConfig.linkPrefixConfig).toEqual(onDisk.linkPrefixConfig);
    expect(api.advancedSaveState.value.status).toBe('saved');
    api.clearTimers();
  });

  // "保存失败后回滚到磁盘真值"的用例曾经放在这里，但这个文件把 configStore mock 成
  // "每次 get() 返回一个新对象"（见上面 vi.mock('@/store/instances', ...)），这个 mock 方式
  // 恰好把 P1-1 那个"get() 返回缓存对象本身，就地改写会污染缓存"的别名 bug 遮住了——用两个不同
  // 对象模拟"保存前"和"回滚后"，测的是虚构场景，不是真实 Store 行为。真正暴露别名关系需要接一个
  // 真实 Store 实例，这类用例现在统一放在 tests/unit/services/storeAliasing.spec.ts
  // （P1-1 回归：useSettingsForm 保存失败后正确回滚到磁盘真值），别再在这个文件里补。

  it('restores DEFAULT_CONFIG without clearing history or cache state', async () => {
    const api = useSettingsForm();
    api.formData.value.webdav.profiles = [{
      id: 'dav-1',
      name: 'Main WebDAV',
      url: 'https://dav.example.com',
      username: 'me',
      password: 'secret',
      remotePath: '/PicNexus/',
    }];
    api.formData.value.analyticsEnabled = false;

    await expect(api.resetToDefaultSettings()).resolves.toBe(true);

    expect(mockState.saveConfig).toHaveBeenCalledTimes(1);
    const savedConfig = mockState.saveConfig.mock.calls[0][0];
    expect(savedConfig).toMatchObject({ ...DEFAULT_CONFIG, onboardingCompleted: false });
    expect(api.formData.value.webdav).toEqual({ profiles: [], activeId: null });
    expect(api.formData.value.analyticsEnabled).toBe(DEFAULT_CONFIG.analytics?.enabled ?? true);
    expect(api.formData.value.globalShortcut).toEqual(DEFAULT_CONFIG.globalShortcut);
    // 多份图床随默认设置清空，上传器跟着重建
    expect(mockState.syncCustomS3Uploaders).toHaveBeenLastCalledWith([]);
    expect(mockState.syncWebDAVUploaders).toHaveBeenLastCalledWith([]);
  });

  /**
   * 又拍云是唯一一个「两条链路两套凭证」的图床。只填操作员账号密码时编辑器链路能用，
   * 但 GUI 上传必然失败——设置页此时**不能**显示「已配置」，否则又回到「看着正常、
   * 一传就报 ErrInvalidAccessKeyID」那个形态。运行时口径见 SERVICE_REQUIRED_FIELDS.upyun。
   */
  it('extracts message from structured Tauri errors without stringifying JSON', () => {
    const api = useSettingsForm();

    expect(api.errorToString({
      type: 'AUTH',
      data: { message: 'Cookie 无效或已过期' },
    })).toBe('Cookie 无效或已过期');
  });

  /**
   * 换钥匙之后 formData 里的密文必须换新
   *
   * 缺了这一步，磁盘上是新密文、内存里是旧密文：点眼睛解不开，
   * 而且下一次保存会把旧密文写回去，把搬运成果覆盖掉——比解不开更严重。
   */
  it('refreshes the ciphertext copies in formData after a key swap', async () => {
    const api = useSettingsForm();

    // 带真前缀：合并判定走的是 isAnyEncryptedData，跟 fieldSecrets 决定"搬哪些"是同一套。
    // 换个随便的字符串就等于绕开了这套判定，测不到真实行为
    const OLD = 'PNXENC:old-cipher';
    const NEW = 'PNXENC:new-cipher';

    mockState.configStoreGet.mockResolvedValue(createConfig({
      webdav_profiles: [
        { id: 'dav-1', name: 'NAS', url: 'https://dav.example.com', username: 'me', passwordEncrypted: OLD, remotePath: '/pics/', publicDomain: 'https://cdn.example.com', publicUrlTemplate: '{domain}/{path}' },
      ],
      webdav: {
        profiles: [{ id: 'bak-1', name: '坚果云', url: 'https://dav.example.com', username: 'me', password: '', passwordEncrypted: OLD, remotePath: '/PicNexus/' }],
        activeId: 'bak-1',
      },
    }));
    await api.loadSettings();
    expect(api.formData.value.webdav.profiles[0].passwordEncrypted).toBe(OLD);

    // 换钥匙：swapKeyAndReencrypt 已经把新密文写进 store，formData 还没跟上
    mockState.configStoreGet.mockResolvedValue(createConfig({
      webdav_profiles: [
        { id: 'dav-1', name: 'NAS', url: 'https://dav.example.com', username: 'me', passwordEncrypted: NEW, remotePath: '/pics/', publicDomain: 'https://cdn.example.com', publicUrlTemplate: '{domain}/{path}' },
      ],
      webdav: {
        profiles: [{ id: 'bak-1', name: '坚果云', url: 'https://dav.example.com', username: 'me', password: '', passwordEncrypted: NEW, remotePath: '/PicNexus/' }],
        activeId: 'bak-1',
      },
    }));

    await api.reloadFieldSecrets();

    expect(api.formData.value.webdav.profiles[0].passwordEncrypted).toBe(NEW);
    expect(api.formData.value.webdav.activeId).toBe('bak-1');
  });

  /**
   * 换备份密码时设置页是开着的，旁边就是这些输入框。整数组替换会把用户
   * 正在填的内容冲回磁盘旧值——躲开了 loadSettings，却在这儿犯同一个错。
   */
  it('keeps unsaved profile edits when merging the rekeyed ciphertext', async () => {
    const api = useSettingsForm();

    mockState.configStoreGet.mockResolvedValue(createConfig({
      webdav_profiles: [
        { id: 'dav-1', name: 'NAS', url: 'https://dav.example.com', username: 'me', passwordEncrypted: 'PNXENC:old', remotePath: '/pics/', publicDomain: 'https://cdn.example.com', publicUrlTemplate: '{domain}/{path}' },
      ],
      webdav: {
        profiles: [{ id: 'bak-1', name: '坚果云', url: 'https://dav.example.com', username: 'me', password: '', passwordEncrypted: 'PNXENC:old', remotePath: '/PicNexus/' }],
        activeId: 'bak-1',
      },
    }));
    await api.loadSettings();

    // 用户正在改，还没保存
    api.formData.value.webdav.profiles[0].name = '公司 NAS';
    api.formData.value.webdav.profiles[0].url = 'https://nas.local/dav';
    // 而且新建了一份磁盘上还没有的配置
    api.formData.value.webdav.profiles.push({
      id: 'bak-new', name: '新配置 1', url: '', username: '', password: '', remotePath: '/PicNexus/',
    });

    mockState.configStoreGet.mockResolvedValue(createConfig({
      webdav_profiles: [
        { id: 'dav-1', name: 'NAS', url: 'https://dav.example.com', username: 'me', passwordEncrypted: 'PNXENC:new', remotePath: '/pics/', publicDomain: 'https://cdn.example.com', publicUrlTemplate: '{domain}/{path}' },
      ],
      webdav: {
        profiles: [{ id: 'bak-1', name: '坚果云', url: 'https://dav.example.com', username: 'me', password: '', passwordEncrypted: 'PNXENC:new', remotePath: '/PicNexus/' }],
        activeId: 'bak-1',
      },
    }));

    await api.reloadFieldSecrets();

    // 密文换新了
    expect(api.formData.value.webdav.profiles[0].passwordEncrypted).toBe('PNXENC:new');
    // 没保存的编辑一个都不能丢
    expect(api.formData.value.webdav.profiles[0].name).toBe('公司 NAS');
    expect(api.formData.value.webdav.profiles[0].url).toBe('https://nas.local/dav');
    expect(api.formData.value.webdav.profiles).toHaveLength(2);
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

  // 加密失败时**保留明文**，不能清空。
  //
  // 这条断言原本写的是 `password: ''` + 保留旧密文——只有"已有旧密文"时才成立。
  // 首次配置没有旧密文，清空明文就等于把密码彻底弄丢，而保存仍然返回 true、
  // 界面提示"保存成功"。用户实际踩的就是这个：填完坚果云密码、测试通过、
  // 保存成功，重启后密码没了。
  //
  // 退化成明文是可控的：fromEncryptedConfig 有明文兜底分支，且 .settings.dat
  // 整体 PNXENC 加密。「明文躺在加密文件里」远好过「密码没了」。
  it('keeps the plaintext password when encryption fails during save', async () => {
    const { WebDAVClient } = await import('@/utils/webdav');
    vi.mocked(WebDAVClient.encryptPassword).mockRejectedValueOnce(new Error('encrypt failed'));

    const api = useSettingsForm();
    mockState.configStoreGet.mockResolvedValue(createConfig({ availableServices: ['jd'] }));
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
      password: 'new-secret',
      passwordEncrypted: 'old-cipher',
    });
  });

  // 首次配置（没有任何旧密文）时加密失败——这正是丢数据的场景
  it('does not lose a first-time password when encryption fails', async () => {
    const { WebDAVClient } = await import('@/utils/webdav');
    vi.mocked(WebDAVClient.encryptPassword).mockRejectedValueOnce(new Error('encrypt failed'));

    const api = useSettingsForm();
    mockState.configStoreGet.mockResolvedValue(createConfig({ availableServices: ['jd'] }));
    api.formData.value.webdav.profiles = [{
      id: 'dav-1',
      name: '坚果云',
      url: 'https://dav.jianguoyun.com/dav/',
      username: 'me',
      password: 'first-secret',
      remotePath: '/PicNexus/',
    }];

    await expect(api.saveSettings()).resolves.toBe(true);

    const saved = mockState.saveConfig.mock.calls[0][0].webdav.profiles[0];
    // 明文与密文不能同时为空——那就是密码彻底没了
    expect(saved.password || saved.passwordEncrypted).toBeTruthy();
    expect(saved.password).toBe('first-secret');
  });

  it('encrypts the password and clears the plaintext on a normal save', async () => {
    const api = useSettingsForm();
    mockState.configStoreGet.mockResolvedValue(createConfig({ availableServices: ['jd'] }));
    api.formData.value.webdav.profiles = [{
      id: 'dav-1',
      name: '坚果云',
      url: 'https://dav.jianguoyun.com/dav/',
      username: 'me',
      password: 'first-secret',
      remotePath: '/PicNexus/',
    }];

    await expect(api.saveSettings()).resolves.toBe(true);

    expect(mockState.saveConfig.mock.calls[0][0].webdav.profiles[0]).toMatchObject({
      password: '',
      passwordEncrypted: 'encrypted:first-secret',
    });
  });

});
