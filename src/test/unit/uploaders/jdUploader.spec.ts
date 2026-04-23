// JDUploader upload 流程测试
// 覆盖：成功路径、重试机制、风控熔断触发、错误分类

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { UploadOptions } from '../../../uploaders/base/types';
import type { JDServiceConfig } from '../../../config/types';

// ─── Mock: 避免真实 Tauri 调用 ───────────────────────────
const invokeMock = vi.fn();
const listenMock = vi.fn(async () => () => void 0); // 返回 unlisten

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

// ─── Mock: 禁用限速器与 logger 的副作用 ─────────────────
const acquireMock = vi.fn(async () => void 0);
const triggerCircuitBreakerMock = vi.fn();

vi.mock('../../../uploaders/jd/JDRateLimiter', () => ({
  JDRateLimiter: {
    getInstance: () => ({
      acquire: acquireMock,
      triggerCircuitBreaker: triggerCircuitBreakerMock,
    }),
  },
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../types/errors', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  isAuthError: () => false,
}));

const { JDUploader } = await import('../../../uploaders/jd/JDUploader');

function makeOptions(): UploadOptions {
  return {
    config: {} as JDServiceConfig,
  } as UploadOptions;
}

describe('JDUploader.upload - 成功路径', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    acquireMock.mockClear();
    triggerCircuitBreakerMock.mockClear();
  });

  it('一次性成功时返回规范化的 UploadResult', async () => {
    invokeMock.mockResolvedValueOnce({ url: 'https://jd.com/x.jpg', size: 1024 });

    const uploader = new JDUploader();
    const result = await uploader.upload('/tmp/a.jpg', makeOptions());

    expect(result).toEqual({
      serviceId: 'jd',
      fileKey: 'https://jd.com/x.jpg',
      url: 'https://jd.com/x.jpg',
      size: 1024,
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(acquireMock).toHaveBeenCalledTimes(1);
    expect(triggerCircuitBreakerMock).not.toHaveBeenCalled();
  });

  it('每次上传前都会获取限速许可', async () => {
    invokeMock.mockResolvedValueOnce({ url: 'https://jd.com/a.jpg', size: 1 });
    await new JDUploader().upload('/tmp/a.jpg', makeOptions());
    expect(acquireMock).toHaveBeenCalledTimes(1);
  });

  it('传递给 invoke 的命令是 upload_to_jd', async () => {
    invokeMock.mockResolvedValueOnce({ url: 'u', size: 1 });
    await new JDUploader().upload('/tmp/x.jpg', makeOptions());
    // invoke 调用形如 invoke('upload_to_jd', { id, filePath, ... })
    expect(invokeMock).toHaveBeenCalledWith('upload_to_jd', expect.objectContaining({
      filePath: '/tmp/x.jpg',
    }));
  });
});

describe('JDUploader.upload - 重试与熔断', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    acquireMock.mockClear();
    triggerCircuitBreakerMock.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('首次 500 错误触发熔断，重试后成功', async () => {
    invokeMock
      .mockRejectedValueOnce(new Error('500 Internal Server Error'))
      .mockResolvedValueOnce({ url: 'https://jd.com/ok.jpg', size: 2048 });

    const uploader = new JDUploader();
    const promise = uploader.upload('/tmp/a.jpg', makeOptions());
    // 推进所有挂起的定时器（退避不影响，因为 500 分支走熔断继续循环）
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.url).toBe('https://jd.com/ok.jpg');
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(triggerCircuitBreakerMock).toHaveBeenCalledTimes(1);
    // 熔断时长应在 [5000, 10000) 区间内
    const [waitArg] = triggerCircuitBreakerMock.mock.calls[0] as [number];
    expect(waitArg).toBeGreaterThanOrEqual(5000);
    expect(waitArg).toBeLessThan(10000);
  });

  it('forbidden 关键字也会触发熔断', async () => {
    invokeMock
      .mockRejectedValueOnce(new Error('forbidden by risk control'))
      .mockResolvedValueOnce({ url: 'https://jd.com/ok.jpg', size: 1 });

    const p = new JDUploader().upload('/tmp/a.jpg', makeOptions());
    await vi.runAllTimersAsync();
    await p;

    expect(triggerCircuitBreakerMock).toHaveBeenCalledTimes(1);
  });

  it('limit 关键字也会触发熔断', async () => {
    invokeMock
      .mockRejectedValueOnce(new Error('rate limit exceeded'))
      .mockResolvedValueOnce({ url: 'https://jd.com/ok.jpg', size: 1 });

    const p = new JDUploader().upload('/tmp/a.jpg', makeOptions());
    await vi.runAllTimersAsync();
    await p;

    expect(triggerCircuitBreakerMock).toHaveBeenCalledTimes(1);
  });

  it('非风控错误走退避分支、不触发熔断', async () => {
    invokeMock
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({ url: 'https://jd.com/ok.jpg', size: 1 });

    const p = new JDUploader().upload('/tmp/a.jpg', makeOptions());
    await vi.runAllTimersAsync();
    await p;

    expect(triggerCircuitBreakerMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('重试耗尽（3 次都失败）抛出最终错误', async () => {
    invokeMock
      .mockRejectedValueOnce(new Error('500 err'))
      .mockRejectedValueOnce(new Error('500 err'))
      .mockRejectedValueOnce(new Error('500 err'));

    const uploader = new JDUploader();
    const p = uploader.upload('/tmp/a.jpg', makeOptions());
    // 先挂一个 catch 捕获最终 rejection，避免 fake-timer 期间产生 unhandled rejection 警告
    const settled = p.catch((err: unknown) => err);
    await vi.runAllTimersAsync();
    const err = await settled;

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/京东图床上传失败/);
    expect(invokeMock).toHaveBeenCalledTimes(3); // MAX_RETRIES=2 → 尝试 0,1,2 共 3 次
  });
});

describe('JDUploader.validateConfig', () => {
  it('无需任何字段，直接 valid', async () => {
    const result = await new JDUploader().validateConfig({} as JDServiceConfig);
    expect(result.valid).toBe(true);
  });
});
