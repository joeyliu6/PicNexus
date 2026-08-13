// BaseS3Uploader.upload 接线测试
// 覆盖：传给 Rust 的 key 已唯一化（同名文件两次上传不同 key），且仍带 path 前缀与原扩展名

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getInvokeMock, resetInvokeMock } from '../helpers/tauriMock';
import type { UploadOptions } from '@/uploaders/base/types';
import type { AliyunServiceConfig } from '@/config/types';

const invokeMock = getInvokeMock();

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { AliyunUploader } = await import('@/uploaders/aliyun/AliyunUploader');

function makeOptions(path = 'images'): UploadOptions {
  return {
    config: {
      accessKeyId: 'akid',
      accessKeySecret: 'aksecret',
      region: 'cn-hangzhou',
      bucket: 'mybucket',
      path,
    } as AliyunServiceConfig,
  } as UploadOptions;
}

/** 取第 n 次 invoke 调用传给 Rust 的 key */
function keyOfCall(n: number): string {
  return (invokeMock.mock.calls[n][1] as { key: string }).key;
}

describe('BaseS3Uploader.upload 的 key 生成', () => {
  beforeEach(() => {
    resetInvokeMock();
    invokeMock.mockResolvedValue({ url: 'https://cdn.example.com/x.png', key: 'x.png' });
  });

  it('同一个文件上传两次，传给 Rust 的 key 不同', async () => {
    const uploader = new AliyunUploader();

    await uploader.upload('C:\\pics\\screenshot.png', makeOptions());
    await uploader.upload('C:\\pics\\screenshot.png', makeOptions());

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(keyOfCall(0)).not.toBe(keyOfCall(1));
  });

  it('key 保留 path 前缀与原文件名（含扩展名）', async () => {
    const uploader = new AliyunUploader();

    await uploader.upload('/home/me/照片/截图.png', makeOptions('images'));

    const key = keyOfCall(0);
    expect(key.startsWith('images/')).toBe(true);
    expect(key.endsWith('_截图.png')).toBe(true);
  });

  it('fileKey / url 取 Rust 回传值，不用前端自算的 key', async () => {
    invokeMock.mockResolvedValue({ url: 'https://cdn.example.com/real.png', key: 'images/real.png' });
    const uploader = new AliyunUploader();

    const result = await uploader.upload('C:\\pics\\a.png', makeOptions());

    expect(result.fileKey).toBe('images/real.png');
    expect(result.url).toBe('https://cdn.example.com/real.png');
  });
});
