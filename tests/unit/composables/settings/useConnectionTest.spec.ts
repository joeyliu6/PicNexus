import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref, nextTick } from 'vue';
import { useConnectionTest } from '@/composables/settings/useConnectionTest';
import { __resetServiceCheckRunnerForTests } from '@/composables/useServiceCheckRunner';
import type { SettingsFormShape } from '@/composables/settings/settingsFormTypes';
import type { ServiceType, WebDAVStorageProfile } from '@/config/types';
import { resetTauriMocks, setupInvokeHandler } from '../../helpers/tauriMock';
import { flushPromisesAndTicks } from '../../helpers/wait';

const mockState = vi.hoisted(() => ({
  toastShowConfig: vi.fn(),
  suppressToasts: vi.fn(),
  healthStatusMap: { value: {} as Record<string, string> },
  markVerified: vi.fn(),
  markTestFailed: vi.fn(),
  qiyuAvailable: { value: false },
  jdAvailable: { value: true },
  isCheckingQiyu: { value: false },
  isCheckingJd: { value: false },
  probeBuiltinServiceAvailability: vi.fn(),
  // 默认拒绝：逃生舱确认框必须是用户主动点的，不能因为夹具默认值就被静默放行
  confirmDialog: vi.fn(async () => false),
  webdavTestConnection: vi.fn(),
}));

// useConnectionTest 里直接调 useConfirm()，而 PrimeVue 的 inject 在组件上下文之外拿不到
vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: mockState.confirmDialog }),
}));

vi.mock('@/uploaders/webdav/WebDAVUploader', () => ({
  WebDAVUploader: class {
    testConnection = mockState.webdavTestConnection;
  },
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    showConfig: mockState.toastShowConfig,
  }),
  suppressToasts: mockState.suppressToasts,
}));

vi.mock('@/composables/useServiceHealth', () => ({
  useServiceHealth: () => ({
    healthStatusMap: mockState.healthStatusMap,
    markVerified: mockState.markVerified,
    markTestFailed: mockState.markTestFailed,
  }),
}));

vi.mock('@/composables/useServiceAvailability', () => ({
  useServiceAvailability: () => ({
    qiyuAvailable: mockState.qiyuAvailable,
    jdAvailable: mockState.jdAvailable,
    isCheckingQiyu: mockState.isCheckingQiyu,
    isCheckingJd: mockState.isCheckingJd,
  }),
  probeBuiltinServiceAvailability: mockState.probeBuiltinServiceAvailability,
}));

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeFormData(): SettingsFormShape {
  return {
    weiboCookie: 'SUB=weibo',
    r2: {
      accountId: 'a'.repeat(32),
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      bucketName: 'bucket',
      path: 'images/',
      publicDomain: 'https://cdn.example.com',
    },
    tencent: { secretId: '', secretKey: '', region: '', bucket: '', path: '', publicDomain: '' },
    aliyun: { accessKeyId: '', accessKeySecret: '', region: '', bucket: '', path: '', publicDomain: '' },
    qiniu: { accessKey: '', secretKey: '', region: '', bucket: '', publicDomain: '', path: '' },
    upyun: { operator: '', password: '', bucket: '', publicDomain: '', path: '' },
    custom_s3_profiles: [{
      id: 'custom-1',
      name: 'Private S3',
      endpoint: 'https://s3.example.com',
      accessKeyId: 'custom-ak',
      secretAccessKey: 'custom-sk',
      region: 'auto',
      bucket: 'private',
      path: '',
      publicDomain: 'https://assets.example.com',
    }],
    nowcoder: { cookie: 'NOWCODER=1' },
    zhihu: { cookie: 'z_c0=zhihu', sourceParamEnabled: true, sourceParamValue: '172ae18b' },
    nami: { cookie: 'foo=1; Auth-Token=NAMI123; bar=2', authToken: '' },
    bilibili: { cookie: 'SESSDATA=abc; bili_jct=def' },
    chaoxing: { cookie: '_uid=1' },
    smms: { token: 'smms-token' },
    github: { enabled: true, token: 'ghp_test', owner: 'owner', repo: 'repo', branch: 'main', path: 'images/' },
    imgur: { clientId: 'imgur-client', clientSecret: '' },
    webdav_profiles: [{
      id: 'webdav-1',
      name: '家里的 NAS',
      url: 'http://nas.local:5005/dav',
      username: 'admin',
      passwordEncrypted: 'PNXENC:cipher',
      remotePath: 'images/',
      publicDomain: 'http://nas.local:5005/dav',
      publicUrlTemplate: '{domain}/{path}',
    }],
    editorServer: {
      enabled: false,
      port: 0,
      typoraEnabled: false,
      cliEnabled: true,
      typoraService: null,
      obsidianService: null,
    },
  };
}

