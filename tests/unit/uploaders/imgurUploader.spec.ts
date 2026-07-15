import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getInvokeMock } from '../helpers/tauriMock';
import type { UploadOptions } from '@/uploaders/base/types';
import type { ImgurServiceConfig } from '@/config/types';

const invokeMock = getInvokeMock();

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/types/errors', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  isAuthError: () => false,
}));

const { ImgurUploader } = await import('@/uploaders/imgur/ImgurUploader');

function makeConfig(overrides: Partial<ImgurServiceConfig> = {}): ImgurServiceConfig {
  return {
    enabled: true,
    clientId: 'client-123',
    clientSecret: 'secret-456',
    ...overrides,
  };
}

function makeOptions(config: Partial<ImgurServiceConfig> = {}): UploadOptions {
  return { config: makeConfig(config) } as UploadOptions;
}

describe('ImgurUploader.upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('上传成功时调用 Rust 命令，并返回包含 deleteHash 的标准 UploadResult', async () => {
    invokeMock.mockResolvedValue({
      url: 'https://i.imgur.com/abc123.jpg',
      deleteHash: 'delete-me',
    });

    const result = await new ImgurUploader().upload('/tmp/a.jpg', makeOptions());

    expect(invokeMock).toHaveBeenCalledWith('upload_to_imgur', expect.objectContaining({
      filePath: '/tmp/a.jpg',
      imgurClientId: 'client-123',
      imgurClientSecret: 'secret-456',
    }));
    expect(result).toEqual({
      serviceId: 'imgur',
      fileKey: 'delete-me',
      url: 'https://i.imgur.com/abc123.jpg',
      metadata: { deleteHash: 'delete-me' },
    });
  });

  it('Rust 响应缺少 deleteHash 时，fileKey 回退到 url', async () => {
    invokeMock.mockResolvedValue({ url: 'https://i.imgur.com/no-delete.png' });

    const result = await new ImgurUploader().upload('/tmp/a.png', makeOptions({
      clientSecret: undefined,
    }));

    expect(invokeMock).toHaveBeenCalledWith('upload_to_imgur', expect.objectContaining({
      imgurClientSecret: undefined,
    }));
    expect(result.fileKey).toBe('https://i.imgur.com/no-delete.png');
    expect(result.metadata?.deleteHash).toBeUndefined();
  });

  it('Rust 响应缺少 url 时保留当前返回形态，暴露上游响应异常', async () => {
    invokeMock.mockResolvedValue({ deleteHash: 'delete-only' });

    const result = await new ImgurUploader().upload('/tmp/broken.png', makeOptions());

    expect(result.fileKey).toBe('delete-only');
    expect(result.url).toBeUndefined();
  });

  it('Rust 上传失败时抛出带 Imgur 上下文的错误', async () => {
    invokeMock.mockRejectedValue(new Error('rate limited'));

    await expect(new ImgurUploader().upload('/tmp/a.jpg', makeOptions()))
      .rejects.toThrow('Imgur上传失败: rate limited');
  });
});

describe('ImgurUploader.getThumbnailUrl', () => {
  const uploader = new ImgurUploader();

  it('为标准 i.imgur.com URL 按尺寸追加缩略图后缀', () => {
    const result = {
      serviceId: 'imgur',
      fileKey: 'k',
      url: 'https://i.imgur.com/abc123.jpg',
    };

    expect(uploader.getThumbnailUrl(result, 'small')).toBe('https://i.imgur.com/abc123s.jpg');
    expect(uploader.getThumbnailUrl(result, 'medium')).toBe('https://i.imgur.com/abc123m.jpg');
    expect(uploader.getThumbnailUrl(result, 'large')).toBe('https://i.imgur.com/abc123l.jpg');
  });

  it('非标准 Imgur URL 直接回退原图', () => {
    expect(uploader.getThumbnailUrl({
      serviceId: 'imgur',
      fileKey: 'k',
      url: 'https://example.com/imgur/abc123.jpg',
    })).toBe('https://example.com/imgur/abc123.jpg');
  });
});

describe('ImgurUploader.testConnection', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('缺少配置时直接失败', async () => {
    const result = await new ImgurUploader().testConnection();

    expect(result.success).toBe(false);
    expect(result.error).toBe('缺少 Imgur 配置');
  });

  it('credits API 返回 2xx 时连接测试成功，并带 Client-ID header', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await new ImgurUploader().testConnection(makeConfig());

    expect(result.success).toBe(true);
    expect(typeof result.latency).toBe('number');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.imgur.com/3/credits',
      expect.objectContaining({
        headers: { Authorization: 'Client-ID client-123' },
      }),
    );
  });

  it('credits API 返回非 2xx 时保留 HTTP 状态', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 429 })) as typeof fetch;

    const result = await new ImgurUploader().testConnection(makeConfig());

    expect(result.success).toBe(false);
    expect(result.error).toBe('HTTP 429');
    expect(typeof result.latency).toBe('number');
  });

  it('fetch 抛错时返回错误消息', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as typeof fetch;

    const result = await new ImgurUploader().testConnection(makeConfig());

    expect(result.success).toBe(false);
    expect(result.error).toBe('network down');
  });
});
