import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MultiServiceUploader } from '../../../core/MultiServiceUploader';
import type { SingleServiceResult } from '../../../core/MultiServiceUploader';
import type { UserConfig, ServiceType } from '../../../config/types';
import type { UploadResult, ValidationResult } from '../../../uploaders/base/types';

// Mock UploaderFactory
vi.mock('../../../uploaders/base/UploaderFactory', () => ({
  UploaderFactory: {
    create: vi.fn(),
  },
}));

// Mock logger
vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock semaphore — 直接透传，不做并发限制
vi.mock('../../../utils/semaphore', () => ({
  getServiceSemaphore: () => ({
    withPermit: (fn: () => Promise<unknown>) => fn(),
  }),
}));

// Mock 结构化错误转换器（避免引入真实依赖）
vi.mock('../../../uploaders/weibo/WeiboError', () => ({
  convertToStructuredWeiboError: (err: unknown) => ({
    code: 'UPLOAD_FAILED',
    message: err instanceof Error ? err.message : String(err),
  }),
}));
vi.mock('../../../uploaders/r2/R2Error', () => ({
  convertToStructuredR2Error: (err: unknown) => ({
    code: 'UPLOAD_FAILED',
    message: err instanceof Error ? err.message : String(err),
  }),
}));
vi.mock('../../../uploaders/jd/JDError', () => ({
  convertToJDError: (err: unknown) => ({
    code: 'UPLOAD_FAILED',
    message: err instanceof Error ? err.message : String(err),
  }),
}));
vi.mock('../../../uploaders/nami/NamiError', () => ({
  convertToNamiError: (err: unknown) => ({
    code: 'UPLOAD_FAILED',
    message: err instanceof Error ? err.message : String(err),
  }),
}));

// Mock 常量
vi.mock('../../../constants/serviceRequiredFields', () => ({
  SERVICE_REQUIRED_FIELDS: {
    smms: ['token'],
    github: ['token', 'owner', 'repo'],
    imgur: ['clientId'],
    r2: ['accountId', 'accessKeyId', 'secretAccessKey', 'bucketName', 'publicDomain'],
    jd: [],
    qiyu: [],
    weibo: ['cookie'],
    nowcoder: ['cookie'],
    zhihu: ['cookie'],
    nami: ['cookie'],
    bilibili: ['cookie'],
    chaoxing: ['cookie'],
    tencent: ['secretId', 'secretKey', 'bucket', 'region', 'publicDomain'],
    aliyun: ['accessKeyId', 'accessKeySecret', 'bucket', 'region', 'publicDomain'],
    qiniu: ['accessKey', 'secretKey', 'bucket', 'publicDomain'],
    upyun: ['operator', 'password', 'bucket', 'publicDomain'],
  } as Record<string, string[]>,
  COOKIE_BASED_SERVICES: ['weibo', 'nowcoder', 'zhihu', 'nami', 'bilibili', 'chaoxing'],
  NO_CONFIG_SERVICES: ['jd', 'qiyu'],
}));

import { UploaderFactory } from '../../../uploaders/base/UploaderFactory';

const mockCreate = vi.mocked(UploaderFactory.create);

// ─── 工具函数 ──────────────────────────────────────────────

/** 创建一个 mock 上传器实例 */
function makeMockUploader(overrides?: {
  url?: string;
  uploadError?: Error;
  validationResult?: ValidationResult;
}) {
  const url = overrides?.url ?? 'https://example.com/img.png';
  const validResult: ValidationResult = overrides?.validationResult ?? { valid: true };

  const uploadResult: UploadResult = {
    serviceId: 'mock',
    fileKey: 'mock-key',
    url,
    size: 1024,
  };

  return {
    serviceId: 'mock',
    serviceName: 'Mock',
    upload: overrides?.uploadError
      ? vi.fn().mockRejectedValue(overrides.uploadError)
      : vi.fn().mockResolvedValue(uploadResult),
    validateConfig: vi.fn().mockResolvedValue(validResult),
    getPublicUrl: vi.fn().mockReturnValue(url),
  };
}

