// src/uploaders/jd/JDUploader.ts
// 京东图床上传器实现

import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';

/**
 * Rust 返回的京东上传结果
 */
interface JDRustResult {
  url: string;
  size: number;
}

/**
 * 京东图床上传器
 * 京东图床无需认证，完全开箱即用
 */
export class JDUploader extends BaseUploader {
  readonly serviceId = 'jd';
  readonly serviceName = '京东图床';

  /**
   * 返回对应的 Rust 命令名
   */
  protected getRustCommand(): string {
    return 'upload_to_jd';
  }

  /**
   * 验证京东配置
   * 京东图床无需配置，直接返回 valid
   */
  async validateConfig(_config: any): Promise<ValidationResult> {
    return { valid: true };
  }

  /**
   * 上传文件到京东
   */
  async upload(
    filePath: string,
    _options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    this.log('info', '开始上传到京东', { filePath });

    try {
      // 调用基类的 Rust 上传方法
      // 京东无需额外参数
      const rustResult = await this.uploadViaRust(
        filePath,
        {},
        onProgress
      ) as JDRustResult;

      this.log('info', '京东上传成功', { url: rustResult.url });

      // 转换为标准 UploadResult
      return {
        serviceId: 'jd',
        fileKey: rustResult.url,  // 京东使用完整 URL 作为 fileKey
        url: rustResult.url,
        size: rustResult.size
      };
    } catch (error) {
      this.log('error', '京东上传失败', error);
      throw new Error(`京东图床上传失败: ${error}`);
    }
  }

  /**
   * 生成京东公开访问 URL
   */
  getPublicUrl(result: UploadResult): string {
    return result.url;
  }

  /**
   * 生成京东缩略图 URL
   * 京东图床没有专门的缩略图服务，直接返回原图
   */
  getThumbnailUrl(result: UploadResult): string {
    return result.url;
  }

  /**
   * 生成京东原图 URL
   */
  getOriginalUrl(result: UploadResult): string {
    return result.url;
  }
}
