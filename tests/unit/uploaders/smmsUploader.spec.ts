// SmmsUploader 测试：validateConfig / upload / testConnection

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getInvokeMock } from '../helpers/tauriMock';
import type { UploadOptions } from '@/uploaders/base/types';
import type { SmmsServiceConfig } from '@/config/types';

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

const { SmmsUploader } = await import('@/uploaders/smms/SmmsUploader');

function makeOptions(token = 'test-token'): UploadOptions {
  return { config: { token } as SmmsServiceConfig } as UploadOptions;
}

describe('SmmsUploader.validateConfig', () => {
  const uploader = new SmmsUploader();

  it('有 token → valid', async () => {
    expect(await uploader.validateConfig({ token: 'abc' } as SmmsServiceConfig)).toEqual({
      valid: true,
    });
  });

  it('token 为空 → invalid + 报错', async () => {
    const r = await uploader.validateConfig({ token: '' } as SmmsServiceConfig);
    expect(r.valid).toBe(false);
    expect(r.missingFields).toContain('token');
    expect(r.errors?.[0]).toContain('API Token');
  });

  it('token 仅空白 → invalid', async () => {
    const r = await uploader.validateConfig({ token: '   ' } as SmmsServiceConfig);
    expect(r.valid).toBe(false);
  });
});

describe('SmmsUploader.upload', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('成功返回标准 UploadResult，fileKey 优先取 hash', async () => {
    invokeMock.mockResolvedValue({
      url: 'https://i.loli.net/abc.jpg',
      delete: 'https://sm.ms/delete/xyz',
      hash: 'hashabc',
    });

    const r = await new SmmsUploader().upload('/tmp/x.jpg', makeOptions());
    expect(r).toEqual({
      serviceId: 'smms',
      fileKey: 'hashabc',
      url: 'https://i.loli.net/abc.jpg',
      metadata: { deleteUrl: 'https://sm.ms/delete/xyz' },
    });
  });

  it('无 hash 时 fileKey 回退到 url', async () => {
    invokeMock.mockResolvedValue({ url: 'https://i.loli.net/x.jpg' });
    const r = await new SmmsUploader().upload('/tmp/x.jpg', makeOptions());
    expect(r.fileKey).toBe('https://i.loli.net/x.jpg');
  });

  it('透传 smmsToken 到 Rust 命令', async () => {
    invokeMock.mockResolvedValue({ url: 'u' });
    await new SmmsUploader().upload('/tmp/x.jpg', makeOptions('my-secret-token'));
    expect(invokeMock).toHaveBeenCalledWith('upload_to_smms', expect.objectContaining({
      smmsToken: 'my-secret-token',
      filePath: '/tmp/x.jpg',
    }));
  });

  it('无 delete URL 时 metadata.deleteUrl 为 undefined', async () => {
    invokeMock.mockResolvedValue({ url: 'u' });
    const r = await new SmmsUploader().upload('/tmp/x.jpg', makeOptions());
    expect(r.metadata?.deleteUrl).toBeUndefined();
  });
});

describe('SmmsUploader.testConnection', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('无 config 直接失败', async () => {
    const r = await new SmmsUploader().testConnection();
    expect(r.success).toBe(false);
    expect(r.error).toContain('缺少 SM.MS 配置');
  });

  it('2xx 响应 → success=true，带 latency', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as typeof fetch;
    const r = await new SmmsUploader().testConnection({ token: 'tok' } as SmmsServiceConfig);
    expect(r.success).toBe(true);
    expect(typeof r.latency).toBe('number');
  });

  it('请求 profile API 并带 Authorization header（注意 SM.MS 不带 token 前缀）', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;
    await new SmmsUploader().testConnection({ token: 'mytok' } as SmmsServiceConfig);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sm.ms/api/v2/profile',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'mytok' }),
      }),
    );
  });

  it('非 2xx 响应 → success=false，error 含 HTTP 状态', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 403 })) as typeof fetch;
    const r = await new SmmsUploader().testConnection({ token: 'tok' } as SmmsServiceConfig);
    expect(r.success).toBe(false);
    expect(r.error).toBe('HTTP 403');
    expect(typeof r.latency).toBe('number');
  });

  it('fetch 抛错 → success=false 且沿用错误消息', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const r = await new SmmsUploader().testConnection({ token: 'tok' } as SmmsServiceConfig);
    expect(r.success).toBe(false);
    expect(r.error).toBe('ECONNREFUSED');
  });
});

describe('SmmsUploader.getPublicUrl', () => {
  it('直接返回 result.url', () => {
    expect(new SmmsUploader().getPublicUrl({
      serviceId: 'smms',
      fileKey: 'h',
      url: 'https://i.loli.net/x.jpg',
    })).toBe('https://i.loli.net/x.jpg');
  });
});
