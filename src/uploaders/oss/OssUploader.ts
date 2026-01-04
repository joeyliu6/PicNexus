import { BaseS3Uploader } from '../s3/BaseS3Uploader';

export class OssUploader extends BaseS3Uploader {
  readonly serviceId = 'oss';
  readonly serviceName = '阿里云 OSS';

  protected getEndpoint(config: any): string {
    const region = config.region;
    return `https://oss-${region}.aliyuncs.com`;
  }

  protected getAccessKey(config: any): string {
    return config.accessKeyId;
  }

  protected getSecretKey(config: any): string {
    return config.accessKeySecret;
  }

  protected getRegion(config: any): string {
    return config.region;
  }

  protected getBucket(config: any): string {
    return config.bucket;
  }

  protected getPath(config: any): string {
    return (config.path || 'images/').replace(/\/$/, '/') || '';
  }

  protected getPublicDomain(config: any): string {
    return config.publicDomain || '';
  }
}
