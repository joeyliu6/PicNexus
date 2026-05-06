import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref, nextTick } from 'vue';
import { useConnectionTest } from '../../../../composables/settings/useConnectionTest';
import { __resetServiceCheckRunnerForTests } from '../../../../composables/useServiceCheckRunner';
import type { SettingsFormShape } from '../../../../composables/settings/settingsFormTypes';
import type { ServiceType } from '../../../../config/types';
import { resetTauriMocks, setupInvokeHandler } from '../../../helpers/tauriMock';
import { flushPromisesAndTicks } from '../../../helpers/wait';

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
}));

vi.mock('../../../../composables/useToast', () => ({
  useToast: () => ({
    showConfig: mockState.toastShowConfig,
  }),
  suppressToasts: mockState.suppressToasts,
}));

vi.mock('../../../../composables/useServiceHealth', () => ({
  useServiceHealth: () => ({
    healthStatusMap: mockState.healthStatusMap,
    markVerified: mockState.markVerified,
    markTestFailed: mockState.markTestFailed,
  }),
}));

vi.mock('../../../../composables/useServiceAvailability', () => ({
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
    editorServer: { enabled: false, port: 0, typoraEnabled: false, typoraService: null, obsidianService: null },
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
  const api = useConnectionTest({
    formData,
    serviceNames,
    errorToString,
    validateS3Config,
  });

  return { api, formData, validateS3Config, errorToString };
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
});
