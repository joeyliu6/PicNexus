import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetch } from '@tauri-apps/plugin-http';
import { WebDAVClient } from '../../../utils/webdav';

// ─── Mock 外部依赖 ────────────────────────────────────────
// webdav.ts 依赖 @tauri-apps/plugin-http 的 fetch（不是原生 fetch）
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

// webdav.ts 依赖 ../crypto 的 secureStorage 做密码加解密
vi.mock('../../../crypto', () => ({
  secureStorage: {
    encrypt: vi.fn(),
    decrypt: vi.fn(),
  },
}));

// 动态 import secureStorage 以便在测试里控制 mock 行为
const { secureStorage } = await import('../../../crypto');

const mockedFetch = vi.mocked(fetch);
const mockedEncrypt = vi.mocked(secureStorage.encrypt);
const mockedDecrypt = vi.mocked(secureStorage.decrypt);

// ─── Helper ──────────────────────────────────────────────
function makeClient(overrides: Partial<{ url: string; username: string; password: string; remotePath: string }> = {}) {
  return new WebDAVClient({
    url: 'https://dav.example.com',
    username: 'alice',
    password: 'secret',
    remotePath: '/sync',
    ...overrides,
  });
}

function makeResponse(status: number, body: string | null = null): Response {
  return new Response(body, { status });
}

// 使每次 mkDir/ensureDir 调用都返回 201，避免测试里手动排队多次 fetch
function mockAllMkDirOk() {
  mockedFetch.mockImplementation(async (_url: unknown, init?: unknown) => {
    const method = (init as { method?: string } | undefined)?.method;
    if (method === 'MKCOL') return makeResponse(201);
    return makeResponse(200);
  });
}

