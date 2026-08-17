import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useEditorIntegration } from '@/composables/settings/useEditorIntegration';
import type { SettingsFormShape } from '@/composables/settings/settingsFormTypes';
import type { WebDAVStorageProfile } from '@/config/types';
import { DEFAULT_CONFIG } from '@/config/defaults';
import { secureStorage } from '@/security/crypto';
import { getInvokeMock, resetTauriMocks, setupInvokeResponses } from '../../helpers/tauriMock';

const showConfigMock = vi.hoisted(() => vi.fn());

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    showConfig: showConfigMock,
  }),
}));

vi.mock('@/security/crypto', () => ({
  secureStorage: {
    decrypt: vi.fn(async (cipher: string) => {
      const match = /^cipher\((.*)\)$/.exec(cipher);
      if (!match) throw new Error('bad cipher');
      return match[1];
    }),
  },
}));

function makeWebDAVProfile(overrides: Partial<WebDAVStorageProfile> = {}): WebDAVStorageProfile {
  return {
    id: 'profile-1',
    name: '我的 OpenList',
    url: 'https://dav.example.com/dav',
    username: 'user',
    passwordEncrypted: 'cipher(secret)',
    remotePath: '/images/',
    publicDomain: 'https://cdn.example.com',
    publicUrlTemplate: '{domain}/{path}',
    ...overrides,
  };
}

function makeForm(cliEnabled?: boolean, webdavProfiles: WebDAVStorageProfile[] = []): SettingsFormShape {
  return {
    weiboCookie: '',
    r2: {
      accountId: 'account',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      bucketName: 'bucket',
      path: 'images/',
      publicDomain: 'https://cdn.example.com',
    },
    tencent: { secretId: '', secretKey: '', region: '', bucket: '', path: '', publicDomain: '' },
    aliyun: { accessKeyId: '', accessKeySecret: '', region: '', bucket: '', path: '', publicDomain: '' },
    qiniu: { accessKey: '', secretKey: '', region: '', bucket: '', publicDomain: '', path: '' },
    upyun: { operator: '', password: '', bucket: '', publicDomain: '', path: '' },
    custom_s3_profiles: [],
    webdav_profiles: webdavProfiles,
    nowcoder: { cookie: '' },
    zhihu: { cookie: '', sourceParamEnabled: true, sourceParamValue: '' },
    nami: { cookie: '', authToken: '' },
    bilibili: { cookie: '' },
    chaoxing: { cookie: '' },
    smms: { token: 'smms-token' },
    github: {
      enabled: false,
      token: '',
      owner: '',
      repo: '',
      branch: 'main',
      path: 'images/',
      cdnConfig: structuredClone(DEFAULT_CONFIG.services.github?.cdnConfig),
    },
    imgur: { clientId: '', clientSecret: '' },
    editorServer: {
      ...DEFAULT_CONFIG.editorServer!,
      cliEnabled,
    },
  };
}

