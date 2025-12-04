// src/uploaders/zhihu/ZhihuUploader.ts
// 知乎图床上传器实现

import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';
import { ZhihuServiceConfig } from '../../config/types';

/**
 * Rust 返回的知乎上传结果
 */
interface ZhihuRustResult {
  url: string;
  size: number;
}

/**
 * 知乎图床上传器
 * 实现知乎图片上传功能
 */
export class ZhihuUploader extends BaseUploader {
  readonly serviceId = 'zhihu';
  readonly serviceName = '知乎图床';

  /**
   * 返回对应的 Rust 命令名
   */
  protected getRustCommand(): string {
    return 'upload_to_zhihu';
  }

  /**
   * 验证知乎配置
   * 知乎图床需要 Cookie 认证
   */
  async validateConfig(config: any): Promise<ValidationResult> {
    const zhihuConfig = config as ZhihuServiceConfig;

    // 检查 Cookie 是否存在
    if (!zhihuConfig.cookie || this.isEmpty(zhihuConfig.cookie)) {
      return {
        valid: false,
        missingFields: ['Cookie'],
        errors: ['请先在设置中配置知乎 Cookie']
      };
    }

    return { valid: true };
  }

  /**
   * 上传文件到知乎图床
   */
  async upload(
    filePath: string,
    options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    const config = options.config as ZhihuServiceConfig;

    this.log('info', '开始上传到知乎图床', { filePath });

    try {
      // 调用基类的 Rust 上传方法
      const rustResult = await this.uploadViaRust(
        filePath,
        { zhihuCookie: config.cookie },
        onProgress
      ) as ZhihuRustResult;

      this.log('info', '知乎图床上传成功', { url: rustResult.url });

      return {
        serviceId: 'zhihu',
        fileKey: rustResult.url,
        url: rustResult.url,
        size: rustResult.size
      };
    } catch (error: any) {
      this.log('error', '知乎图床上传失败', error);
      throw new Error(`知乎图床上传失败: ${error.message || error.toString()}`);
    }
  }

  /**
   * 生成公开访问 URL
   */
  getPublicUrl(result: UploadResult): string {
    return result.url;
  }
}
