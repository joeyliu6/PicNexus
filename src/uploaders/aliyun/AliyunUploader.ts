import { BaseS3Uploader } from '../s3/BaseS3Uploader';
import type { AliyunServiceConfig } from '../../config/types';

export class AliyunUploader extends BaseS3Uploader<AliyunServiceConfig> {
  readonly serviceId = 'aliyun';
  readonly serviceName = '阿里云';

  protected getEndpoint(config: AliyunServiceConfig): string {
    const region = config.region;
    return `https://oss-${region}.aliyuncs.com`;
  }

  protected getAccessKey(config: AliyunServiceConfig): string {
    return config.accessKeyId;
  }

  protected getSecretKey(config: AliyunServiceConfig): string {
    return config.accessKeySecret;
  }

  protected getRegion(config: AliyunServiceConfig): string {
    return config.region;
  }

  protected getBucket(config: AliyunServiceConfig): string {
    return config.bucket;
  }

  protected getPath(config: AliyunServiceConfig): string {
    const path = config.path || 'images/';
    return path.endsWith('/') ? path : path + '/';
  }

  protected getPublicDomain(config: AliyunServiceConfig): string {
    return config.publicDomain || '';
  }
}
