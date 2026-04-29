import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getInvokeMock } from '../../helpers/tauriMock';
import type { UploadOptions } from '../../../uploaders/base/types';
import type { NamiServiceConfig } from '../../../config/types';

const invokeMock = getInvokeMock();

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

const { NamiUploader } = await import('../../../uploaders/nami/NamiUploader');

function makeConfig(overrides: Partial<NamiServiceConfig> = {}): NamiServiceConfig {
  return {
    enabled: true,
    cookie: 'nami_session=abc',
    authToken: 'auth-token-123',
    ...overrides,
  };
}

function makeOptions(config: Partial<NamiServiceConfig> = {}): UploadOptions {
  return { config: makeConfig(config) } as UploadOptions;
}

describe('NamiUploader.upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('上传成功时先刷新 Token，再调用 Rust 上传并返回标准 UploadResult', async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'fetch_nami_token') return { accessToken: 'access', zmToken: 'zm' };
      if (cmd === 'upload_to_nami') {
        return {
          url: 'https://nami.example.com/a.jpg',
          size: 12345,
          instant: false,
        };
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    const result = await new NamiUploader().upload('/tmp/a.jpg', makeOptions());

    expect(invokeMock).toHaveBeenCalledWith('fetch_nami_token', {
      cookie: 'nami_session=abc',
      authToken: 'auth-token-123',
    });
    expect(invokeMock).toHaveBeenCalledWith('upload_to_nami', expect.objectContaining({
      filePath: '/tmp/a.jpg',
      cookie: 'nami_session=abc',
      authToken: 'auth-token-123',
    }));
    expect(result).toEqual({
      serviceId: 'nami',
      fileKey: 'https://nami.example.com/a.jpg',
      url: 'https://nami.example.com/a.jpg',
      size: 12345,
    });
  });

  it('Token 预刷新失败但上传成功时，仍返回上传结果', async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'fetch_nami_token') throw new Error('sidecar unavailable');
      if (cmd === 'upload_to_nami') {
        return { url: 'https://nami.example.com/fallback.jpg', instant: true };
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    const result = await new NamiUploader().upload('/tmp/fallback.jpg', makeOptions());

    expect(result.url).toBe('https://nami.example.com/fallback.jpg');
    expect(result.size).toBeUndefined();
  });

  it('普通上传失败时抛出纳米图床上下文错误', async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'fetch_nami_token') return { accessToken: 'access', zmToken: 'zm' };
      if (cmd === 'upload_to_nami') throw new Error('network down');
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(new NamiUploader().upload('/tmp/a.jpg', makeOptions()))
      .rejects.toThrow(/纳米图床上传失败: .*network down/);
  });

  it('认证失败会清掉缓存状态，下一次上传会重新刷新 Token', async () => {
    let uploadAttempt = 0;
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'fetch_nami_token') return { accessToken: 'access', zmToken: 'zm' };
      if (cmd === 'upload_to_nami') {
        uploadAttempt += 1;
        if (uploadAttempt === 1) throw new Error('HTTP 401');
        return { url: 'https://nami.example.com/retry.jpg', size: 1, instant: false };
      }
      throw new Error(`unexpected command: ${cmd}`);
    });
    const uploader = new NamiUploader();

    await expect(uploader.upload('/tmp/a.jpg', makeOptions()))
      .rejects.toThrow('纳米图床认证失败');
    const fetchCountAfterFailure = invokeMock.mock.calls
      .filter(([cmd]) => cmd === 'fetch_nami_token').length;

    await expect(uploader.upload('/tmp/a.jpg', makeOptions()))
      .resolves.toEqual(expect.objectContaining({ url: 'https://nami.example.com/retry.jpg' }));
    const finalFetchCount = invokeMock.mock.calls
      .filter(([cmd]) => cmd === 'fetch_nami_token').length;

    expect(fetchCountAfterFailure).toBe(1);
    expect(finalFetchCount).toBe(2);
  });

  it('同一凭证的连续成功上传会复用新鲜 Token，避免重复预刷新', async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'fetch_nami_token') return { accessToken: 'access', zmToken: 'zm' };
      if (cmd === 'upload_to_nami') {
        return { url: 'https://nami.example.com/reused.jpg', size: 10, instant: false };
      }
      throw new Error(`unexpected command: ${cmd}`);
    });
    const uploader = new NamiUploader();

    await uploader.upload('/tmp/one.jpg', makeOptions());
    await uploader.upload('/tmp/two.jpg', makeOptions());

    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'fetch_nami_token')).toHaveLength(1);
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'upload_to_nami')).toHaveLength(2);
  });

  it('凭证变化时会重新刷新 Token', async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'fetch_nami_token') return { accessToken: 'access', zmToken: 'zm' };
      if (cmd === 'upload_to_nami') {
        return { url: 'https://nami.example.com/changed.jpg', size: 10, instant: false };
      }
      throw new Error(`unexpected command: ${cmd}`);
    });
    const uploader = new NamiUploader();

    await uploader.upload('/tmp/one.jpg', makeOptions({ cookie: 'cookie-a', authToken: 'token-a' }));
    await uploader.upload('/tmp/two.jpg', makeOptions({ cookie: 'cookie-b', authToken: 'token-b' }));

    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'fetch_nami_token')).toHaveLength(2);
  });

  it('Rust 响应缺少 url 时保留当前返回形态，暴露上游响应异常', async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'fetch_nami_token') return { accessToken: 'access', zmToken: 'zm' };
      if (cmd === 'upload_to_nami') return { size: 5, instant: false };
      throw new Error(`unexpected command: ${cmd}`);
    });

    const result = await new NamiUploader().upload('/tmp/broken.jpg', makeOptions());

    expect(result.url).toBeUndefined();
    expect(result.fileKey).toBeUndefined();
    expect(result.size).toBe(5);
  });
});

describe('NamiUploader.forceRefreshToken / thumbnail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forceRefreshToken 成功时返回 true，失败时返回 false', async () => {
    invokeMock.mockResolvedValueOnce({ accessToken: 'access', zmToken: 'zm' });
    const uploader = new NamiUploader();

    await expect(uploader.forceRefreshToken(makeConfig())).resolves.toBe(true);

    invokeMock.mockRejectedValueOnce(new Error('bad cookie'));
    await expect(uploader.forceRefreshToken(makeConfig())).resolves.toBe(false);
  });

  it('getThumbnailUrl 添加纳米 TOS 图片处理参数', () => {
    const url = new NamiUploader().getThumbnailUrl({
      serviceId: 'nami',
      fileKey: 'https://nami.example.com/a.jpg',
      url: 'https://nami.example.com/a.jpg',
    });

    expect(url).toBe('https://nami.example.com/a.jpg?x-tos-process=image/resize,l_75/quality,q_70/format,jpg');
  });
});