const serviceNames = {
  r2: 'R2',
  smms: 'SM.MS',
  github: 'GitHub',
  imgur: 'Imgur',
  weibo: 'Weibo',
  zhihu: 'Zhihu',
  nowcoder: 'Nowcoder',
  nami: 'Nami',
  bilibili: 'Bilibili',
  chaoxing: 'Chaoxing',
  jd: 'JD',
  qiyu: 'Qiyu',
  tencent: 'Tencent',
  aliyun: 'Aliyun',
  qiniu: 'Qiniu',
  upyun: 'Upyun',
} satisfies Record<ServiceType, string>;

function createHarness(options: {
  validateS3Config?: (serviceId: string, config: Record<string, unknown>) => string | null;
} = {}) {
  const formData = ref(makeFormData());
  const validateS3Config = vi.fn<(serviceId: string, config: Record<string, unknown>) => string | null>(
    options.validateS3Config ?? (() => null),
  );
  const errorToString = vi.fn((error: unknown) => error instanceof Error ? error.message : String(error));
  const updateWebdavProfile = vi.fn((profile: WebDAVStorageProfile) => {
    const idx = formData.value.webdav_profiles.findIndex(p => p.id === profile.id);
    if (idx !== -1) formData.value.webdav_profiles[idx] = { ...profile };
  });
  const api = useConnectionTest({
    formData,
    serviceNames,
    errorToString,
    validateS3Config,
    updateWebdavProfile,
  });

  return { api, formData, validateS3Config, errorToString, updateWebdavProfile };
}

