// S3 兼容存储上传器基类
// 支持：腾讯云 COS、阿里云 OSS、七牛云、又拍云、Cloudflare R2、自定义 S3

import { BaseUploader } from '../base/BaseUploader';
import { IUploader } from '../base/IUploader';
import { S3BaseConfig } from './types';
import { buildObjectKey } from './objectKey';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';
import type { HttpDomainConfirmable } from '../../config/types';

interface S3RustResult {
  url: string;
  key: string;
}

export abstract class BaseS3Uploader<TConfig extends S3BaseConfig>
  extends BaseUploader<TConfig>
  implements IUploader<TConfig>
{
  protected abstract getEndpoint(config: TConfig): string;
  protected abstract getAccessKey(config: TConfig): string;
  protected abstract getSecretKey(config: TConfig): string;
  protected abstract getRegion(config: TConfig): string;
  protected abstract getBucket(config: TConfig): string;
  protected abstract getPath(config: TConfig): string;
  protected abstract getPublicDomain(config: TConfig): string;

  protected getRustCommand(): string {
    return 'upload_to_s3_compatible';
  }

  async validateConfig(config: TConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const missingFields: string[] = [];

    const accessKey = this.getAccessKey(config);
    const secretKey = this.getSecretKey(config);
    const bucket = this.getBucket(config);
    const region = this.getRegion(config);
    const endpoint = this.getEndpoint(config);

    if (this.isEmpty(accessKey)) {
      missingFields.push('accessKey');
      errors.push('Access Key 不能为空');
    }
    if (this.isEmpty(secretKey)) {
      missingFields.push('secretKey');
      errors.push('Secret Key 不能为空');
    }
    if (this.isEmpty(bucket)) {
      missingFields.push('bucket');
      errors.push('存储桶名称不能为空');
    }
    if (this.isEmpty(region)) {
      missingFields.push('region');
      errors.push('地域不能为空');
    }
    if (this.isEmpty(endpoint)) {
      missingFields.push('endpoint');
      errors.push('访问端点不能为空');
    }

    if (errors.length > 0) {
      return { valid: false, missingFields, errors };
    }

    return { valid: true };
  }

  async upload(
    filePath: string,
    options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    this.log('info', `开始上传到 ${this.serviceName}`, { filePath });

    // options.config 仍是 any（UploadOptions 尚未泛型化），这里显式断言到 TConfig
    // 让读者明确：此处接收到的是具体派生类对应的 config 类型
    const config = options.config as TConfig;
    const fileName = filePath.split(/[/\\]/).pop() || '';
    // key 带日期 + 随机段前缀：同名文件重复上传不再互相覆盖，详见 objectKey.ts
    const key = buildObjectKey(this.getPath(config), fileName);

    const rustResult = await this.uploadViaRust(
      filePath,
      {
        endpoint: this.getEndpoint(config),
        accessKey: this.getAccessKey(config),
        secretKey: this.getSecretKey(config),
        region: this.getRegion(config),
        bucket: this.getBucket(config),
        key,
        publicDomain: this.getPublicDomain(config),
        // 明文 HTTP 公开域名的确认状态。Rust 侧会核对它与当前域名是否同一主机名，
        // 不匹配就照拒——确认跟着域名走，换域名必须重新确认。
        httpDomainConfirmedFor: (config as HttpDomainConfirmable).httpDomainConfirmedFor
      },
      onProgress
    ) as S3RustResult;

    this.log('info', `${this.serviceName} 上传成功`, { url: rustResult.url });

    return {
      serviceId: this.serviceId,
      fileKey: rustResult.key,
      url: rustResult.url,
      metadata: {
        key: rustResult.key
      }
    };
  }

  getPublicUrl(result: UploadResult): string {
    return result.url;
  }

  getThumbnailUrl(result: UploadResult, size: 'small' | 'medium' | 'large' = 'medium'): string {
    const url = result.url;
    const sizeParams = {
      small: '200',
      medium: '500',
      large: '1000'
    };

    switch (this.serviceId) {
      case 'tencent':
        return `${url}?imageMogr2/thumbnail/${sizeParams[size]}x${sizeParams[size]}`;
      case 'aliyun':
        return `${url}?x-oss-process=image/resize,w_${sizeParams[size]}`;
      case 'qiniu':
        return `${url}?imageView2/2/w/${sizeParams[size]}`;
      case 'upyun':
        return `${url}!/fw/${sizeParams[size]}`;
      default:
        return url;
    }
  }
}