beforeEach(() => {
  mockedFetch.mockReset();
  mockedEncrypt.mockReset();
  mockedDecrypt.mockReset();
  // 静音 webdav.ts 里的 console.error / console.warn 调用，避免污染测试输出
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// ═══════════════════════════════════════════════════════════════
// Static factory & password helpers
// ═══════════════════════════════════════════════════════════════

describe('WebDAVClient.fromEncryptedConfig', () => {
  it('passwordEncrypted 存在 → 调用 secureStorage.decrypt 并用解密后的密码构造', async () => {
    mockedDecrypt.mockResolvedValueOnce('plaintext');
    const client = await WebDAVClient.fromEncryptedConfig({
      url: 'https://dav.example.com',
      username: 'alice',
      passwordEncrypted: 'cipher',
      remotePath: '/sync',
    });
    expect(client).toBeInstanceOf(WebDAVClient);
    expect(mockedDecrypt).toHaveBeenCalledWith('cipher');
  });

  it('passwordEncrypted 解密失败 → 抛 "WebDAV 密码解密失败"', async () => {
    mockedDecrypt.mockRejectedValueOnce(new Error('bad key'));
    await expect(
      WebDAVClient.fromEncryptedConfig({
        url: 'https://dav.example.com',
        username: 'alice',
        passwordEncrypted: 'cipher',
      }),
    ).rejects.toThrow('WebDAV 密码解密失败');
  });

  it('只有明文 password（向后兼容）→ 构造成功并警告', async () => {
    const client = await WebDAVClient.fromEncryptedConfig({
      url: 'https://dav.example.com',
      username: 'alice',
      password: 'plain',
    });
    expect(client).toBeInstanceOf(WebDAVClient);
    expect(console.warn).toHaveBeenCalled();
  });

  it('password 和 passwordEncrypted 都没有 → 抛 "WebDAV 密码未配置"', async () => {
    await expect(
      WebDAVClient.fromEncryptedConfig({ url: 'https://dav.example.com', username: 'alice' }),
    ).rejects.toThrow('WebDAV 密码未配置');
  });

  it('passwordEncrypted 优先于明文 password', async () => {
    mockedDecrypt.mockResolvedValueOnce('from-cipher');
    await WebDAVClient.fromEncryptedConfig({
      url: 'https://dav.example.com',
      username: 'alice',
      password: 'plain',
      passwordEncrypted: 'cipher',
    });
    expect(mockedDecrypt).toHaveBeenCalledWith('cipher');
  });
});

describe('WebDAVClient.encryptPassword', () => {
  it('代理到 secureStorage.encrypt', async () => {
    mockedEncrypt.mockResolvedValueOnce('encrypted-token');
    const result = await WebDAVClient.encryptPassword('my-password');
    expect(result).toBe('encrypted-token');
    expect(mockedEncrypt).toHaveBeenCalledWith('my-password');
  });
});

describe('WebDAVClient.decryptPassword', () => {
  it('空字符串 → 直接返回空字符串，不调用 decrypt', async () => {
    const result = await WebDAVClient.decryptPassword('');
    expect(result).toBe('');
    expect(mockedDecrypt).not.toHaveBeenCalled();
  });

  it('有值 → 调用 decrypt 并返回结果', async () => {
    mockedDecrypt.mockResolvedValueOnce('plain');
    const result = await WebDAVClient.decryptPassword('cipher');
    expect(result).toBe('plain');
  });

  it('decrypt 抛错 → 返回空字符串（fallback）', async () => {
    mockedDecrypt.mockRejectedValueOnce(new Error('bad key'));
    const result = await WebDAVClient.decryptPassword('cipher');
    expect(result).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
// URL 构造 & Basic Auth（通过 fetch 调用参数间接验证）
// ═══════════════════════════════════════════════════════════════

describe('WebDAVClient URL 路径拼接', () => {
  it('base 末尾 / + path 开头 / → 去重合并', async () => {
    const client = makeClient({ url: 'https://dav.example.com/' });
    mockedFetch.mockResolvedValueOnce(makeResponse(200));
    await client.testConnection();
    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://dav.example.com/sync');
  });

  it('base 末尾无 / + path 开头无 / → 自动插入 /', async () => {
    const client = makeClient({ url: 'https://dav.example.com', remotePath: 'sync' });
    mockedFetch.mockResolvedValueOnce(makeResponse(200));
    await client.testConnection();
    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://dav.example.com/sync');
  });

  it('base 末尾 / + path 开头无 / → 直接拼接', async () => {
    const client = makeClient({ url: 'https://dav.example.com/', remotePath: 'sync' });
    mockedFetch.mockResolvedValueOnce(makeResponse(200));
    await client.testConnection();
    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://dav.example.com/sync');
  });

  it('base 末尾无 / + path 开头 / → 直接拼接', async () => {
    const client = makeClient({ url: 'https://dav.example.com', remotePath: '/sync' });
    mockedFetch.mockResolvedValueOnce(makeResponse(200));
    await client.testConnection();
    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://dav.example.com/sync');
  });
});

describe('WebDAVClient Basic Auth', () => {
  it('ASCII 用户名 / 密码 → 正确的 Base64 认证头', async () => {
    const client = makeClient({ username: 'alice', password: 'pass' });
    mockedFetch.mockResolvedValueOnce(makeResponse(200));
    await client.testConnection();
    const init = mockedFetch.mock.calls[0][1] as { headers: Record<string, string> };
    // alice:pass → YWxpY2U6cGFzcw==
    expect(init.headers.Authorization).toBe('Basic YWxpY2U6cGFzcw==');
  });

  it('UTF-8 中文用户名 → 按字节编码，不丢失字符', async () => {
    const client = makeClient({ username: '张三', password: '密码' });
    mockedFetch.mockResolvedValueOnce(makeResponse(200));
    await client.testConnection();
    const init = mockedFetch.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toMatch(/^Basic [A-Za-z0-9+/=]+$/);
    // decode 验证：Basic Auth 拆出后应该能还原
    const base64 = init.headers.Authorization.substring('Basic '.length);
    const decodedBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const decoded = new TextDecoder('utf-8').decode(decodedBytes);
    expect(decoded).toBe('张三:密码');
  });

  it('用户名密码前后空白会被 trim', async () => {
    const client = makeClient({ username: '  alice  ', password: '  pass  ' });
    mockedFetch.mockResolvedValueOnce(makeResponse(200));
    await client.testConnection();
    const init = mockedFetch.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe('Basic YWxpY2U6cGFzcw==');
  });
});

describe('WebDAVClient.updateConfig', () => {
  it('更新配置后新凭据立即生效', async () => {
    const client = makeClient({ username: 'alice', password: 'old' });
    client.updateConfig({ url: 'https://dav.example.com', username: 'bob', password: 'new', remotePath: '/sync' });
    mockedFetch.mockResolvedValueOnce(makeResponse(200));
    await client.testConnection();
    const init = mockedFetch.mock.calls[0][1] as { headers: Record<string, string> };
    // bob:new → Ym9iOm5ldw==
    expect(init.headers.Authorization).toBe('Basic Ym9iOm5ldw==');
  });
});

// ═══════════════════════════════════════════════════════════════
// testConnection
// ═══════════════════════════════════════════════════════════════

describe('WebDAVClient.testConnection', () => {
  it('200 OK → true', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(200));
    expect(await client.testConnection()).toBe(true);
  });

  it('207 Multi-Status → true（response.ok 覆盖 200-299）', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(207));
    expect(await client.testConnection()).toBe(true);
  });

  it('404 Not Found → true（路径不存在但连接通畅）', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(404));
    expect(await client.testConnection()).toBe(true);
  });

  it('401 Unauthorized → false', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(401));
    expect(await client.testConnection()).toBe(false);
  });

  it('500 Internal Server Error → false', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(500));
    expect(await client.testConnection()).toBe(false);
  });

  it('fetch 抛异常 → false', async () => {
    const client = makeClient();
    mockedFetch.mockRejectedValueOnce(new Error('network down'));
    expect(await client.testConnection()).toBe(false);
  });

  it('remotePath 缺省 → 默认用 /', async () => {
    const client = makeClient({ remotePath: undefined });
    mockedFetch.mockResolvedValueOnce(makeResponse(200));
    await client.testConnection();
    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://dav.example.com/');
  });

  it('使用 PROPFIND 方法和 Depth: 0 头', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(200));
    await client.testConnection();
    const init = mockedFetch.mock.calls[0][1] as { method: string; headers: Record<string, string> };
    expect(init.method).toBe('PROPFIND');
    expect(init.headers.Depth).toBe('0');
  });
});

