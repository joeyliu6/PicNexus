// MultiServiceUploader 边界补强测试：
// - 多服务全失败时 partialFailures 全集 + 结构化错误透传
// - primary 选第一个 success（即使中间有失败夹着）
// - onServiceResult 失败 case 也回调
// - filterConfiguredServices 各分支：cookie 缺失 / 必填字段缺失 / enabled=false / NO_CONFIG 直通

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MultiServiceUploader } from '../../../core/MultiServiceUploader';
import type { SingleServiceResult } from '../../../core/MultiServiceUploader';
import type { UserConfig } from '../../../config/types';
import type { UploadResult, ValidationResult } from '../../../uploaders/base/types';

vi.mock('../../../uploaders/base/UploaderFactory', () => ({
  UploaderFactory: { create: vi.fn() },
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

vi.mock('../../../utils/semaphore', () => ({
  getServiceSemaphore: () => ({
    withPermit: (fn: () => Promise<unknown>) => fn(),
  }),
}));

vi.mock('../../../uploaders/weibo/WeiboError', () => ({
  convertToStructuredWeiboError: (err: unknown) => ({
    code: 'WEIBO_AUTH_FAILED',
    message: err instanceof Error ? err.message : String(err),
    retryable: false,
  }),
}));
vi.mock('../../../uploaders/r2/R2Error', () => ({
  convertToStructuredR2Error: (err: unknown) => ({
    code: 'R2_NETWORK',
    message: err instanceof Error ? err.message : String(err),
    retryable: true,
  }),
}));
vi.mock('../../../uploaders/jd/JDError', () => ({
  convertToJDError: (err: unknown) => ({
    code: 'JD_FAILED',
    message: err instanceof Error ? err.message : String(err),
    retryable: true,
  }),
}));
vi.mock('../../../uploaders/nami/NamiError', () => ({
  convertToNamiError: (err: unknown) => ({
    code: 'NAMI_FAILED',
    message: err instanceof Error ? err.message : String(err),
    retryable: true,
  }),
}));

vi.mock('../../../constants/serviceRequiredFields', () => ({
  SERVICE_REQUIRED_FIELDS: {
    smms: ['token'],
    github: ['token', 'owner', 'repo'],
    r2: ['accountId', 'accessKeyId', 'secretAccessKey', 'bucketName', 'publicDomain'],
    jd: [],
    qiyu: [],
    weibo: ['cookie'],
    zhihu: ['cookie'],
  } as Record<string, string[]>,
  COOKIE_BASED_SERVICES: ['weibo', 'zhihu'],
  NO_CONFIG_SERVICES: ['jd', 'qiyu'],
  CUSTOM_S3_REQUIRED_FIELDS: ['endpoint', 'accessKeyId', 'secretAccessKey', 'bucketName'],
}));

import { UploaderFactory } from '../../../uploaders/base/UploaderFactory';

const mockCreate = vi.mocked(UploaderFactory.create);

function makeUploader(opts: { url?: string; uploadError?: Error; validationResult?: ValidationResult } = {}) {
  const url = opts.url ?? 'https://x.com/a.png';
  const uploadResult: UploadResult = { serviceId: 'mock', fileKey: 'k', url, size: 1 };
  return {
    serviceId: 'mock',
    serviceName: 'Mock',
    upload: opts.uploadError
      ? vi.fn().mockRejectedValue(opts.uploadError)
      : vi.fn().mockResolvedValue(uploadResult),
    validateConfig: vi.fn().mockResolvedValue(opts.validationResult ?? { valid: true }),
    getPublicUrl: vi.fn().mockReturnValue(url),
  };
}

function makeConfig(services: Record<string, Record<string, unknown>> = {}): UserConfig {
  return {
    services: {
      smms: { token: 'tok' },
      github: { token: 'ghp', owner: 'u', repo: 'r' },
      ...services,
    },
  } as unknown as UserConfig;
}

describe('MultiServiceUploader - partial failure 深入', () => {
  let uploader: MultiServiceUploader;

  beforeEach(() => {
    vi.clearAllMocks();
    uploader = new MultiServiceUploader();
  });

  it('多个服务全部失败时，错误信息聚合所有服务的 error', async () => {
    mockCreate.mockImplementation((sid: string) => {
      if (sid === 'smms') return makeUploader({ uploadError: new Error('smms 挂了') }) as never;
      if (sid === 'github') return makeUploader({ uploadError: new Error('github 限流') }) as never;
      throw new Error(`未注册: ${sid}`);
    });

    await expect(
      uploader.uploadToMultipleServices('/tmp/a.jpg', ['smms', 'github'], makeConfig()),
    ).rejects.toThrow(/smms.*github|github.*smms/s);
  });

  it('primary 选第一个 success，即使前面有 failed 服务夹着', async () => {
    mockCreate.mockImplementation((sid: string) => {
      if (sid === 'smms') return makeUploader({ uploadError: new Error('挂') }) as never;
      if (sid === 'github') return makeUploader({ url: 'https://github.com/ok.png' }) as never;
      throw new Error(`未注册: ${sid}`);
    });

    const r = await uploader.uploadToMultipleServices(
      '/tmp/a.jpg',
      ['smms', 'github'],
      makeConfig(),
    );

    expect(r.primaryService).toBe('github');
    expect(r.primaryUrl).toBe('https://github.com/ok.png');
    expect(r.isPartialSuccess).toBe(true);
    expect(r.partialFailures).toHaveLength(1);
    expect(r.partialFailures![0].serviceId).toBe('smms');
  });

  it('partialFailures 中保留 structuredError（用于上层判断 retryable）', async () => {
    mockCreate.mockImplementation((sid: string) => {
      if (sid === 'smms') return makeUploader({ url: 'https://ok.com/a.png' }) as never;
      if (sid === 'r2') return makeUploader({ uploadError: new Error('connection reset') }) as never;
      throw new Error(`未注册: ${sid}`);
    });

    const r = await uploader.uploadToMultipleServices(
      '/tmp/a.jpg',
      ['smms', 'r2'],
      makeConfig({ r2: { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucketName: 'b', publicDomain: 'd' } }),
    );

    expect(r.partialFailures![0].structuredError).toMatchObject({
      code: 'R2_NETWORK',
      retryable: true,
    });
  });

  it('onServiceResult 在失败 case 也被回调（status=failed）', async () => {
    mockCreate.mockImplementation((sid: string) => {
      if (sid === 'smms') return makeUploader({ url: 'https://ok.com/a.png' }) as never;
      if (sid === 'github') return makeUploader({ uploadError: new Error('挂') }) as never;
      throw new Error(`未注册: ${sid}`);
    });

    const onServiceResult = vi.fn();
    await uploader.uploadToMultipleServices(
      '/tmp/a.jpg',
      ['smms', 'github'],
      makeConfig(),
      undefined,
      onServiceResult,
    );

    expect(onServiceResult).toHaveBeenCalledTimes(2);
    const failedCall = onServiceResult.mock.calls.find(
      (c: SingleServiceResult[]) => c[0].status === 'failed',
    );
    expect(failedCall).toBeDefined();
    expect(failedCall![0].serviceId).toBe('github');
    expect(failedCall![0].error).toBeDefined();
  });

  it('weibo 服务的失败用 convertToStructuredWeiboError 包装', async () => {
    mockCreate.mockImplementation((sid: string) => {
      if (sid === 'smms') return makeUploader({ url: 'https://ok.com/a.png' }) as never;
      if (sid === 'weibo') return makeUploader({ uploadError: new Error('cookie 失效') }) as never;
      throw new Error(`未注册: ${sid}`);
    });

    const r = await uploader.uploadToMultipleServices(
      '/tmp/a.jpg',
      ['smms', 'weibo'],
      makeConfig({ weibo: { cookie: 'fake-cookie' } }),
    );

    const weiboFail = r.partialFailures!.find(f => f.serviceId === 'weibo');
    expect(weiboFail!.structuredError).toMatchObject({ code: 'WEIBO_AUTH_FAILED' });
  });
});

describe('MultiServiceUploader.filterConfiguredServices 分支', () => {
  let uploader: MultiServiceUploader;

  beforeEach(() => {
    uploader = new MultiServiceUploader();
  });

  it('NO_CONFIG_SERVICES（jd/qiyu）即使无配置也通过', () => {
    const r = uploader.filterConfiguredServices(
      ['jd', 'qiyu'] as string[],
      { services: {} } as unknown as UserConfig,
    );
    expect(r).toEqual(['jd', 'qiyu']);
  });

  it('cookie 服务无 cookie 字段 → 过滤掉', () => {
    const r = uploader.filterConfiguredServices(
      ['weibo'],
      { services: { weibo: {} } } as unknown as UserConfig,
    );
    expect(r).toEqual([]);
  });

  it('cookie 服务的 cookie 仅空白 → 过滤掉', () => {
    const r = uploader.filterConfiguredServices(
      ['weibo'],
      { services: { weibo: { cookie: '   ' } } } as unknown as UserConfig,
    );
    expect(r).toEqual([]);
  });

  it('cookie 服务有有效 cookie → 通过', () => {
    const r = uploader.filterConfiguredServices(
      ['zhihu'],
      { services: { zhihu: { cookie: 'z_c0=x' } } } as unknown as UserConfig,
    );
    expect(r).toEqual(['zhihu']);
  });

  it('必填字段（smms.token）缺失 → 过滤掉', () => {
    const r = uploader.filterConfiguredServices(
      ['smms'],
      { services: { smms: {} } } as unknown as UserConfig,
    );
    expect(r).toEqual([]);
  });

  it('必填字段全空白 → 过滤掉', () => {
    const r = uploader.filterConfiguredServices(
      ['smms'],
      { services: { smms: { token: '   ' } } } as unknown as UserConfig,
    );
    expect(r).toEqual([]);
  });

  it('多个服务混合：仅保留配置完整的', () => {
    const r = uploader.filterConfiguredServices(
      ['smms', 'github', 'weibo'],
      {
        services: {
          smms: { token: 'ok' },        // 通过
          github: { token: 'ok' },       // 缺 owner/repo，过滤
          weibo: { cookie: 'ok' },       // cookie 通过
        },
      } as unknown as UserConfig,
    );
    expect(r).toEqual(['smms', 'weibo']);
  });

  it('config.services 为空对象时全部过滤（除 NO_CONFIG）', () => {
    const r = uploader.filterConfiguredServices(
      ['smms', 'github', 'jd'],
      { services: {} } as unknown as UserConfig,
    );
    expect(r).toEqual(['jd']);
  });
});