describe('useConnectionTest', () => {
  beforeEach(() => {
    resetTauriMocks();
    __resetServiceCheckRunnerForTests();
    vi.clearAllMocks();
    mockState.healthStatusMap.value = {
      r2: 'pending',
      smms: 'pending',
      weibo: 'pending',
      nami: 'pending',
      jd: 'pending',
      qiyu: 'unconfigured',
    };
    mockState.jdAvailable.value = true;
    mockState.qiyuAvailable.value = false;
    mockState.markVerified.mockImplementation((serviceId: string) => {
      mockState.healthStatusMap.value = { ...mockState.healthStatusMap.value, [serviceId]: 'verified' };
    });
    mockState.markTestFailed.mockImplementation((serviceId: string) => {
      mockState.healthStatusMap.value = { ...mockState.healthStatusMap.value, [serviceId]: 'error' };
    });
    mockState.probeBuiltinServiceAvailability.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  it('tests private S3 through Tauri and exposes single-check loading state', async () => {
    const pending = deferred<void>();
    setupInvokeHandler((command, args) => {
      if (command === 'test_s3_connection') {
        expect(args).toMatchObject({
          serviceId: 'r2',
          config: expect.objectContaining({ bucketName: 'bucket' }),
        });
        return pending.promise;
      }
      return undefined;
    });

    const { api } = createHarness();
    const check = api.handleServiceTest('r2');
    await flushPromisesAndTicks();

    expect(api.testingConnections.value.r2).toBe(true);
    expect(api.activeSession.value?.mode).toBe('single');

    pending.resolve();
    await check;
    await nextTick();

    expect(api.testingConnections.value.r2).toBe(false);
    expect(api.activeSession.value).toBeNull();
    expect(mockState.markVerified).toHaveBeenCalledWith('r2');
  });

  it('marks S3 validation errors without invoking the private connection command', async () => {
    const { api } = createHarness({
      validateS3Config: () => 'missing bucket',
    });
    setupInvokeHandler(() => {
      throw new Error('should not invoke');
    });

    await api.handleServiceTest('r2');

    expect(mockState.markTestFailed).toHaveBeenCalledWith('r2', 'missing bucket');
    expect(mockState.toastShowConfig).toHaveBeenCalledWith('error', expect.any(Object));
  });

  it('routes token and cookie checks with extracted Nami token', async () => {
    const seenCommands: Array<{ command: string; args: unknown }> = [];
    setupInvokeHandler((command, args) => {
      seenCommands.push({ command, args });
      return undefined;
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({ ok: true } as Response);

    const { api } = createHarness();

    await api.handleServiceTest('smms');
    await api.handleServiceTest('weibo');
    await api.handleServiceTest('nami');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sm.ms/api/v2/upload',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'smms-token' },
      }),
    );
    expect(seenCommands).toEqual(expect.arrayContaining([
      { command: 'test_weibo_connection', args: { weiboCookie: 'SUB=weibo' } },
      { command: 'test_nami_connection', args: { cookie: 'foo=1; Auth-Token=NAMI123; bar=2', authToken: 'NAMI123' } },
    ]));
    expect(mockState.markVerified).toHaveBeenCalledWith('smms');
    expect(mockState.markVerified).toHaveBeenCalledWith('weibo');
    expect(mockState.markVerified).toHaveBeenCalledWith('nami');
  });

  it('routes remaining single-service checks through their concrete runners', async () => {
    const seenCommands: Array<{ command: string; args: unknown }> = [];
    setupInvokeHandler((command, args) => {
      seenCommands.push({ command, args });
      return undefined;
    });
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
    mockState.healthStatusMap.value = {
      tencent: 'pending',
      aliyun: 'pending',
      qiniu: 'pending',
      upyun: 'pending',
      imgur: 'pending',
      zhihu: 'pending',
      nowcoder: 'pending',
      bilibili: 'pending',
      chaoxing: 'pending',
      qiyu: 'pending',
      'custom_s3:custom-1': 'pending',
    };

    const { api, validateS3Config } = createHarness();

    await api.handleServiceTest('github');
    await api.handleServiceTest('imgur');
    await api.handleServiceTest('tencent');
    await api.handleServiceTest('aliyun');
    await api.handleServiceTest('qiniu');
    await api.handleServiceTest('upyun');
    await api.handleServiceTest('zhihu');
    await api.handleServiceTest('nowcoder');
    await api.handleServiceTest('bilibili');
    await api.handleServiceTest('chaoxing');
    await api.handleServiceTest('qiyu');
    await api.handleServiceTest('custom_s3:custom-1');

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'token ghp_test' }),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://api.imgur.com/3/account/albums',
      expect.objectContaining({
        headers: { Authorization: 'Client-ID imgur-client' },
      }),
    );
    expect(seenCommands).toEqual(expect.arrayContaining([
      { command: 'test_zhihu_connection', args: { zhihuCookie: 'z_c0=zhihu' } },
      { command: 'test_nowcoder_cookie', args: { nowcoderCookie: 'NOWCODER=1' } },
      { command: 'test_bilibili_connection', args: { bilibiliCookie: 'SESSDATA=abc; bili_jct=def' } },
      { command: 'test_chaoxing_connection', args: { chaoxingCookie: '_uid=1' } },
    ]));
    expect(seenCommands.filter(({ command }) => command === 'test_s3_connection')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ args: expect.objectContaining({ serviceId: 'tencent' }) }),
        expect.objectContaining({ args: expect.objectContaining({ serviceId: 'aliyun' }) }),
        expect.objectContaining({ args: expect.objectContaining({ serviceId: 'qiniu' }) }),
        expect.objectContaining({ args: expect.objectContaining({ serviceId: 'upyun' }) }),
        expect.objectContaining({
          args: expect.objectContaining({
            serviceId: 'custom_s3:custom-1',
            config: expect.objectContaining({ bucket: 'private' }),
          }),
        }),
      ]),
    );
    expect(validateS3Config).toHaveBeenCalledWith(
      'custom_s3:custom-1',
      expect.objectContaining({ id: 'custom-1' }),
    );
    expect(mockState.probeBuiltinServiceAvailability).toHaveBeenCalledWith('qiyu', true);
    expect(mockState.markVerified).toHaveBeenCalledWith('github');
    expect(mockState.markVerified).toHaveBeenCalledWith('custom_s3:custom-1');
  });

  it('records failed fetch, S3, and cookie checks without leaking rejections', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: false } as Response);
    setupInvokeHandler((command) => {
      if (command === 'test_s3_connection') throw new Error('storage offline');
      if (command === 'test_zhihu_connection') throw new Error('cookie expired');
      return undefined;
    });

    const { api, errorToString } = createHarness();

    await api.handleServiceTest('smms');
    await api.handleServiceTest('github');
    await api.handleServiceTest('r2');
    await api.handleServiceTest('zhihu');

    expect(mockState.markTestFailed).toHaveBeenCalledWith('smms', expect.stringContaining('Token'));
    expect(mockState.markTestFailed).toHaveBeenCalledWith('github', expect.any(String));
    expect(mockState.markTestFailed).toHaveBeenCalledWith('r2', 'storage offline');
    expect(mockState.markTestFailed).toHaveBeenCalledWith('zhihu', 'cookie expired');
    expect(errorToString).toHaveBeenCalledWith(expect.objectContaining({ message: 'storage offline' }));
    expect(mockState.toastShowConfig).toHaveBeenCalledWith('error', expect.any(Object));
  });

  it('skips unknown services and reports missing custom S3 profiles during prevalidation', async () => {
    setupInvokeHandler(() => {
      throw new Error('should not invoke');
    });
    mockState.healthStatusMap.value = {
      'custom_s3:missing': 'pending',
    };

    const { api } = createHarness();

    await api.handleServiceTest('not-configured');
    await api.handleBuiltinCheck('weibo');
    await api.handleServiceTest('custom_s3:missing');

    expect(mockState.probeBuiltinServiceAvailability).not.toHaveBeenCalled();
    expect(mockState.markTestFailed).toHaveBeenCalledWith(
      'custom_s3:missing',
      expect.stringContaining('S3'),
    );
    expect(mockState.toastShowConfig).toHaveBeenCalledWith('error', expect.any(Object));
  });

  it('runs builtin checks and reports the cached availability result', async () => {
    const { api } = createHarness();

    await api.handleBuiltinCheck('jd');

    expect(mockState.probeBuiltinServiceAvailability).toHaveBeenCalledWith('jd', true);
    expect(mockState.toastShowConfig).toHaveBeenCalledWith('info', expect.any(Object));
  });

  it('reports unavailable builtin checks from the cached availability result', async () => {
    const { api } = createHarness();

    await api.handleBuiltinCheck('qiyu');

    expect(mockState.probeBuiltinServiceAvailability).toHaveBeenCalledWith('qiyu', true);
    expect(mockState.toastShowConfig).toHaveBeenCalledWith('info', expect.any(Object));
  });

  it('batch-tests configured services, suppresses per-service toasts, and tracks batch progress', async () => {
    const r2Pending = deferred<void>();
    mockState.healthStatusMap.value = {
      r2: 'pending',
      smms: 'pending',
      weibo: 'unconfigured',
      jd: 'pending',
      'custom_s3:custom-1': 'pending',
    };
    setupInvokeHandler((command) => {
      if (command === 'test_s3_connection') return r2Pending.promise;
      return undefined;
    });
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

    const { api } = createHarness();
    const batch = api.testAllConfiguredServices();
    await flushPromisesAndTicks();

    expect(mockState.suppressToasts).toHaveBeenCalledWith(true);
    expect(api.isBatchTesting.value).toBe(true);
    expect(api.batchTestProgress.value?.total).toBe(4);
    expect(api.testingConnections.value.r2).toBe(true);

    await api.testAllConfiguredServices();

    r2Pending.resolve();
    await batch;
    await nextTick();

    expect(mockState.suppressToasts).toHaveBeenLastCalledWith(false);
    expect(api.isBatchTesting.value).toBe(false);
    expect(api.batchTestProgress.value).toBeNull();
    expect(mockState.markVerified).toHaveBeenCalledWith('r2');
    expect(mockState.markVerified).toHaveBeenCalledWith('smms');
    expect(mockState.probeBuiltinServiceAvailability).toHaveBeenCalledWith('jd', true);
  });

  it('does not start a batch when no configured services are runnable', async () => {
    mockState.healthStatusMap.value = {
      weibo: 'unconfigured',
      unknown: 'pending',
    };

    const { api } = createHarness();

    await api.testAllConfiguredServices();

    expect(mockState.suppressToasts).not.toHaveBeenCalled();
    expect(api.activeSession.value).toBeNull();
  });

  /**
   * 明文 HTTP 逃生舱
   *
   * 场景：开着 TUN + fake-ip 时任何主机名都解析进 198.18.0.0/15，Rust 判不出
   * 目标是不是局域网，于是回一个专属错误类型让前端提供确认框。
   */
  describe('明文 HTTP 逃生舱', () => {
    const lanHttpRejection = {
      success: false,
      error: '该地址属于代理软件的 fake-ip 地址池',
      lanHttpUnconfirmed: true,
    };

    it('确认后写回标记并自动重试一次', async () => {
      mockState.webdavTestConnection
        .mockResolvedValueOnce(lanHttpRejection)
        .mockResolvedValueOnce({ success: true, latency: 12 });
      mockState.confirmDialog.mockResolvedValueOnce(true);

      const { api, formData, updateWebdavProfile } = createHarness();
      await api.handleServiceTest('webdav:webdav-1');

      expect(mockState.confirmDialog).toHaveBeenCalledTimes(1);
      // 标记要真的持久化，否则重启后又弹
      expect(updateWebdavProfile).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'webdav-1', lanHttpConfirmed: true }),
      );
      expect(formData.value.webdav_profiles[0].lanHttpConfirmed).toBe(true);
      // 重试时必须带上已确认的 profile，否则重试注定再被拒
      expect(mockState.webdavTestConnection).toHaveBeenCalledTimes(2);
      expect(mockState.webdavTestConnection.mock.calls[1][0]).toMatchObject({
        lanHttpConfirmed: true,
      });
      expect(mockState.markVerified).toHaveBeenCalledWith('webdav:webdav-1');
    });

    it('拒绝确认时不写标记、不重试', async () => {
      mockState.webdavTestConnection.mockResolvedValue(lanHttpRejection);
      mockState.confirmDialog.mockResolvedValueOnce(false);

      const { api, formData, updateWebdavProfile } = createHarness();
      await api.handleServiceTest('webdav:webdav-1');

      expect(updateWebdavProfile).not.toHaveBeenCalled();
      expect(formData.value.webdav_profiles[0].lanHttpConfirmed).toBeUndefined();
      expect(mockState.webdavTestConnection).toHaveBeenCalledTimes(1);
      expect(mockState.markTestFailed).toHaveBeenCalledWith('webdav:webdav-1', expect.any(String));
    });

    it('已确认过的 profile 不再弹框', async () => {
      mockState.webdavTestConnection.mockResolvedValue(lanHttpRejection);

      const { api, formData } = createHarness();
      formData.value.webdav_profiles[0].lanHttpConfirmed = true;

      await api.handleServiceTest('webdav:webdav-1');

      expect(mockState.confirmDialog).not.toHaveBeenCalled();
    });

    it('确认后仍失败时只重试一次，不递归弹框', async () => {
      mockState.webdavTestConnection.mockResolvedValue(lanHttpRejection);
      mockState.confirmDialog.mockResolvedValue(true);

      const { api } = createHarness();
      await api.handleServiceTest('webdav:webdav-1');

      expect(mockState.confirmDialog).toHaveBeenCalledTimes(1);
      expect(mockState.webdavTestConnection).toHaveBeenCalledTimes(2);
    });

    it('非 fake-ip 的失败不弹框，诊断文案原样保留', async () => {
      // 「传上去了但链接打不开」是 WebDAV 最难自查的一环，文案不能被逃生舱吞掉
      mockState.webdavTestConnection.mockResolvedValue({
        success: false,
        error: '图片已上传，但公开链接打不开 (HTTP 401)',
      });

      const { api } = createHarness();
      await api.handleServiceTest('webdav:webdav-1');

      expect(mockState.confirmDialog).not.toHaveBeenCalled();
      expect(mockState.markTestFailed).toHaveBeenCalledWith(
        'webdav:webdav-1',
        '图片已上传，但公开链接打不开 (HTTP 401)',
      );
    });

    it('批量测试撞上 fake-ip 时不弹框', async () => {
      // 批量下逐个弹模态框 = 连环阻塞，用户会以为卡死
      mockState.healthStatusMap.value = { 'webdav:webdav-1': 'verified' };
      mockState.webdavTestConnection.mockResolvedValue(lanHttpRejection);

      const { api } = createHarness();
      await api.testAllConfiguredServices();
      await flushPromisesAndTicks();

      expect(mockState.confirmDialog).not.toHaveBeenCalled();
    });
  });
});