// ═══════════════════════════════════════════════════════════════
// putFile
// ═══════════════════════════════════════════════════════════════

describe('WebDAVClient.putFile', () => {
  it('根目录文件（无父目录）→ 直接 PUT，201 成功', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(201));
    await expect(client.putFile('/file.json', '{"a":1}')).resolves.toBeUndefined();
    // 只调了 1 次 fetch（PUT），没有 MKCOL
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const init = mockedFetch.mock.calls[0][1] as { method: string; body: string };
    expect(init.method).toBe('PUT');
    expect(init.body).toBe('{"a":1}');
  });

  it('有父目录 → 先递归创建父目录再 PUT', async () => {
    const client = makeClient();
    mockAllMkDirOk();
    await client.putFile('/a/b/file.json', 'content');
    // MKCOL /a/, MKCOL /a/b/, PUT /a/b/file.json 至少 3 次
    const methods = mockedFetch.mock.calls.map(c => (c[1] as { method: string }).method);
    expect(methods).toContain('MKCOL');
    expect(methods).toContain('PUT');
  });

  it('401 → 抛 "认证失败"', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(401));
    await expect(client.putFile('/file.json', 'x')).rejects.toThrow('认证失败');
  });

  it('403 → 抛 "认证失败"', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(403));
    await expect(client.putFile('/file.json', 'x')).rejects.toThrow('认证失败');
  });

  it('404 → 抛 "路径不存在"', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(404));
    await expect(client.putFile('/file.json', 'x')).rejects.toThrow('路径不存在');
  });

  it('507 → 抛 "存储空间不足"', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(507));
    await expect(client.putFile('/file.json', 'x')).rejects.toThrow('存储空间不足');
  });

  it('500 → 抛 "服务器错误"', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(500));
    await expect(client.putFile('/file.json', 'x')).rejects.toThrow('服务器错误');
  });

  it('418 其他非 ok → 抛通用 HTTP 错误', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(418));
    await expect(client.putFile('/file.json', 'x')).rejects.toThrow('上传失败: HTTP 418');
  });

  it('fetch 本身抛异常 → 抛 "WebDAV 上传失败"', async () => {
    const client = makeClient();
    mockedFetch.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(client.putFile('/file.json', 'x')).rejects.toThrow('WebDAV 上传失败');
  });
});

// ═══════════════════════════════════════════════════════════════
// getFile
// ═══════════════════════════════════════════════════════════════

describe('WebDAVClient.getFile', () => {
  it('200 → 返回响应文本', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(new Response('file-content', { status: 200 }));
    const result = await client.getFile('/file.json');
    expect(result).toBe('file-content');
  });

  it('404 → 返回 null（不抛错）', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(404));
    const result = await client.getFile('/missing.json');
    expect(result).toBeNull();
  });

  it('401 → 抛 "认证失败"', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(401));
    await expect(client.getFile('/file.json')).rejects.toThrow('认证失败');
  });

  it('500 → 抛 "服务器错误"', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(500));
    await expect(client.getFile('/file.json')).rejects.toThrow('服务器错误');
  });

  it('418 → 抛通用 HTTP 错误', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(418));
    await expect(client.getFile('/file.json')).rejects.toThrow('下载失败: HTTP 418');
  });

  it('fetch 本身抛异常 → 抛 "WebDAV 下载失败"', async () => {
    const client = makeClient();
    mockedFetch.mockRejectedValueOnce(new Error('DNS failure'));
    await expect(client.getFile('/file.json')).rejects.toThrow('WebDAV 下载失败');
  });

  it('使用 GET 方法', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(new Response('x', { status: 200 }));
    await client.getFile('/file.json');
    const init = mockedFetch.mock.calls[0][1] as { method: string };
    expect(init.method).toBe('GET');
  });
});

// ═══════════════════════════════════════════════════════════════
// exists
// ═══════════════════════════════════════════════════════════════