describe('useEditorIntegration', () => {
  beforeEach(() => {
    resetTauriMocks();
    setupInvokeResponses({
      update_server_config: undefined,
      save_cli_config: undefined,
    });
    showConfigMock.mockClear();
    vi.mocked(secureStorage.decrypt).mockClear();
  });

  it('does not export CLI services when cliEnabled is missing', async () => {
    const formData = ref(makeForm(undefined));
    const { applyEditorServer } = useEditorIntegration({
      formData,
      isSettingsReady: ref(true),
      errorToString: (error) => String(error),
    });

    await applyEditorServer(formData.value.editorServer, { force: true });

    expect(getInvokeMock()).toHaveBeenCalledWith('save_cli_config', {
      serviceConfigJson: null,
      servicesConfigJson: null,
    });
  });

  it('exports CLI services only when cliEnabled is true', async () => {
    const formData = ref(makeForm(true));
    const { applyEditorServer } = useEditorIntegration({
      formData,
      isSettingsReady: ref(true),
      errorToString: (error) => String(error),
    });

    await applyEditorServer(formData.value.editorServer, { force: true });

    expect(getInvokeMock()).toHaveBeenCalledWith('save_cli_config', {
      serviceConfigJson: null,
      servicesConfigJson: expect.stringContaining('"smms"'),
    });
  });

  it('decrypts a configured WebDAV profile and exports its plaintext password to the CLI config', async () => {
    const formData = ref(makeForm(true, [makeWebDAVProfile()]));
    const { applyEditorServer } = useEditorIntegration({
      formData,
      isSettingsReady: ref(true),
      errorToString: (error) => String(error),
    });

    await applyEditorServer(formData.value.editorServer, { force: true });

    expect(secureStorage.decrypt).toHaveBeenCalledWith('cipher(secret)');
    expect(getInvokeMock()).toHaveBeenCalledWith('save_cli_config', {
      serviceConfigJson: null,
      servicesConfigJson: expect.stringContaining('"password":"secret"'),
    });
  });

  it('surfaces a toast and returns false when WebDAV password decryption fails', async () => {
    vi.mocked(secureStorage.decrypt).mockRejectedValueOnce(new Error('key mismatch'));
    const formData = ref(makeForm(true, [makeWebDAVProfile()]));
    const { applyEditorServer } = useEditorIntegration({
      formData,
      isSettingsReady: ref(true),
      errorToString: (error) => String(error),
    });

    const result = await applyEditorServer(formData.value.editorServer, { force: true });

    expect(result).toBe(false);
    expect(showConfigMock).toHaveBeenCalledWith('error', expect.objectContaining({ summary: '编辑器服务启动失败' }));
  });

  it('does not decrypt (or block on) a WebDAV password for a service that is being disabled', async () => {
    // 回归用例：obsidianService/typoraService 选的是 WebDAV，但对应开关是 false
    // （用户正要关掉这个服务）。就算密文解不开，也不该挡住"关掉服务"这个操作本身。
    vi.mocked(secureStorage.decrypt).mockRejectedValue(new Error('key mismatch'));
    const formData = ref(makeForm(false, [makeWebDAVProfile()]));
    formData.value.editorServer = {
      ...formData.value.editorServer,
      enabled: false,
      typoraEnabled: false,
      obsidianService: 'webdav:profile-1',
      typoraService: 'webdav:profile-1',
    };
    const { applyEditorServer } = useEditorIntegration({
      formData,
      isSettingsReady: ref(true),
      errorToString: (error) => String(error),
    });

    const result = await applyEditorServer(formData.value.editorServer, { force: true });

    expect(result).toBe(true);
    expect(secureStorage.decrypt).not.toHaveBeenCalled();
    expect(getInvokeMock()).toHaveBeenCalledWith('update_server_config', expect.objectContaining({ enabled: false }));
  });

  it('warns the user once when cli-config.json had to fall back to plaintext', async () => {
    // 钥匙串不可用时 Rust 侧会退回明文落盘。Electron safeStorage 在 Linux 上就是
    // 悄悄降级、用户毫不知情——这条用例守住"降级必须是响的"。
    setupInvokeResponses({
      update_server_config: undefined,
      save_cli_config: { encrypted: false },
    });
    const formData = ref(makeForm(true));
    const { applyEditorServer } = useEditorIntegration({
      formData,
      isSettingsReady: ref(true),
      errorToString: (error) => String(error),
    });

    await applyEditorServer(formData.value.editorServer, { force: true });

    expect(showConfigMock).toHaveBeenCalledWith('warn', expect.objectContaining({ summary: '编辑器配置未能加密' }));

    // 每次改设置都会重跑 applyEditorServer，逐次弹窗会变成噪音
    showConfigMock.mockClear();
    await applyEditorServer(formData.value.editorServer, { force: true });
    expect(showConfigMock).not.toHaveBeenCalled();
  });

  it('stays quiet when cli-config.json was written encrypted', async () => {
    setupInvokeResponses({
      update_server_config: undefined,
      save_cli_config: { encrypted: true },
    });
    const formData = ref(makeForm(true));
    const { applyEditorServer } = useEditorIntegration({
      formData,
      isSettingsReady: ref(true),
      errorToString: (error) => String(error),
    });

    await applyEditorServer(formData.value.editorServer, { force: true });

    expect(showConfigMock).not.toHaveBeenCalled();
  });
});
