# 上传器接口

> IUploader 接口规范和上传器实现指南

---

## 接口定义

### IUploader

所有图床上传器必须实现 `IUploader` 接口：

```typescript
interface IUploader {
  /** 服务唯一标识，如 'weibo', 'r2' */
  readonly serviceId: ServiceType;

  /** 服务显示名称，如 '新浪微博' */
  readonly serviceName: string;

  /** 验证服务配置是否完整有效 */
  validateConfig(config: UserConfig): Promise<ValidationResult>;

  /** 执行文件上传 */
  upload(
    filePath: string,
    options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult>;

  /** 根据上传结果生成公开访问 URL */
  getPublicUrl(result: UploadResult): string;

  /** 可选：测试服务连接 */
  testConnection?(config?: ServiceConfig): Promise<ConnectionTestResult>;
}
```

### 相关类型

```typescript
interface ValidationResult {
  valid: boolean;
  message?: string;
}

interface UploadOptions {
  config: UserConfig;
  fileName?: string;
  customPath?: string;
}

interface UploadResult {
  url: string;
  fileKey?: string;
  deleteUrl?: string;
  rawResponse?: unknown;
}

type ProgressCallback = (progress: number) => void;

interface ConnectionTestResult {
  success: boolean;
  message: string;
  username?: string;
}
```

---

## 基类实现

### BaseUploader

提供通用功能的抽象基类：

```typescript
abstract class BaseUploader implements IUploader {
  abstract readonly serviceId: ServiceType;
  abstract readonly serviceName: string;

  /** 子类实现：返回 Rust 命令名称 */
  protected abstract getRustCommand(): string;

  /** 子类实现：构造传递给 Rust 的参数 */
  protected abstract buildRustParams(
    filePath: string,
    options: UploadOptions
  ): Record<string, unknown>;

  /** 通用上传逻辑，调用 Rust 后端 */
  async upload(
    filePath: string,
    options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    const id = nanoid();

    // 设置进度监听
    if (onProgress) {
      const unlisten = await listen(`upload-progress-${id}`, (event) => {
        onProgress(event.payload.progress);
      });
      // 清理逻辑...
    }

    // 调用 Rust 命令
    const result = await invoke(this.getRustCommand(), {
      id,
      filePath,
      ...this.buildRustParams(filePath, options),
    });

    return this.transformResult(result);
  }

  /** 子类可覆盖：转换 Rust 返回结果 */
  protected transformResult(rustResult: unknown): UploadResult {
    // 默认实现
  }
}
```

---

## 已实现的上传器

| 服务 | 类名 | 文件 | 认证方式 |
|------|------|------|---------|
| 微博 | `WeiboUploader` | `weibo/WeiboUploader.ts` | Cookie |
| 知乎 | `ZhihuUploader` | `zhihu/ZhihuUploader.ts` | Cookie |
| 牛客 | `NowcoderUploader` | `nowcoder/NowcoderUploader.ts` | Cookie |
| B站 | `BilibiliUploader` | `bilibili/BilibiliUploader.ts` | Cookie |
| 纳米 | `NamiUploader` | `nami/NamiUploader.ts` | Cookie + Token |
| 七鱼 | `QiyuUploader` | `qiyu/QiyuUploader.ts` | 无需认证 |
| 京东 | `JDUploader` | `jd/JDUploader.ts` | 无需认证 |
| TCL | `TCLUploader` | `tcl/TCLUploader.ts` | 无需认证 |
| SM.MS | `SmmsUploader` | `smms/SmmsUploader.ts` | API Token |
| GitHub | `GithubUploader` | `github/GithubUploader.ts` | Personal Token |
| R2 | `R2Uploader` | `r2/R2Uploader.ts` | API Key |
| COS | `COSUploader` | `cos/COSUploader.ts` | SecretId/Key |
| OSS | `OSSUploader` | `oss/OSSUploader.ts` | AccessKey |
| 七牛 | `QiniuUploader` | `qiniu/QiniuUploader.ts` | AK/SK |
| 又拍云 | `UpyunUploader` | `upyun/UpyunUploader.ts` | 操作员/密码 |

---

## 上传器工厂

### UploaderFactory

注册和创建上传器实例：

```typescript
class UploaderFactory {
  private static uploaders = new Map<ServiceType, () => IUploader>();

  /** 注册上传器 */
  static register(serviceId: ServiceType, factory: () => IUploader): void {
    this.uploaders.set(serviceId, factory);
  }

  /** 获取上传器实例 */
  static get(serviceId: ServiceType): IUploader | undefined {
    const factory = this.uploaders.get(serviceId);
    return factory?.();
  }

  /** 获取所有已注册的服务 ID */
  static getRegisteredServices(): ServiceType[] {
    return Array.from(this.uploaders.keys());
  }
}
```

### 注册上传器

在 `src/uploaders/index.ts` 中集中注册：

