import { BaseS3Uploader } from '../s3/BaseS3Uploader';
import type { QiniuServiceConfig } from '../../config/types';

export class QiniuUploader extends BaseS3Uploader<QiniuServiceConfig> {
  readonly serviceId = 'qiniu';
  readonly serviceName = '七牛云';

  protected getEndpoint(config: QiniuServiceConfig): string {
    // 七牛云 S3 兼容端点格式: https://s3-{region}.qiniucs.com
    const region = config.region || 'cn-east-1';
    return `https://s3-${region}.qiniucs.com`;
  }

  protected getAccessKey(config: QiniuServiceConfig): string {
    return config.accessKey;
  }

  protected getSecretKey(config: QiniuServiceConfig): string {
    return config.secretKey;
  }

  protected getRegion(config: QiniuServiceConfig): string {
    return config.region || 'cn-east-1';
  }

  protected getBucket(config: QiniuServiceConfig): string {
    return config.bucket;
  }

  protected getPath(config: QiniuServiceConfig): string {
    const path = config.path || 'images/';
    return path.endsWith('/') ? path : path + '/';
  }

  protected getPublicDomain(config: QiniuServiceConfig): string {
    return config.publicDomain || '';
  }
}
