import { describe, it, expect, vi } from 'vitest';
import type { ValidationResult, UploadResult } from '../../../uploaders/base/types';
import type {
  BilibiliServiceConfig,
  NamiServiceConfig,
  SmmsServiceConfig,
  GithubServiceConfig,
  ImgurServiceConfig,
  JDServiceConfig,
} from '../../../config/types';

// Mock 所有上传器的共享依赖
vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../types/errors', () => ({
  getErrorMessage: (err: unknown) => err instanceof Error ? err.message : String(err),
  isAuthError: () => false,
}));

// ─── Cookie 类上传器（简单 cookie 验证）──────────────────

// 动态导入避免 mock 顺序问题
const { WeiboUploader } = await import('../../../uploaders/weibo/WeiboUploader');
const { NowcoderUploader } = await import('../../../uploaders/nowcoder/NowcoderUploader');
const { ZhihuUploader } = await import('../../../uploaders/zhihu/ZhihuUploader');
const { ChaoxingUploader } = await import('../../../uploaders/chaoxing/ChaoxingUploader');
const { BilibiliUploader } = await import('../../../uploaders/bilibili/BilibiliUploader');
const { NamiUploader } = await import('../../../uploaders/nami/NamiUploader');

// ─── Token 类上传器 ─────────────────────────────────────

const { SmmsUploader } = await import('../../../uploaders/smms/SmmsUploader');
const { GithubUploader } = await import('../../../uploaders/github/GithubUploader');
const { ImgurUploader } = await import('../../../uploaders/imgur/ImgurUploader');

// ─── 无配置上传器 ───────────────────────────────────────

const { JDUploader } = await import('../../../uploaders/jd/JDUploader');
const { QiyuUploader } = await import('../../../uploaders/qiyu/QiyuUploader');

// ─── S3 兼容上传器 ──────────────────────────────────────

const { R2Uploader } = await import('../../../uploaders/r2/R2Uploader');
const { TencentUploader } = await import('../../../uploaders/tencent/TencentUploader');
const { AliyunUploader } = await import('../../../uploaders/aliyun/AliyunUploader');
const { QiniuUploader } = await import('../../../uploaders/qiniu/QiniuUploader');
const { UpyunUploader } = await import('../../../uploaders/upyun/UpyunUploader');
const { CustomS3Uploader } = await import('../../../uploaders/custom-s3/CustomS3Uploader');

// ─── 辅助函数 ───────────────────────────────────────────

/**
 * 测试专用：把 `Partial<T>` 当作 `T` 传给 validateConfig。
 * 这些测试的目的就是验证 validateConfig 对不完整配置的反应，
 * 为了满足 TS 严格类型，在测试边界处做一次 unsafe cast。
 */
const partial = <T>(p: Partial<T>): T => p as T;