```typescript
import { UploaderFactory } from './base/UploaderFactory';
import { WeiboUploader } from './weibo';
import { R2Uploader } from './r2';
// ...

export function initializeUploaders(): void {
  UploaderFactory.register('weibo', () => new WeiboUploader());
  UploaderFactory.register('r2', () => new R2Uploader());
  UploaderFactory.register('jd', () => new JDUploader());
  // ...
}
```

---

## 实现示例

### 简单上传器（无需认证）

```typescript
// src/uploaders/jd/JDUploader.ts
import { BaseUploader } from '../base/BaseUploader';
import type { UploadOptions, UploadResult, ValidationResult } from '../base/types';

export class JDUploader extends BaseUploader {
  readonly serviceId = 'jd' as const;
  readonly serviceName = '京东图床';

  protected getRustCommand(): string {
    return 'upload_to_jd';
  }

  protected buildRustParams(filePath: string, options: UploadOptions) {
    return {
      // 京东图床无需额外参数
    };
  }

  async validateConfig(): Promise<ValidationResult> {
    // 无需配置验证
    return { valid: true };
  }

  getPublicUrl(result: UploadResult): string {
    return result.url;
  }
}
```

### Cookie 认证上传器

```typescript
// src/uploaders/weibo/WeiboUploader.ts
import { BaseUploader } from '../base/BaseUploader';
import type { UploadOptions, ValidationResult } from '../base/types';

export class WeiboUploader extends BaseUploader {
  readonly serviceId = 'weibo' as const;
  readonly serviceName = '新浪微博';

  protected getRustCommand(): string {
    return 'upload_file_stream';
  }

  protected buildRustParams(filePath: string, options: UploadOptions) {
    return {
      weiboCookie: options.config.weibo?.cookie || '',
    };
  }

  async validateConfig(config: UserConfig): Promise<ValidationResult> {
    if (!config.weibo?.cookie) {
      return { valid: false, message: '请先配置微博 Cookie' };
    }
    return { valid: true };
  }

  getPublicUrl(result: UploadResult): string {
    // 微博图片 URL 处理逻辑
    return result.url.replace('/orj360/', '/large/');
  }

  async testConnection(config: WeiboConfig): Promise<ConnectionTestResult> {
    try {
      const result = await invoke<string>('test_weibo_connection', {
        weiboCookie: config.cookie,
      });
      return { success: true, message: result };
    } catch (error) {
      return { success: false, message: String(error) };
    }
  }
}
```

### S3 兼容存储上传器

```typescript
// src/uploaders/r2/R2Uploader.ts
import { BaseUploader } from '../base/BaseUploader';

export class R2Uploader extends BaseUploader {
  readonly serviceId = 'r2' as const;
  readonly serviceName = 'Cloudflare R2';

  protected getRustCommand(): string {
    return 'upload_to_s3_compatible';
  }

  protected buildRustParams(filePath: string, options: UploadOptions) {
    const r2 = options.config.r2!;
    const fileName = options.fileName || path.basename(filePath);
    const key = `${r2.pathPrefix || ''}${fileName}`;

    return {
      endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
      accessKey: r2.accessKeyId,
      secretKey: r2.secretAccessKey,
      region: 'auto',
      bucket: r2.bucketName,
      key,
      publicDomain: r2.publicDomain || '',
    };
  }

  async validateConfig(config: UserConfig): Promise<ValidationResult> {
    const r2 = config.r2;
    if (!r2?.accountId || !r2?.accessKeyId || !r2?.secretAccessKey || !r2?.bucketName) {
      return { valid: false, message: '请完善 R2 配置' };
    }
    return { valid: true };
  }

  getPublicUrl(result: UploadResult): string {
    return result.url;
  }
}
```

---

## 错误处理

### 服务特定错误类

每个服务可定义专属错误类：

```typescript
// src/uploaders/weibo/WeiboError.ts
export class WeiboError extends Error {
  constructor(
    message: string,
    public code: WeiboErrorCode,
    public suggestion?: string
  ) {
    super(message);
    this.name = 'WeiboError';
  }
}

export enum WeiboErrorCode {
  COOKIE_EXPIRED = 'COOKIE_EXPIRED',
  RATE_LIMITED = 'RATE_LIMITED',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  NETWORK_ERROR = 'NETWORK_ERROR',
}
```

### 错误转换

在 `MultiServiceUploader` 中统一转换：

```typescript
function convertToUserFriendlyError(error: unknown, serviceId: ServiceType): string {
  if (error instanceof WeiboError) {
    switch (error.code) {
      case WeiboErrorCode.COOKIE_EXPIRED:
        return '微博 Cookie 已过期，请重新获取';
      // ...
    }
  }
  return `${serviceId} 上传失败: ${String(error)}`;
}
```

---

## 相关文档

- [添加新图床指南](../guides/add-new-uploader.md)
- [后端架构](../architecture/backend.md)
- [Rust 命令参考](./rust-commands.md)

---

## 维护记录

| 日期 | 变更 |
|------|------|
| 2025-01-15 | 新增腾讯云 COS、阿里云 OSS 上传器 |
| 2025-01-13 | 初始版本 |
