import { BaseS3Uploader } from '../s3/BaseS3Uploader';
import type { UpyunServiceConfig } from '../../config/types';

/**
 * 又拍云 S3 兼容端点
 *
 * 与 Rust `src-tauri/src/commands/s3_compatible.rs` 的同名常量由
 * `scripts/check-cross-language-constants.mjs` 钉住必须逐字一致：GUI 上传由这里把
 * endpoint 传进 `upload_to_s3_compatible`，而设置页「测试连接」由 Rust 自己拼。
 * 两边一旦漂移，测试连接验的就不是上传真正会去的那台服务器，绿灯重新退化成
 * 没有意义的绿灯——那正是这个图床的缺陷长期潜伏的形态。
 */
const UPYUN_S3_ENDPOINT = 'https://s3.api.upyun.com';

/**
 * 又拍云 SigV4 签名用的 region
 *
 * 又拍云文档称不支持配置区域，但 region 仍参与签名计算。
 * 2026-08-19 实测：用这个写死值签名可以通过，服务端不校验取值。
 * 同样由跨语言常量守卫钉住，理由见 {@link UPYUN_S3_ENDPOINT}。
 */
const UPYUN_S3_REGION = 'upyun';

export class UpyunUploader extends BaseS3Uploader<UpyunServiceConfig> {
  readonly serviceId = 'upyun';
  readonly serviceName = '又拍云';

  protected getEndpoint(_config: UpyunServiceConfig): string {
    return UPYUN_S3_ENDPOINT;
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

  protected getRegion(_config: UpyunServiceConfig): string {
    return UPYUN_S3_REGION;
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
