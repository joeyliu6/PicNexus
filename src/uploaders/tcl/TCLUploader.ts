// src/uploaders/tcl/TCLUploader.ts
// TCL 图床上传器实现

import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';
import { TCLServiceConfig } from '../../config/types';

/**
 * Rust 返回的 TCL 上传结果
 */
interface TCLRustResult {
  url: string;
  size: number;
}

/**
 * TCL 图床上传器
 * TCL 图床无需认证，完全开箱即用
 */
export class TCLUploader extends BaseUploader {
  readonly serviceId = 'tcl';
  readonly serviceName = 'TCL 图床';

  /**
   * 返回对应的 Rust 命令名
   */
  protected getRustCommand(): string {
    return 'upload_to_tcl';
  }

  /**
   * 验证 TCL 配置
   * TCL 图床无需配置，直接返回 valid
   */
  async validateConfig(config: any): Promise<ValidationResult> {
    return { valid: true };
  }

  /**
   * 上传文件到 TCL
   */
  async upload(
    filePath: string,
    options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    this.log('info', '开始上传到 TCL', { filePath });

    try {
      // 调用基类的 Rust 上传方法
      // TCL 无需额外参数
      const rustResult = await this.uploadViaRust(
        filePath,
        {},
        onProgress
      ) as TCLRustResult;

      this.log('info', 'TCL 上传成功', { url: rustResult.url });

      // 转换为标准 UploadResult
      return {
        serviceId: 'tcl',
        fileKey: rustResult.url,  // TCL 使用完整 URL 作为 fileKey
        url: rustResult.url,
        size: rustResult.size
      };
    } catch (error) {
      this.log('error', 'TCL 上传失败', error);
      throw new Error(`TCL 图床上传失败: ${error}`);
    }
  }

  /**
   * 生成 TCL 公开访问 URL
   */
  getPublicUrl(result: UploadResult): string {
    return result.url;
  }

  /**
   * 生成 TCL 缩略图 URL
   * TCL 图床没有专门的缩略图服务，直接返回原图
   */
  getThumbnailUrl(result: UploadResult): string {
    return result.url;
  }

  /**
   * 生成 TCL 原图 URL
   */
  getOriginalUrl(result: UploadResult): string {
    return result.url;
  }
}
