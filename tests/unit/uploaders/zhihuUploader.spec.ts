// ZhihuUploader 测试：validateConfig / upload / 缩略图 URL

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getInvokeMock, getListenMock } from '../helpers/tauriMock';
import type { UploadOptions } from '@/uploaders/base/types';
import type { ZhihuServiceConfig } from '@/config/types';

const invokeMock = getInvokeMock();
const listenMock = getListenMock();

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

const { ZhihuUploader } = await import('@/uploaders/zhihu/ZhihuUploader');

function makeOptions(cookie = 'z_c0=test-cookie'): UploadOptions {
  return { config: { cookie } as ZhihuServiceConfig } as UploadOptions;
}

describe('ZhihuUploader.validateConfig', () => {
  const uploader = new ZhihuUploader();

  it('cookie 非空 → valid', async () => {
    expect(await uploader.validateConfig({ cookie: 'z_c0=abc' } as ZhihuServiceConfig))
      .toEqual({ valid: true });
  });

  it('cookie 为空字符串 → invalid 且报错', async () => {
    const r = await uploader.validateConfig({ cookie: '' } as ZhihuServiceConfig);
    expect(r.valid).toBe(false);
    expect(r.missingFields).toContain('Cookie');
    expect(r.errors?.[0]).toContain('知乎 Cookie');
  });

  it('cookie 仅空白 → invalid', async () => {
    const r = await uploader.validateConfig({ cookie: '   ' } as ZhihuServiceConfig);
    expect(r.valid).toBe(false);
    expect(r.missingFields).toContain('Cookie');
  });
});

describe('ZhihuUploader.upload', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('成功返回标准 UploadResult，fileKey/url 都取 Rust 返回的 url', async () => {
    invokeMock.mockResolvedValue({
      url: 'https://pic1.zhimg.com/v2-abc.jpg',
      size: 12345,
    });

    const r = await new ZhihuUploader().upload('/tmp/x.jpg', makeOptions());
    expect(r).toEqual({
      serviceId: 'zhihu',
      fileKey: 'https://pic1.zhimg.com/v2-abc.jpg',
      url: 'https://pic1.zhimg.com/v2-abc.jpg',
      size: 12345,
    });
  });

  it('调用 upload_to_zhihu 命令并透传 zhihuCookie 和 filePath', async () => {
    invokeMock.mockResolvedValue({ url: 'u', size: 1 });
    await new ZhihuUploader().upload('/tmp/y.jpg', makeOptions('z_c0=secret'));
    expect(invokeMock).toHaveBeenCalledWith(
      'upload_to_zhihu',
      expect.objectContaining({
        zhihuCookie: 'z_c0=secret',
        filePath: '/tmp/y.jpg',
      }),
    );
  });

  it('Rust 抛错时包装为带"知乎图床上传失败"前缀的 Error', async () => {
    invokeMock.mockRejectedValue(new Error('Cookie 失效'));
    await expect(new ZhihuUploader().upload('/tmp/x.jpg', makeOptions()))
      .rejects.toThrow(/知乎图床上传失败.*Cookie 失效/);
  });

  it('传入 onProgress 时注册进度监听并触发首次 0% 回调', async () => {
    invokeMock.mockResolvedValue({ url: 'u', size: 1 });
    listenMock.mockClear();
    const onProgress = vi.fn();
    await new ZhihuUploader().upload('/tmp/x.jpg', makeOptions(), onProgress);
    expect(listenMock).toHaveBeenCalledWith('upload://progress', expect.any(Function));
    expect(onProgress).toHaveBeenCalledWith(0, expect.stringContaining('准备'));
  });
});

describe('ZhihuUploader.getPublicUrl', () => {
  it('直接返回 result.url', () => {
    expect(new ZhihuUploader().getPublicUrl({
      serviceId: 'zhihu',
      fileKey: 'k',
      url: 'https://pic1.zhimg.com/v2-x.jpg',
    })).toBe('https://pic1.zhimg.com/v2-x.jpg');
  });
});

describe('ZhihuUploader.getThumbnailUrl', () => {
  const uploader = new ZhihuUploader();

  it('在常规扩展名前插入 _xs 后缀', () => {
    expect(uploader.getThumbnailUrl({
      serviceId: 'zhihu', fileKey: 'k',
      url: 'https://pic1.zhimg.com/v2-abc.jpg',
    })).toBe('https://pic1.zhimg.com/v2-abc_xs.jpg');
  });

  it('支持 png/webp/gif 等其他扩展名', () => {
    expect(uploader.getThumbnailUrl({
      serviceId: 'zhihu', fileKey: 'k', url: 'https://pic1.zhimg.com/x.png',
    })).toBe('https://pic1.zhimg.com/x_xs.png');
    expect(uploader.getThumbnailUrl({
      serviceId: 'zhihu', fileKey: 'k', url: 'https://pic1.zhimg.com/x.webp',
    })).toBe('https://pic1.zhimg.com/x_xs.webp');
  });

  it('无扩展名 URL 保持原样（正则不匹配）', () => {
    expect(uploader.getThumbnailUrl({
      serviceId: 'zhihu', fileKey: 'k', url: 'https://pic1.zhimg.com/no-ext',
    })).toBe('https://pic1.zhimg.com/no-ext');
  });
});

describe('ZhihuUploader 服务标识', () => {
  it('serviceId 为 zhihu', () => {
    expect(new ZhihuUploader().serviceId).toBe('zhihu');
  });

  it('serviceName 为知乎图床', () => {
    expect(new ZhihuUploader().serviceName).toBe('知乎图床');
  });
});
