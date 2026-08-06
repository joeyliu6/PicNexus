// WebDAVUploader 测试
// 覆盖：配置校验（含公开域名必填与局域网地址放行）、upload 参数透传与密码解密、testConnection 结局

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getInvokeMock } from '../helpers/tauriMock';
import type { UploadOptions } from '@/uploaders/base/types';
import type { WebDAVStorageProfile } from '@/config/types';

const invokeMock = getInvokeMock();

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/security/crypto', () => ({
  secureStorage: {
    encrypt: vi.fn(async (text: string) => `cipher(${text})`),
    decrypt: vi.fn(async (cipher: string) => {
      const match = /^cipher\((.*)\)$/.exec(cipher);
      if (!match) throw new Error('bad cipher');
      return match[1];
    }),
  },
}));

const { WebDAVUploader } = await import('@/uploaders/webdav/WebDAVUploader');

function makeProfile(overrides: Partial<WebDAVStorageProfile> = {}): WebDAVStorageProfile {
  return {
    id: 'dav-1',
    name: '家里的 NAS',
    url: 'https://dav.example.com/dav',
    username: 'me',
    passwordEncrypted: 'cipher(secret)',
    remotePath: 'images/',
    publicDomain: 'https://cdn.example.com',
    publicUrlTemplate: '{domain}/{path}',
    ...overrides,
  };
}

function makeOptions(overrides: Partial<WebDAVStorageProfile> = {}): UploadOptions {
  return { config: makeProfile(overrides) } as UploadOptions;
}

describe('WebDAVUploader.validateConfig', () => {
  const uploader = new WebDAVUploader();

  it('字段齐全 → valid', async () => {
    expect(await uploader.validateConfig(makeProfile())).toEqual({ valid: true });
  });

  it('缺 url / username / 密码各自都能被报', async () => {
    const r = await uploader.validateConfig(
      makeProfile({ url: '', username: '', passwordEncrypted: '' }),
    );
    expect(r.valid).toBe(false);
    expect(r.missingFields).toEqual(expect.arrayContaining(['url', 'username', 'passwordEncrypted']));
  });

  it('公开域名是必填项', async () => {
    const r = await uploader.validateConfig(makeProfile({ publicDomain: '' }));
    expect(r.valid).toBe(false);
    expect(r.missingFields).toContain('publicDomain');
    // 文案要讲清楚为什么必填，否则用户只会觉得多此一举
    expect(r.errors?.join()).toContain('不能直接作为图片链接');
  });

  it('放行局域网 HTTP 地址（群晖 / 自建 NAS）', async () => {
    const r = await uploader.validateConfig(makeProfile({
      url: 'http://192.168.1.10:5005/dav',
      publicDomain: 'http://192.168.1.10:5244',
    }));
    expect(r).toEqual({ valid: true });
  });

  it('拒绝公网 HTTP 与链路本地地址', async () => {
    const publicHttp = await uploader.validateConfig(makeProfile({ url: 'http://dav.example.com' }));
    expect(publicHttp.valid).toBe(false);
    expect(publicHttp.errors?.join()).toContain('WebDAV 地址无效');

    const linkLocal = await uploader.validateConfig(makeProfile({ url: 'http://169.254.169.254/' }));
    expect(linkLocal.valid).toBe(false);
  });
});

describe('WebDAVUploader.upload', () => {
  const uploader = new WebDAVUploader();

  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('透传配置并解密密码后调用 Rust 命令', async () => {
    invokeMock.mockResolvedValue({
      url: 'https://cdn.example.com/images/a.png',
      remotePath: 'images/a.png',
      fileName: 'a.png',
    });

    const result = await uploader.upload('/tmp/a.png', makeOptions());

    const [command, params] = invokeMock.mock.calls[0];
    expect(command).toBe('upload_to_webdav');
    expect(params).toMatchObject({
      filePath: '/tmp/a.png',
      url: 'https://dav.example.com/dav',
      username: 'me',
      // 落盘的是密文，传给后端的必须是解密后的明文
      password: 'secret',
      remotePath: 'images/',
      publicDomain: 'https://cdn.example.com',
      publicUrlTemplate: '{domain}/{path}',
    });

    expect(result).toMatchObject({
      serviceId: 'webdav',
      fileKey: 'images/a.png',
      url: 'https://cdn.example.com/images/a.png',
    });
  });

  it('模板缺省时回退到默认模板', async () => {
    invokeMock.mockResolvedValue({ url: 'u', remotePath: 'p', fileName: 'f' });

    await uploader.upload('/tmp/a.png', makeOptions({ publicUrlTemplate: '' }));

    expect(invokeMock.mock.calls[0][1]).toMatchObject({ publicUrlTemplate: '{domain}/{path}' });
  });

  it('配置不完整时不发起上传', async () => {
    await expect(
      uploader.upload('/tmp/a.png', makeOptions({ publicDomain: '' })),
    ).rejects.toThrow('公开访问域名不能为空');

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('密码密文损坏时给出可操作的提示', async () => {
    await expect(
      uploader.upload('/tmp/a.png', makeOptions({ passwordEncrypted: 'not-a-cipher' })),
    ).rejects.toThrow('请在设置中重新填写密码');
  });
});

describe('WebDAVUploader.testConnection', () => {
  const uploader = new WebDAVUploader();

  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('公开链接可达 → success', async () => {
    invokeMock.mockResolvedValue({ success: true, message: '连接成功，公开链接可正常访问' });

    const result = await uploader.testConnection(makeProfile());

    expect(result.success).toBe(true);
    expect(invokeMock.mock.calls[0][0]).toBe('test_webdav_storage');
  });

  it('传得上去但公开链接打不开 → 失败并保留后端诊断文案', async () => {
    invokeMock.mockResolvedValue({
      success: false,
      message: '图片已上传，但公开链接打不开 (HTTP 404)——请检查「公开访问域名」和 URL 模板',
    });

    const result = await uploader.testConnection(makeProfile());

    expect(result.success).toBe(false);
    // 这条文案是本功能最有价值的诊断，不能在前端被吞掉换成泛化的"连接失败"
    expect(result.error).toContain('公开链接打不开');
  });

  it('缺配置时不发起测试', async () => {
    expect(await uploader.testConnection()).toEqual({ success: false, error: '缺少 WebDAV 配置' });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('配置不完整时直接返回校验错误', async () => {
    const result = await uploader.testConnection(makeProfile({ publicDomain: '' }));

    expect(result.success).toBe(false);
    expect(result.error).toContain('公开访问域名不能为空');
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
