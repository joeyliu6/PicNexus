import { BaseS3Uploader } from '../s3/BaseS3Uploader';
import type { TencentServiceConfig } from '../../config/types';

export class TencentUploader extends BaseS3Uploader<TencentServiceConfig> {
  readonly serviceId = 'tencent';
  readonly serviceName = '腾讯云';

  protected getEndpoint(config: TencentServiceConfig): string {
    const region = config.region;
    return `https://cos.${region}.myqcloud.com`;
  }

  protected getAccessKey(config: TencentServiceConfig): string {
    return config.secretId;
  }

  protected getSecretKey(config: TencentServiceConfig): string {
    return config.secretKey;
  }

  protected getRegion(config: TencentServiceConfig): string {
    return config.region;
  }

  protected getBucket(config: TencentServiceConfig): string {
    return config.bucket;
  }

  protected getPath(config: TencentServiceConfig): string {
    const path = config.path || 'images/';
    return path.endsWith('/') ? path : path + '/';
  }

  protected getPublicDomain(config: TencentServiceConfig): string {
    const publicDomain = config.publicDomain?.trim();
    if (publicDomain) return publicDomain;
    const bucket = config.bucket?.trim();
    const region = config.region?.trim();
    if (!bucket || !region) return '';
    return `https://${bucket}.cos.${region}.myqcloud.com`;
  }
}
