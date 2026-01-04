import { BaseS3StorageManager } from './S3StorageManager';

export class OssStorageManager extends BaseS3StorageManager {
  readonly serviceId = 'oss';
  readonly serviceName = '阿里云 OSS';

  protected getEndpoint(): string {
    return `https://oss-${this.config.region}.aliyuncs.com`;
  }

  protected getAccessKey(): string {
    return this.config.accessKeyId;
  }

  protected getSecretKey(): string {
    return this.config.accessKeySecret;
  }

  protected getRegion(): string {
    return this.config.region;
  }

  protected getBucket(): string {
    return this.config.bucket;
  }

  protected getPublicDomain(): string {
    return this.config.publicDomain;
  }
}