/** 创建最小化的 mock 配置 */
function makeConfig(services: Record<string, Record<string, unknown>> = {}): UserConfig {
  return {
    services: {
      smms: { token: 'test-token' },
      github: { token: 'ghp_xxx', owner: 'user', repo: 'repo', branch: 'main', path: 'images/' },
      ...services,
    },
  } as unknown as UserConfig;
}

// ─── 测试用例 ──────────────────────────────────────────────

describe('MultiServiceUploader', () => {
  let uploader: MultiServiceUploader;

  beforeEach(() => {
    vi.clearAllMocks();
    uploader = new MultiServiceUploader();
  });

  // ---------- 1. 单服务上传成功 ----------

  it('单服务上传成功时返回正确的 primaryUrl 和结果', async () => {
    const mock = makeMockUploader({ url: 'https://smms.app/a.png' });
    mockCreate.mockReturnValue(mock as never);

    const result = await uploader.uploadToMultipleServices(
      '/tmp/test.jpg',
      ['smms'] as ServiceType[],
      makeConfig(),
    );

    expect(result.primaryService).toBe('smms');
    expect(result.primaryUrl).toBe('https://smms.app/a.png');
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe('success');
    expect(result.isPartialSuccess).toBeFalsy();
    expect(result.partialFailures).toBeUndefined();
  });

  // ---------- 2. 多服务全部成功 ----------

  it('多服务全部成功时，primaryUrl 来自第一个成功的服务', async () => {
    const smmsMock = makeMockUploader({ url: 'https://smms.app/a.png' });
    const githubMock = makeMockUploader({ url: 'https://github.com/img.png' });

    mockCreate.mockImplementation((serviceId: string) => {
      if (serviceId === 'smms') return smmsMock as never;
      if (serviceId === 'github') return githubMock as never;
      throw new Error(`未注册: ${serviceId}`);
    });

    const result = await uploader.uploadToMultipleServices(
      '/tmp/test.jpg',
      ['smms', 'github'] as ServiceType[],
      makeConfig(),
    );

    expect(result.results).toHaveLength(2);
    expect(result.results.every(r => r.status === 'success')).toBe(true);
    expect(result.primaryService).toBe('smms');
    expect(result.primaryUrl).toBe('https://smms.app/a.png');
    expect(result.isPartialSuccess).toBeFalsy();
  });

  // ---------- 3. 全部失败抛出错误 ----------

  it('所有服务都失败时抛出包含失败详情的错误', async () => {
    const failMock = makeMockUploader({
      uploadError: new Error('网络超时'),
    });
    mockCreate.mockReturnValue(failMock as never);

    await expect(
      uploader.uploadToMultipleServices(
        '/tmp/test.jpg',
        ['smms', 'github'] as ServiceType[],
        makeConfig(),
      ),
    ).rejects.toThrow('所有图床上传均失败');
  });

  // ---------- 4. 部分成功 ----------

  it('部分服务成功时返回 isPartialSuccess=true 和 partialFailures', async () => {
    const successMock = makeMockUploader({ url: 'https://smms.app/ok.png' });
    const failMock = makeMockUploader({ uploadError: new Error('token 过期') });

    mockCreate.mockImplementation((serviceId: string) => {
      if (serviceId === 'smms') return successMock as never;
      if (serviceId === 'github') return failMock as never;
      throw new Error(`未注册: ${serviceId}`);
    });

    const result = await uploader.uploadToMultipleServices(
      '/tmp/test.jpg',
      ['smms', 'github'] as ServiceType[],
      makeConfig(),
    );

    expect(result.isPartialSuccess).toBe(true);
    expect(result.partialFailures).toHaveLength(1);
    expect(result.partialFailures![0].serviceId).toBe('github');
    expect(result.primaryService).toBe('smms');
    expect(result.primaryUrl).toBe('https://smms.app/ok.png');
  });

  // ---------- 5. 空服务列表抛出错误 ----------

  it('enabledServices 为空数组时抛出错误', async () => {
    await expect(
      uploader.uploadToMultipleServices(
        '/tmp/test.jpg',
        [] as ServiceType[],
        makeConfig(),
      ),
    ).rejects.toThrow('没有启用任何图床服务');
  });

  // ---------- 6. onProgress 回调被正确触发 ----------

  it('上传过程中触发 onProgress 回调', async () => {
    const mock = makeMockUploader({ url: 'https://smms.app/a.png' });
    mockCreate.mockReturnValue(mock as never);

    const onProgress = vi.fn();

    await uploader.uploadToMultipleServices(
      '/tmp/test.jpg',
      ['smms'] as ServiceType[],
      makeConfig(),
      onProgress,
    );

    // 至少会触发「准备上传」和「开始上传」两个阶段的进度回调
    expect(onProgress).toHaveBeenCalled();
    const calls = onProgress.mock.calls;

    // 第一次调用：准备阶段 (serviceId, 0, '准备上传...', 0, 2)
    expect(calls[0][0]).toBe('smms');
    expect(calls[0][1]).toBe(0);

    // 第二次调用：开始上传 (serviceId, 10, '开始上传...', 1, 2)
    expect(calls[1][0]).toBe('smms');
    expect(calls[1][1]).toBe(10);
  });

  // ---------- 7. onServiceResult 回调每个服务都被触发 ----------

  it('每个服务完成后都触发 onServiceResult 回调', async () => {
    const smmsMock = makeMockUploader({ url: 'https://smms.app/a.png' });
    const githubMock = makeMockUploader({ url: 'https://github.com/img.png' });

    mockCreate.mockImplementation((serviceId: string) => {
      if (serviceId === 'smms') return smmsMock as never;
      if (serviceId === 'github') return githubMock as never;
      throw new Error(`未注册: ${serviceId}`);
    });

    const onServiceResult = vi.fn();

    await uploader.uploadToMultipleServices(
      '/tmp/test.jpg',
      ['smms', 'github'] as ServiceType[],
      makeConfig(),
      undefined,
      onServiceResult,
    );

    expect(onServiceResult).toHaveBeenCalledTimes(2);

    const resultServiceIds = onServiceResult.mock.calls.map(
      (call: SingleServiceResult[]) => call[0].serviceId,
    );
    expect(resultServiceIds).toContain('smms');
    expect(resultServiceIds).toContain('github');

    // 每次回调的 status 都应该是 success
    onServiceResult.mock.calls.forEach((call: SingleServiceResult[]) => {
      expect(call[0].status).toBe('success');
    });
  });

  // ---------- 8. 配置验证失败视为上传失败 ----------

  it('配置验证失败的服务被标记为 failed', async () => {
    const invalidMock = makeMockUploader({
      validationResult: { valid: false, errors: ['token 为空'] },
    });
    const successMock = makeMockUploader({ url: 'https://smms.app/ok.png' });

    mockCreate.mockImplementation((serviceId: string) => {
      if (serviceId === 'github') return invalidMock as never;
      if (serviceId === 'smms') return successMock as never;
      throw new Error(`未注册: ${serviceId}`);
    });

    const result = await uploader.uploadToMultipleServices(
      '/tmp/test.jpg',
      ['smms', 'github'] as ServiceType[],
      makeConfig(),
    );

    expect(result.isPartialSuccess).toBe(true);
    const githubResult = result.results.find(r => r.serviceId === 'github');
    expect(githubResult?.status).toBe('failed');
    expect(githubResult?.error).toContain('配置验证失败');
  });

  // ---------- 9. 未配置的服务被过滤掉 ----------

  it('未配置的服务被过滤，若全被过滤则抛出错误', async () => {
    const emptyConfig = { services: {} } as unknown as UserConfig;

    await expect(
      uploader.uploadToMultipleServices(
        '/tmp/test.jpg',
        ['smms'] as ServiceType[],
        emptyConfig,
      ),
    ).rejects.toThrow('已启用的图床尚未配置');
  });

  // ---------- 10. 无需配置的服务（jd/qiyu）可直接上传 ----------

  it('无需配置的服务直接通过过滤', async () => {
    const mock = makeMockUploader({ url: 'https://jd.com/img.png' });
    mockCreate.mockReturnValue(mock as never);

    const config = { services: {} } as unknown as UserConfig;

    const result = await uploader.uploadToMultipleServices(
      '/tmp/test.jpg',
      ['jd'] as ServiceType[],
      config,
    );

    expect(result.primaryService).toBe('jd');
    expect(result.primaryUrl).toBe('https://jd.com/img.png');
  });

  // ---------- 11. onServiceResult 支持异步回调 ----------

  it('onServiceResult 支持 async 回调', async () => {
    const mock = makeMockUploader({ url: 'https://smms.app/a.png' });
    mockCreate.mockReturnValue(mock as never);

    const collected: SingleServiceResult[] = [];
    const onServiceResult = vi.fn(async (result: SingleServiceResult) => {
      // 模拟异步操作（如写入历史记录）
      await new Promise(resolve => setTimeout(resolve, 5));
      collected.push(result);
    });

    await uploader.uploadToMultipleServices(
      '/tmp/test.jpg',
      ['smms'] as ServiceType[],
      makeConfig(),
      undefined,
      onServiceResult,
    );

    expect(collected).toHaveLength(1);
    expect(collected[0].serviceId).toBe('smms');
  });

  // ---------- 12. retryUpload 单图床重试 ----------

  describe('retryUpload', () => {
    it('重试成功时返回上传结果', async () => {
      const mock = makeMockUploader({ url: 'https://smms.app/retry.png' });
      mockCreate.mockReturnValue(mock as never);

      const result = await uploader.retryUpload(
        '/tmp/test.jpg',
        'smms' as ServiceType,
        makeConfig(),
      );

      expect(result.url).toBe('https://smms.app/retry.png');
      expect(mock.upload).toHaveBeenCalledTimes(1);
    });

    it('重试时配置验证失败则抛出错误', async () => {
      const mock = makeMockUploader({
        validationResult: { valid: false, errors: ['缺少 token'] },
      });
      mockCreate.mockReturnValue(mock as never);

      await expect(
        uploader.retryUpload('/tmp/test.jpg', 'smms' as ServiceType, makeConfig()),
      ).rejects.toThrow('配置验证失败');
    });

    it('重试时传递 onProgress 回调给上传器', async () => {
      const mock = makeMockUploader({ url: 'https://smms.app/retry.png' });
      mockCreate.mockReturnValue(mock as never);

      const onProgress = vi.fn();

      await uploader.retryUpload(
        '/tmp/test.jpg',
        'smms' as ServiceType,
        makeConfig(),
        onProgress,
      );

      // upload 第三个参数应该是 onProgress
      expect(mock.upload).toHaveBeenCalledWith(
        '/tmp/test.jpg',
        expect.objectContaining({ config: expect.anything() }),
        onProgress,
      );
    });

    it.each(['jd', 'qiyu'] as const)('无需配置的服务 %s 重试时使用空配置继续上传', async (serviceId) => {
      const mock = makeMockUploader({ url: `https://${serviceId}.example.com/retry.png` });
      mockCreate.mockReturnValue(mock as never);

      const result = await uploader.retryUpload(
        '/tmp/test.jpg',
        serviceId as ServiceType,
        { services: {} } as unknown as UserConfig,
      );

      expect(result.url).toBe(`https://${serviceId}.example.com/retry.png`);
      expect(mock.validateConfig).toHaveBeenCalledWith({});
      expect(mock.upload).toHaveBeenCalledWith(
        '/tmp/test.jpg',
        { config: {} },
        undefined,
      );
    });
  });
});