function makeUploadResult(overrides: Partial<UploadResult> = {}): UploadResult {
  return {
    serviceId: 'test',
    fileKey: 'key-001',
    url: 'https://example.com/img.jpg',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
// 简单 Cookie 类上传器测试
// ═══════════════════════════════════════════════════════════

interface SimpleCookieUploaderConfig {
  name: string;
  createUploader: () => { validateConfig: (config: any) => Promise<ValidationResult>; getPublicUrl: (result: UploadResult) => string; serviceId: string; serviceName: string };
  validConfig: Record<string, unknown>;
  expectedServiceId: string;
}

const simpleCookieUploaders: SimpleCookieUploaderConfig[] = [
  {
    name: 'WeiboUploader',
    createUploader: () => new WeiboUploader(),
    validConfig: { cookie: 'SUB=xxx; SUBP=yyy' },
    expectedServiceId: 'weibo',
  },
  {
    name: 'NowcoderUploader',
    createUploader: () => new NowcoderUploader(),
    validConfig: { cookie: 'NOWCODERUID=xxx' },
    expectedServiceId: 'nowcoder',
  },
  {
    name: 'ZhihuUploader',
    createUploader: () => new ZhihuUploader(),
    validConfig: { cookie: 'z_c0=xxx' },
    expectedServiceId: 'zhihu',
  },
  {
    name: 'ChaoxingUploader',
    createUploader: () => new ChaoxingUploader(),
    validConfig: { cookie: '_uid=12345; other=data' },
    expectedServiceId: 'chaoxing',
  },
];

describe.each(simpleCookieUploaders)('$name', ({ createUploader, validConfig, expectedServiceId }) => {
  it('serviceId 正确', () => {
    const uploader = createUploader();
    expect(uploader.serviceId).toBe(expectedServiceId);
  });

  it('配置为空时 validateConfig 返回失败', async () => {
    const uploader = createUploader();
    const result = await uploader.validateConfig({});
    expect(result.valid).toBe(false);
  });

  it('cookie 为空字符串时 validateConfig 返回失败', async () => {
    const uploader = createUploader();
    const result = await uploader.validateConfig({ cookie: '' });
    expect(result.valid).toBe(false);
  });

  it('配置完整时 validateConfig 返回成功', async () => {
    const uploader = createUploader();
    const result = await uploader.validateConfig(validConfig);
    expect(result.valid).toBe(true);
  });

  it('getPublicUrl 返回 result.url', () => {
    const uploader = createUploader();
    const result = makeUploadResult({ serviceId: expectedServiceId });
    expect(uploader.getPublicUrl(result)).toBe(result.url);
  });
});

// ═══════════════════════════════════════════════════════════
// Bilibili（需要特殊 cookie 字段）
// ═══════════════════════════════════════════════════════════

describe('BilibiliUploader', () => {
  const uploader = new BilibiliUploader();

  it('serviceId 为 bilibili', () => {
    expect(uploader.serviceId).toBe('bilibili');
  });

  it('cookie 为空时验证失败', async () => {
    const result = await uploader.validateConfig(partial<BilibiliServiceConfig>({}));
    expect(result.valid).toBe(false);
  });

  it('cookie 缺少 SESSDATA 时验证失败', async () => {
    const result = await uploader.validateConfig(partial<BilibiliServiceConfig>({ cookie: 'bili_jct=abc' }));
    expect(result.valid).toBe(false);
  });

  it('cookie 缺少 bili_jct 时验证失败', async () => {
    const result = await uploader.validateConfig(partial<BilibiliServiceConfig>({ cookie: 'SESSDATA=abc' }));
    expect(result.valid).toBe(false);
  });

  it('cookie 包含 SESSDATA 和 bili_jct 时验证成功', async () => {
    const result = await uploader.validateConfig(partial<BilibiliServiceConfig>({ cookie: 'SESSDATA=abc; bili_jct=def' }));
    expect(result.valid).toBe(true);
  });

  it('getPublicUrl 返回 result.url', () => {
    expect(uploader.getPublicUrl(makeUploadResult())).toBe('https://example.com/img.jpg');
  });
});

// ═══════════════════════════════════════════════════════════
// Nami（需要 cookie + authToken）
// ═══════════════════════════════════════════════════════════

describe('NamiUploader', () => {
  const uploader = new NamiUploader();

  it('serviceId 为 nami', () => {
    expect(uploader.serviceId).toBe('nami');
  });

  it('cookie 为空时验证失败', async () => {
    const result = await uploader.validateConfig(partial<NamiServiceConfig>({}));
    expect(result.valid).toBe(false);
  });

  it('有 cookie 但缺少 authToken 时验证失败', async () => {
    const result = await uploader.validateConfig(partial<NamiServiceConfig>({ cookie: 'sess=abc' }));
    expect(result.valid).toBe(false);
  });

  it('cookie 和 authToken 都存在时验证成功', async () => {
    const result = await uploader.validateConfig(partial<NamiServiceConfig>({ cookie: 'sess=abc', authToken: 'tok123' }));
    expect(result.valid).toBe(true);
  });

  it('getPublicUrl 返回 result.url', () => {
    expect(uploader.getPublicUrl(makeUploadResult())).toBe('https://example.com/img.jpg');
  });
});

// ═══════════════════════════════════════════════════════════
// Token 类上传器
// ═══════════════════════════════════════════════════════════

describe('SmmsUploader', () => {
  const uploader = new SmmsUploader();

  it('serviceId 为 smms', () => {
    expect(uploader.serviceId).toBe('smms');
  });

  it('token 为空时验证失败', async () => {
    const result = await uploader.validateConfig(partial<SmmsServiceConfig>({}));
    expect(result.valid).toBe(false);
  });

  it('token 存在时验证成功', async () => {
    const result = await uploader.validateConfig(partial<SmmsServiceConfig>({ token: 'abc123' }));
    expect(result.valid).toBe(true);
  });

  it('getPublicUrl 返回 result.url', () => {
    expect(uploader.getPublicUrl(makeUploadResult())).toBe('https://example.com/img.jpg');
  });
});

describe('GithubUploader', () => {
  const uploader = new GithubUploader();

  it('serviceId 为 github', () => {
    expect(uploader.serviceId).toBe('github');
  });

  it('所有字段为空时验证失败', async () => {
    const result = await uploader.validateConfig(partial<GithubServiceConfig>({}));
    expect(result.valid).toBe(false);
  });

  it('缺少 owner 时验证失败', async () => {
    const result = await uploader.validateConfig(partial<GithubServiceConfig>({ token: 't', repo: 'r', branch: 'main' }));
    expect(result.valid).toBe(false);
  });

  it('所有字段齐全时验证成功', async () => {
    const result = await uploader.validateConfig(partial<GithubServiceConfig>({
      token: 'ghp_xxx', owner: 'user', repo: 'repo', branch: 'main',
    }));
    expect(result.valid).toBe(true);
  });

  it('getPublicUrl 返回 result.url', () => {
    expect(uploader.getPublicUrl(makeUploadResult())).toBe('https://example.com/img.jpg');
  });
});

describe('ImgurUploader', () => {
  const uploader = new ImgurUploader();

  it('serviceId 为 imgur', () => {
    expect(uploader.serviceId).toBe('imgur');
  });

  it('clientId 为空时验证失败', async () => {
    const result = await uploader.validateConfig(partial<ImgurServiceConfig>({}));
    expect(result.valid).toBe(false);
  });

  it('clientId 存在时验证成功', async () => {
    const result = await uploader.validateConfig(partial<ImgurServiceConfig>({ clientId: 'abc' }));
    expect(result.valid).toBe(true);
  });

  it('getPublicUrl 返回 result.url', () => {
    expect(uploader.getPublicUrl(makeUploadResult())).toBe('https://example.com/img.jpg');
  });
});

// ═══════════════════════════════════════════════════════════
// 无配置上传器
// ═══════════════════════════════════════════════════════════

describe('JDUploader', () => {
  const uploader = new JDUploader();

  it('serviceId 为 jd', () => {
    expect(uploader.serviceId).toBe('jd');
  });

  it('无需配置，validateConfig 直接返回成功', async () => {
    const result = await uploader.validateConfig(partial<JDServiceConfig>({}));
    expect(result.valid).toBe(true);
  });

  it('getPublicUrl 返回 result.url', () => {
    expect(uploader.getPublicUrl(makeUploadResult())).toBe('https://example.com/img.jpg');
  });
});

describe('QiyuUploader', () => {
  const uploader = new QiyuUploader();

  it('serviceId 为 qiyu', () => {
    expect(uploader.serviceId).toBe('qiyu');
  });

  it('getPublicUrl 返回 result.url', () => {
    expect(uploader.getPublicUrl(makeUploadResult())).toBe('https://example.com/img.jpg');
  });
});

// ═══════════════════════════════════════════════════════════
// S3 兼容上传器
// ═══════════════════════════════════════════════════════════

interface S3UploaderConfig {
  name: string;
  createUploader: () => { validateConfig: (config: any) => Promise<ValidationResult>; getPublicUrl: (result: UploadResult) => string; serviceId: string };
  validConfig: Record<string, unknown>;
  expectedServiceId: string;
}

const s3Uploaders: S3UploaderConfig[] = [
  {
    name: 'R2Uploader',
    createUploader: () => new R2Uploader(),
    validConfig: {
      accountId: 'acc', accessKeyId: 'key', secretAccessKey: 'secret',
      bucketName: 'bucket', publicDomain: 'https://cdn.example.com',
    },
    expectedServiceId: 'r2',
  },
  {
    name: 'TencentUploader',
    createUploader: () => new TencentUploader(),
    validConfig: {
      secretId: 'sid', secretKey: 'sk', region: 'ap-guangzhou',
      bucket: 'mybucket',
    },
    expectedServiceId: 'tencent',
  },
  {
    name: 'AliyunUploader',
    createUploader: () => new AliyunUploader(),
    validConfig: {
      accessKeyId: 'akid', accessKeySecret: 'aksecret', region: 'cn-hangzhou',
      bucket: 'mybucket',
    },
    expectedServiceId: 'aliyun',
  },
  {
    name: 'QiniuUploader',
    createUploader: () => new QiniuUploader(),
    validConfig: {
      accessKey: 'ak', secretKey: 'sk', bucket: 'mybucket',
    },
    expectedServiceId: 'qiniu',
  },
  {
    name: 'UpyunUploader',
    createUploader: () => new UpyunUploader(),
    validConfig: {
      operator: 'op', password: 'pw', bucket: 'mybucket',
    },
    expectedServiceId: 'upyun',
  },
  {
    name: 'CustomS3Uploader',
    createUploader: () => new CustomS3Uploader(),
    validConfig: {
      endpoint: 'https://s3.example.com', accessKeyId: 'ak', secretAccessKey: 'sk',
      region: 'us-east-1', bucket: 'mybucket',
    },
    expectedServiceId: 'custom_s3',
  },
];

describe.each(s3Uploaders)('$name', ({ createUploader, validConfig, expectedServiceId }) => {
  it('serviceId 正确', () => {
    const uploader = createUploader();
    expect(uploader.serviceId).toBe(expectedServiceId);
  });

  it('配置为空时 validateConfig 返回失败', async () => {
    const uploader = createUploader();
    const result = await uploader.validateConfig({});
    expect(result.valid).toBe(false);
    expect(result.missingFields!.length).toBeGreaterThan(0);
  });

  it('配置完整时 validateConfig 返回成功', async () => {
    const uploader = createUploader();
    const result = await uploader.validateConfig(validConfig);
    expect(result.valid).toBe(true);
  });

  it('getPublicUrl 返回 result.url', () => {
    const uploader = createUploader();
    const result = makeUploadResult({ serviceId: expectedServiceId });
    expect(uploader.getPublicUrl(result)).toBe(result.url);
  });
});
