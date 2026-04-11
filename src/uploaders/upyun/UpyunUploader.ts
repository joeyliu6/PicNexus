import { BaseS3Uploader } from '../s3/BaseS3Uploader';
import type { UpyunServiceConfig } from '../../config/types';

export class UpyunUploader extends BaseS3Uploader<UpyunServiceConfig> {
  readonly serviceId = 'upyun';
  readonly serviceName = '又拍云';

  protected getEndpoint(_config: UpyunServiceConfig): string {
    // 又拍云 S3 兼容端点
    return 'https://s3.api.upyun.com';
  }

  protected getAccessKey(config: UpyunServiceConfig): string {
    return config.operator;
  }

  protected getSecretKey(config: UpyunServiceConfig): string {
    return config.password;
  }

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
