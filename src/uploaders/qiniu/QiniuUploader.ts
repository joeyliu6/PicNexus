import { BaseS3Uploader } from '../s3/BaseS3Uploader';

export class QiniuUploader extends BaseS3Uploader {
  readonly serviceId = 'qiniu';
  readonly serviceName = '七牛云';

  protected getEndpoint(config: any): string {
    // 七牛云 S3 兼容端点格式: https://s3-{region}.qiniucs.com
    const region = config.region || 'cn-east-1';
    return `https://s3-${region}.qiniucs.com`;
  }

  protected getAccessKey(config: any): string {
    return config.accessKey;
  }

  protected getSecretKey(config: any): string {
    return config.secretKey;
  }

  protected getRegion(config: any): string {
    return config.region || 'cn-east-1';
  }

  protected getBucket(config: any): string {
    return config.bucket;
  }

  protected getPath(config: any): string {
    const path = config.path || 'images/';
    return path.endsWith('/') ? path : path + '/';
  }

  protected getPublicDomain(config: any): string {
    return config.publicDomain;
  }
}
