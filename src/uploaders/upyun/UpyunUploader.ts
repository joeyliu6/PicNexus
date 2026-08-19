import { BaseS3Uploader } from '../s3/BaseS3Uploader';
import type { UpyunServiceConfig } from '../../config/types';

export class UpyunUploader extends BaseS3Uploader<UpyunServiceConfig> {
  readonly serviceId = 'upyun';
  readonly serviceName = '又拍云';

  protected getEndpoint(_config: UpyunServiceConfig): string {
    // 又拍云 S3 兼容端点
    return 'https://s3.api.upyun.com';
  }

  // Why 不是 operator/password：那对是又拍云自家 REST API 的 Basic Auth 凭证，
  // S3 兼容端点不认它——2026-08-19 实测回 `ErrInvalidAccessKeyID`，换成控制台
  // 「操作员授权-S3访问凭证」里单独生成的那对才通。这条链路曾长期完全不可用，
  // 而设置页「测试连接」走的是 REST，一直亮着绿灯，把问题盖住了。
  protected getAccessKey(config: UpyunServiceConfig): string {
    return config.s3AccessKey;
  }

  protected getSecretKey(config: UpyunServiceConfig): string {
    return config.s3SecretKey;
  }

  // 又拍云文档称不支持配置区域，但 region 仍参与 SigV4 签名计算。
  // 2026-08-19 实测：用这个写死值签名可以通过，服务端不校验取值。
  protected getRegion(_config: UpyunServiceConfig): string {
    return 'upyun';
  }

  protected getBucket(config: UpyunServiceConfig): string {
    return config.bucket;
  }

  protected getPath(config: UpyunServiceConfig): string {
    const path = config.path || 'images/';
    return path.endsWith('/') ? path : path + '/';
  }

  protected getPublicDomain(config: UpyunServiceConfig): string {
    return config.publicDomain || '';
  }
}
