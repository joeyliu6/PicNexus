// GithubUploader 测试
// 覆盖：upload 成功路径 + CDN 转换（applyUrlTransform 私有方法间接验证）、testConnection 三种结局

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getInvokeMock } from '../../helpers/tauriMock';
import type { UploadOptions } from '../../../uploaders/base/types';
import type { GithubServiceConfig } from '../../../config/types';

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

const { GithubUploader } = await import('../../../uploaders/github/GithubUploader');

const RAW_URL = 'https://raw.githubusercontent.com/alice/repo/main/images/x.jpg';

function makeConfig(overrides: Partial<GithubServiceConfig> = {}): GithubServiceConfig {
  return {
    token: 'ghp_xxx',
    owner: 'alice',
    repo: 'repo',
    branch: 'main',
    path: 'images/',
    ...overrides,
  } as GithubServiceConfig;
}

function makeOptions(config?: Partial<GithubServiceConfig>): UploadOptions {
  return { config: makeConfig(config) } as UploadOptions;
}

describe('GithubUploader.validateConfig', () => {
  const uploader = new GithubUploader();

  it('所有字段齐全 → valid', async () => {
    expect(await uploader.validateConfig(makeConfig())).toEqual({ valid: true });
  });

  it('缺 token 时报错', async () => {
    const r = await uploader.validateConfig(makeConfig({ token: '' }));
    expect(r.valid).toBe(false);
    expect(r.missingFields).toContain('token');
  });

  it('缺 owner / repo / branch 各自都能被报', async () => {
    const r = await uploader.validateConfig(makeConfig({ owner: '', repo: '', branch: '' }));
    expect(r.valid).toBe(false);
    expect(r.missingFields).toEqual(expect.arrayContaining(['owner', 'repo', 'branch']));
    expect(r.errors?.length).toBeGreaterThanOrEqual(3);
  });

  it('空白字符也视为缺失（isEmpty）', async () => {
    const r = await uploader.validateConfig(makeConfig({ token: '   ' }));
    expect(r.valid).toBe(false);
    expect(r.missingFields).toContain('token');
  });
});

describe('GithubUploader.upload - 不带 CDN', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      url: RAW_URL,
      sha: 'abc123',
      remotePath: 'images/x.jpg',
    });
  });

  it('返回标准化 UploadResult，fileKey 优先取 sha', async () => {
    const r = await new GithubUploader().upload('/tmp/x.jpg', makeOptions());
    expect(r.serviceId).toBe('github');
    expect(r.fileKey).toBe('abc123');
    expect(r.url).toBe(RAW_URL); // 未启用 CDN
    expect(r.metadata).toEqual({ sha: 'abc123', remotePath: 'images/x.jpg', rawUrl: RAW_URL });
  });

  it('无 sha 时 fileKey 回退到 remotePath', async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ url: RAW_URL, remotePath: 'images/y.jpg' });
    const r = await new GithubUploader().upload('/tmp/x.jpg', makeOptions());
    expect(r.fileKey).toBe('images/y.jpg');
  });

  it('无 sha 无 remotePath 时 fileKey 回退到 url', async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ url: RAW_URL });
    const r = await new GithubUploader().upload('/tmp/x.jpg', makeOptions());
    expect(r.fileKey).toBe(RAW_URL);
  });

  it('branch 未配置时使用 main 默认值传给后端', async () => {
    await new GithubUploader().upload('/tmp/x.jpg', makeOptions({ branch: '' }));
    expect(invokeMock).toHaveBeenCalledWith('upload_to_github', expect.objectContaining({
      branch: 'main',
    }));
  });

  it('path 未配置时使用 images/ 默认值传给后端', async () => {
    await new GithubUploader().upload('/tmp/x.jpg', makeOptions({ path: undefined }));
    expect(invokeMock).toHaveBeenCalledWith('upload_to_github', expect.objectContaining({
      path: 'images/',
    }));
  });
});

