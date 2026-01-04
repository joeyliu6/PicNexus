import { BaseS3StorageManager } from './S3StorageManager';

export class R2StorageManager extends BaseS3StorageManager {
  readonly serviceId = 'r2';
  readonly serviceName = 'Cloudflare R2';

  protected getEndpoint(): string {
    return `https://${this.config.accountId}.r2.cloudflarestorage.com`;
  }

  protected getAccessKey(): string {
    return this.config.accessKeyId;
  }

  protected getSecretKey(): string {
    return this.config.secretAccessKey;
  }

  protected getRegion(): string {
    return 'auto';
  }

  protected getBucket(): string {
    return this.config.bucketName;
  }

  protected getPublicDomain(): string {
    return this.config.publicDomain;
  }
}
