import { BaseS3Uploader } from '../s3/BaseS3Uploader';
import { UploadResult } from '../base/types';
import type { CustomS3Profile } from '../../config/types';

export class CustomS3Uploader extends BaseS3Uploader<CustomS3Profile> {
  readonly serviceId = 'custom_s3';
  readonly serviceName = '自定义 S3 存储';

  protected getEndpoint(config: CustomS3Profile): string {
    return config.endpoint;
  }

  protected getAccessKey(config: CustomS3Profile): string {
    return config.accessKeyId;
  }

  protected getSecretKey(config: CustomS3Profile): string {
    return config.secretAccessKey;
  }

  protected getRegion(config: CustomS3Profile): string {
    return config.region;
  }

  protected getBucket(config: CustomS3Profile): string {
    return config.bucket;
  }

  protected getPath(config: CustomS3Profile): string {
    return config.path || '';
  }

  protected getPublicDomain(config: CustomS3Profile): string {
    return config.publicDomain || '';
  }

  getThumbnailUrl(result: UploadResult): string {
    return result.url;
  }
}
