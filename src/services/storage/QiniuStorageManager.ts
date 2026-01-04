import { BaseS3StorageManager } from './S3StorageManager';

export class QiniuStorageManager extends BaseS3StorageManager {
  readonly serviceId = 'qiniu';
  readonly serviceName = '七牛云';

  protected getEndpoint(): string {
    return this.config.domain;
  }

  protected getAccessKey(): string {
    return this.config.accessKey;
  }

  protected getSecretKey(): string {
    return this.config.secretKey;
  }

  protected getRegion(): string {
    return 'qiniu';
  }

  protected getBucket(): string {
    return this.config.bucket;
  }

  protected getPublicDomain(): string {
    return this.config.domain;
  }
}
