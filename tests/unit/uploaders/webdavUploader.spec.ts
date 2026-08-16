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

  it('字面公网 IP 与链路本地地址被拒，主机名 HTTP 交给后端裁决', async () => {
    const publicHttpIp = await uploader.validateConfig(makeProfile({ url: 'http://8.8.8.8' }));
    expect(publicHttpIp.valid).toBe(false);
    expect(publicHttpIp.errors?.join()).toContain('WebDAV 地址无效');

    const lanHostname = await uploader.validateConfig(makeProfile({ url: 'http://nas.local:5005/dav' }));
    expect(lanHostname).toEqual({ valid: true });

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
      lanHttpConfirmed: false,
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

  /**
   * ⚠️ 这几条是 `upload_to_webdav` 参数的**唯一门禁**
   *
   * `scripts/check-invoke-args.mjs` 静态核对不了这个命令——BaseUploader 里的
   * `invoke(this.getRustCommand(), ...)` 命令名不是字面量，被列进跳过名单。
   * 漏传参数会 CI 全绿、运行时全部 WebDAV 上传崩溃，只有这里能拦住。
   */
  describe('lanHttpConfirmed 透传', () => {
    beforeEach(() => {
      invokeMock.mockResolvedValue({ url: 'u', remotePath: 'p', fileName: 'f' });
    });

    it('未确认时传 false，且键必须存在', async () => {
      await uploader.upload('/tmp/a.png', makeOptions());

      const params = invokeMock.mock.calls[0][1] as Record<string, unknown>;
      // 不能是 undefined：JSON 序列化会把这个键整个丢掉，
      // Rust 侧必填 bool 反序列化失败 → 命令根本不执行
      expect(Object.keys(params)).toContain('lanHttpConfirmed');
      expect(params.lanHttpConfirmed).toBe(false);
    });

    it('已确认时传 true', async () => {
      await uploader.upload('/tmp/a.png', makeOptions({ lanHttpConfirmed: true }));

      expect(invokeMock.mock.calls[0][1]).toMatchObject({ lanHttpConfirmed: true });
    });
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

  it('lanHttpConfirmed 一并透传给后端', async () => {
    invokeMock.mockResolvedValue({ success: true, message: 'ok' });

    await uploader.testConnection(makeProfile());
    expect(invokeMock.mock.calls[0][1]).toMatchObject({ lanHttpConfirmed: false });

    invokeMock.mockClear();
    await uploader.testConnection(makeProfile({ lanHttpConfirmed: true }));
    expect(invokeMock.mock.calls[0][1]).toMatchObject({ lanHttpConfirmed: true });
  });

  /**
   * 「明文 HTTP 待确认」这一档要能被调用方识别出来
   *
   * testConnection 会把后端的结构化 AppError 压成字符串，类型信息就此丢失。
   * 调用方要据此决定能不能弹逃生舱确认框——判类型而不是判文案，
   * 否则改一次文案这个分支就静默失效。
   */
  it('fake-ip 拒绝会被标成 lanHttpUnconfirmed，其余失败不会', async () => {
    invokeMock.mockRejectedValue({
      type: 'WEBDAV_LAN_HTTP_UNCONFIRMED',
      data: { message: '该地址属于代理软件的 fake-ip 地址池（198.18.x.x）' },
    });

    const blocked = await uploader.testConnection(makeProfile());
    expect(blocked.success).toBe(false);
    expect(blocked.lanHttpUnconfirmed).toBe(true);
    // 文案仍要原样带出，没接住这个标记的地方也不该退化
    expect(blocked.error).toContain('fake-ip');

    invokeMock.mockRejectedValue({
      type: 'WEBDAV',
      data: { message: '认证失败，请检查用户名和密码' },
    });

    const authFailed = await uploader.testConnection(makeProfile());
    expect(authFailed.success).toBe(false);
    expect(authFailed.lanHttpUnconfirmed).toBe(false);
  });
});
