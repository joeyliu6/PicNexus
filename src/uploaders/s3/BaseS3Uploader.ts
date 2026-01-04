// src/uploaders/s3/BaseS3Uploader.ts
// S3 兼容存储上传器基类
// 支持：腾讯云 COS、阿里云 OSS、七牛云、又拍云

import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';

interface S3RustResult {
  url: string;
  key: string;
}

export abstract class BaseS3Uploader extends BaseUploader {
  protected abstract getEndpoint(config: any): string;
  protected abstract getAccessKey(config: any): string;
  protected abstract getSecretKey(config: any): string;
  protected abstract getRegion(config: any): string;
  protected abstract getBucket(config: any): string;
  protected abstract getPath(config: any): string;
  protected abstract getPublicDomain(config: any): string;

  protected getRustCommand(): string {
    return 'upload_to_s3_compatible';
  }

  async validateConfig(config: any): Promise<ValidationResult> {
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

    const config = options.config;
    const fileName = filePath.split(/[/\\]/).pop() || '';
    const path = this.getPath(config) || '';
    const key = path + fileName;

    const rustResult = await this.uploadViaRust(
      filePath,
      {
        endpoint: this.getEndpoint(config),
        accessKey: this.getAccessKey(config),
        secretKey: this.getSecretKey(config),
        region: this.getRegion(config),
        bucket: this.getBucket(config),
        key,
        publicDomain: this.getPublicDomain(config)
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
      case 'cos':
        return `${url}?imageMogr2/thumbnail/${sizeParams[size]}x${sizeParams[size]}`;
      case 'oss':
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
