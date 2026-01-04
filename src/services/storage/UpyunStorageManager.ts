import { BaseS3StorageManager } from './S3StorageManager';

export class UpyunStorageManager extends BaseS3StorageManager {
  readonly serviceId = 'upyun';
  readonly serviceName = '又拍云';

  protected getEndpoint(): string {
    return this.config.domain || 'https://v0.api.upyun.com';
  }

  protected getAccessKey(): string {
    return this.config.operator;
  }

  protected getSecretKey(): string {
    return this.config.password;
  }

  protected getRegion(): string {
    return 'upyun';
  }

  protected getBucket(): string {
    return this.config.bucket;
  }

  protected getPublicDomain(): string {
    return this.config.domain;
  }
}