describe('GithubUploader.upload - CDN 转换', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ url: RAW_URL, sha: 'abc' });
  });

  it('启用 CDN 时按 template 替换全部占位符', async () => {
    const r = await new GithubUploader().upload('/tmp/x.jpg', makeOptions({
      cdnConfig: {
        enabled: true,
        selectedIndex: 0,
        cdnList: [{
          name: 'jsDelivr',
          url: 'https://cdn.jsdelivr.net/',
          template: '{domain}/gh/{owner}/{repo}@{branch}/{path}',
        }],
      },
    }));
    expect(r.url).toBe('https://cdn.jsdelivr.net/gh/alice/repo@main/images/x.jpg');
    expect(r.metadata?.rawUrl).toBe(RAW_URL); // 原始 URL 保留在 metadata
  });

  it('cdnConfig.enabled=false 时不做替换', async () => {
    const r = await new GithubUploader().upload('/tmp/x.jpg', makeOptions({
      cdnConfig: {
        enabled: false,
        selectedIndex: 0,
        cdnList: [{ name: 'x', url: 'https://a', template: '{domain}/foo' }],
      },
    }));
    expect(r.url).toBe(RAW_URL);
  });

  it('selectedIndex 超界时回退到第一个 CDN', async () => {
    const r = await new GithubUploader().upload('/tmp/x.jpg', makeOptions({
      cdnConfig: {
        enabled: true,
        selectedIndex: 99,
        cdnList: [{
          name: 'jsDelivr',
          url: 'https://cdn.jsdelivr.net',
          template: '{domain}/fallback/{owner}/{repo}',
        }],
      },
    }));
    expect(r.url).toBe('https://cdn.jsdelivr.net/fallback/alice/repo');
  });

  it('CDN 缺 url 或 template 时不做替换', async () => {
    const r = await new GithubUploader().upload('/tmp/x.jpg', makeOptions({
      cdnConfig: {
        enabled: true,
        selectedIndex: 0,
        // @ts-expect-error 测试缺字段的 CDN 条目
        cdnList: [{ name: 'broken' }],
      },
    }));
    expect(r.url).toBe(RAW_URL);
  });

  it('原始 URL 不是 raw.githubusercontent.com 格式时不做替换', async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ url: 'https://example.com/weird.jpg', sha: 'x' });
    const r = await new GithubUploader().upload('/tmp/x.jpg', makeOptions({
      cdnConfig: {
        enabled: true,
        selectedIndex: 0,
        cdnList: [{ name: 'j', url: 'https://cdn', template: '{domain}/{owner}/{repo}' }],
      },
    }));
    expect(r.url).toBe('https://example.com/weird.jpg');
  });

  it('CDN url 尾斜杠应被去除（template 自带前导斜杠）', async () => {
    const r = await new GithubUploader().upload('/tmp/x.jpg', makeOptions({
      cdnConfig: {
        enabled: true,
        selectedIndex: 0,
        cdnList: [{
          name: 'x',
          url: 'https://cdn.example.com/',
          template: '{domain}/gh/{owner}/{repo}@{branch}/{path}',
        }],
      },
    }));
    expect(r.url).toBe('https://cdn.example.com/gh/alice/repo@main/images/x.jpg');
    expect(r.url).not.toContain('//gh'); // 确保没有双斜杠
  });

  it('template 支持 {rawUrl} 占位符', async () => {
    const r = await new GithubUploader().upload('/tmp/x.jpg', makeOptions({
      cdnConfig: {
        enabled: true,
        selectedIndex: 0,
        cdnList: [{
          name: 'wrapper',
          url: 'https://proxy.example.com',
          template: '{domain}/cache?u={rawUrl}',
        }],
      },
    }));
    expect(r.url).toBe(`https://proxy.example.com/cache?u=${RAW_URL}`);
  });
});

describe('GithubUploader.getPublicUrl', () => {
  it('已在 upload 阶段转换，getPublicUrl 直接返回 result.url', () => {
    const uploader = new GithubUploader();
    expect(uploader.getPublicUrl({
      serviceId: 'github',
      fileKey: 'x',
      url: 'https://cdn.example.com/x.jpg',
    })).toBe('https://cdn.example.com/x.jpg');
  });
});

describe('GithubUploader.testConnection', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('无 config 时立即返回失败', async () => {
    const r = await new GithubUploader().testConnection();
    expect(r.success).toBe(false);
    expect(r.error).toContain('缺少 GitHub 配置');
  });

  it('2xx 响应 → success=true，带 latency', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as typeof fetch;
    const r = await new GithubUploader().testConnection(makeConfig());
    expect(r.success).toBe(true);
    expect(typeof r.latency).toBe('number');
    expect(r.latency).toBeGreaterThanOrEqual(0);
  });

  it('调用 GitHub API 且带 token + UA', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;
    await new GithubUploader().testConnection(makeConfig());
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/alice/repo',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'token ghp_xxx',
          'User-Agent': 'PicNexus',
        }),
      }),
    );
  });

  it('非 2xx 响应 → success=false，error 含 HTTP 状态码', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 401 })) as typeof fetch;
    const r = await new GithubUploader().testConnection(makeConfig());
    expect(r.success).toBe(false);
    expect(r.error).toBe('HTTP 401');
  });

  it('fetch 抛异常 → success=false，错误消息被转义', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as typeof fetch;
    const r = await new GithubUploader().testConnection(makeConfig());
    expect(r.success).toBe(false);
    expect(r.error).toBe('network down');
    expect(typeof r.latency).toBe('number');
  });
});
