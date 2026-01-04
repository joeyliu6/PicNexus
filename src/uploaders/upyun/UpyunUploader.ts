import { BaseS3Uploader } from '../s3/BaseS3Uploader';

export class UpyunUploader extends BaseS3Uploader {
  readonly serviceId = 'upyun';
  readonly serviceName = '又拍云';

  protected getEndpoint(_config: any): string {
    // 又拍云 S3 兼容端点
    return 'https://s3.api.upyun.com';
  }

  protected getAccessKey(config: any): string {
    return config.operator;
  }

  protected getSecretKey(config: any): string {
    return config.password;
  }

  protected getRegion(_config: any): string {
    return 'upyun';
  }

  protected getBucket(config: any): string {
    return config.bucket;
  }

  protected getPath(config: any): string {
    return (config.path || 'images/').replace(/\/$/, '/') || '';
  }

  protected getPublicDomain(config: any): string {
    return config.domain;
  }
}