describe('WebDAVClient.exists', () => {
  it('200 → true', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(200));
    expect(await client.exists('/file.json')).toBe(true);
  });

  it('207 Multi-Status → true', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(207));
    expect(await client.exists('/file.json')).toBe(true);
  });

  it('404 → false', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(404));
    expect(await client.exists('/file.json')).toBe(false);
  });

  it('500 → false', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(500));
    expect(await client.exists('/file.json')).toBe(false);
  });

  it('fetch 抛异常 → false', async () => {
    const client = makeClient();
    mockedFetch.mockRejectedValueOnce(new Error('timeout'));
    expect(await client.exists('/file.json')).toBe(false);
  });

  it('使用 PROPFIND 方法', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(200));
    await client.exists('/file.json');
    const init = mockedFetch.mock.calls[0][1] as { method: string };
    expect(init.method).toBe('PROPFIND');
  });
});

// ═══════════════════════════════════════════════════════════════
// mkDir
// ═══════════════════════════════════════════════════════════════

describe('WebDAVClient.mkDir', () => {
  it('201 Created → true', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(201));
    expect(await client.mkDir('/newdir/')).toBe(true);
  });

  it('405 Method Not Allowed（目录已存在）→ true', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(405));
    expect(await client.mkDir('/existing/')).toBe(true);
  });

  it('301 Moved Permanently → true', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(301));
    expect(await client.mkDir('/dir/')).toBe(true);
  });

  it('302 Found → true', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(302));
    expect(await client.mkDir('/dir/')).toBe(true);
  });

  it('409 Conflict（父目录缺失）→ false', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(409));
    expect(await client.mkDir('/missing-parent/child/')).toBe(false);
  });

  it('500 → false', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(500));
    expect(await client.mkDir('/dir/')).toBe(false);
  });

  it('fetch 抛异常 → false', async () => {
    const client = makeClient();
    mockedFetch.mockRejectedValueOnce(new Error('connection refused'));
    expect(await client.mkDir('/dir/')).toBe(false);
  });

  it('路径不以 / 结尾 → 自动补 /', async () => {
    const client = makeClient({ url: 'https://dav.example.com' });
    mockedFetch.mockResolvedValueOnce(makeResponse(201));
    await client.mkDir('/no-trailing-slash');
    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://dav.example.com/no-trailing-slash/');
  });

  it('使用 MKCOL 方法', async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValueOnce(makeResponse(201));
    await client.mkDir('/dir/');
    const init = mockedFetch.mock.calls[0][1] as { method: string };
    expect(init.method).toBe('MKCOL');
  });
});

// ═══════════════════════════════════════════════════════════════
// ensureDir
// ═══════════════════════════════════════════════════════════════

describe('WebDAVClient.ensureDir', () => {
  it('/a/b/c → 依次调用 MKCOL /a/, /a/b/, /a/b/c/', async () => {
    const client = makeClient({ url: 'https://dav.example.com' });
    mockAllMkDirOk();
    await client.ensureDir('/a/b/c');
    const mkcolUrls = mockedFetch.mock.calls
      .filter(c => (c[1] as { method: string }).method === 'MKCOL')
      .map(c => c[0] as string);
    expect(mkcolUrls).toEqual([
      'https://dav.example.com/a/',
      'https://dav.example.com/a/b/',
      'https://dav.example.com/a/b/c/',
    ]);
  });

  it('缺少开头 / 的路径会被补上', async () => {
    const client = makeClient({ url: 'https://dav.example.com' });
    mockAllMkDirOk();
    await client.ensureDir('no-leading-slash');
    const mkcolUrls = mockedFetch.mock.calls
      .filter(c => (c[1] as { method: string }).method === 'MKCOL')
      .map(c => c[0] as string);
    expect(mkcolUrls).toEqual(['https://dav.example.com/no-leading-slash/']);
  });

  it('缺少结尾 / 的路径会被补上', async () => {
    const client = makeClient({ url: 'https://dav.example.com' });
    mockAllMkDirOk();
    await client.ensureDir('/foo');
    const mkcolUrls = mockedFetch.mock.calls
      .filter(c => (c[1] as { method: string }).method === 'MKCOL')
      .map(c => c[0] as string);
    expect(mkcolUrls).toEqual(['https://dav.example.com/foo/']);
  });

  it('中间层 mkDir 失败（409）不中断，继续尝试后续层', async () => {
    const client = makeClient({ url: 'https://dav.example.com' });
    // 第一层 409 失败，后两层 201 成功
    mockedFetch
      .mockResolvedValueOnce(makeResponse(409))
      .mockResolvedValueOnce(makeResponse(201))
      .mockResolvedValueOnce(makeResponse(201));
    await client.ensureDir('/a/b/c');
    // 即使第一层失败，总共还是调用了 3 次 MKCOL
    expect(mockedFetch).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalled();
  });
});
