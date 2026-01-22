// Cloudflare R2 上传器实现
// 基于 S3 兼容协议，继承 BaseS3Uploader

import { BaseS3Uploader } from '../s3/BaseS3Uploader';
import { UploadResult, ValidationResult } from '../base/types';
import { R2ServiceConfig } from '../../config/types';

/**
 * Cloudflare R2 上传器
 * 基于 S3 兼容协议实现，复用 BaseS3Uploader 的上传逻辑
 */
export class R2Uploader extends BaseS3Uploader {
  readonly serviceId = 'r2';
  readonly serviceName = 'Cloudflare R2';

  /**
   * 获取 R2 端点
   * 格式: https://{accountId}.r2.cloudflarestorage.com
   */
  protected getEndpoint(config: R2ServiceConfig): string {
    return `https://${config.accountId}.r2.cloudflarestorage.com`;
  }

  /**
   * 获取访问密钥 ID
   */
  protected getAccessKey(config: R2ServiceConfig): string {
    return config.accessKeyId;
  }

  /**
   * 获取访问密钥
   */
  protected getSecretKey(config: R2ServiceConfig): string {
    return config.secretAccessKey;
  }

  /**
   * 获取地域
   * R2 固定使用 'auto'
   */
  protected getRegion(_config: R2ServiceConfig): string {
    return 'auto';
  }

  /**
   * 获取存储桶名称
   */
  protected getBucket(config: R2ServiceConfig): string {
    return config.bucketName;
  }

  /**
   * 获取存储路径前缀
   */
  protected getPath(config: R2ServiceConfig): string {
    const path = config.path || '';
    return path;
  }

  /**
   * 获取公开访问域名
   */
  protected getPublicDomain(config: R2ServiceConfig): string {
    return config.publicDomain || '';
  }

  /**
   * 验证 R2 配置
   * 覆盖基类方法，提供更友好的中文错误提示
   */
  async validateConfig(config: any): Promise<ValidationResult> {
    const r2Config = config as R2ServiceConfig;
    const missingFields: string[] = [];
    const errors: string[] = [];

    if (this.isEmpty(r2Config.accountId)) {
      missingFields.push('accountId');
      errors.push('账户 ID (Account ID) 不能为空');
    }
    if (this.isEmpty(r2Config.accessKeyId)) {
      missingFields.push('accessKeyId');
      errors.push('访问密钥 ID (Access Key ID) 不能为空');
    }
    if (this.isEmpty(r2Config.secretAccessKey)) {
      missingFields.push('secretAccessKey');
      errors.push('访问密钥 (Secret Access Key) 不能为空');
    }
    if (this.isEmpty(r2Config.bucketName)) {
      missingFields.push('bucketName');
      errors.push('存储桶名称 (Bucket Name) 不能为空');
    }
    if (this.isEmpty(r2Config.publicDomain)) {
      missingFields.push('publicDomain');
      errors.push('公开访问域名 (Public Domain) 不能为空');
    }

    if (errors.length > 0) {
      return { valid: false, missingFields, errors };
    }

    return { valid: true };
  }

  /**
   * 生成 R2 缩略图 URL
   * 使用 wsrv.nl 图片代理服务生成缩略图
   * 覆盖基类方法，R2 没有原生缩略图 API
   */
  getThumbnailUrl(result: UploadResult, size: 'small' | 'medium' | 'large' = 'medium'): string {
    const sizeMap = {
      small: 200,
      medium: 500,
      large: 1000
    };
    const encodedUrl = encodeURIComponent(result.url);
    return `https://wsrv.nl/?url=${encodedUrl}&w=${sizeMap[size]}&h=${sizeMap[size]}&fit=cover&a=center&q=75&output=webp`;
  }
}
