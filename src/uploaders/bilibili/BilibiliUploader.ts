// 哔哩哔哩图床上传器实现

import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';
import { BilibiliServiceConfig } from '../../config/types';

/**
 * Rust 返回的哔哩哔哩上传结果
 */
interface BilibiliRustResult {
  url: string;
  size: number;
}

/**
 * 哔哩哔哩图床上传器
 * 实现哔哩哔哩图片上传功能
 */
export class BilibiliUploader extends BaseUploader {
  readonly serviceId = 'bilibili';
  readonly serviceName = 'B站';

  /**
   * 返回对应的 Rust 命令名
   */
  protected getRustCommand(): string {
    return 'upload_to_bilibili';
  }

  /**
   * 验证哔哩哔哩配置
   */
  async validateConfig(config: any): Promise<ValidationResult> {
    const biliConfig = config as BilibiliServiceConfig;

    // 检查 Cookie 是否存在
    if (!biliConfig.cookie || this.isEmpty(biliConfig.cookie)) {
      return {
        valid: false,
        missingFields: ['Cookie'],
        errors: ['请先在设置中配置哔哩哔哩 Cookie']
      };
    }

    // 检查必要字段
    if (!biliConfig.cookie.includes('SESSDATA=') || !biliConfig.cookie.includes('bili_jct=')) {
      return {
        valid: false,
        missingFields: ['SESSDATA', 'bili_jct'],
        errors: ['Cookie 缺少必要字段 SESSDATA 或 bili_jct，请重新登录获取']
      };
    }

    return { valid: true };
  }

  /**
   * 上传文件到哔哩哔哩
   */
  async upload(
    filePath: string,
    options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    const config = options.config as BilibiliServiceConfig;

    this.log('info', '开始上传到哔哩哔哩', { filePath });

    try {
      // 调用基类的 Rust 上传方法
      const rustResult = await this.uploadViaRust(
        filePath,
        { bilibiliCookie: config.cookie },
        onProgress
      ) as BilibiliRustResult;

      this.log('info', '哔哩哔哩上传成功', { url: rustResult.url });

      return {
        serviceId: 'bilibili',
        fileKey: rustResult.url,
        url: rustResult.url,
        size: rustResult.size
      };
    } catch (error) {
      this.log('error', '哔哩哔哩上传失败', error);
      throw error;
    }
  }

  /**
   * 生成哔哩哔哩公开访问 URL
   */
  getPublicUrl(result: UploadResult): string {
    return result.url;
  }

  /**
   * 生成哔哩哔哩缩略图 URL
   * 哔哩哔哩支持 @宽w_高h 格式的缩略图
   */
  getThumbnailUrl(result: UploadResult): string {
    // 75x75 裁剪，80质量 WebP
    return `${result.url}@75w_75h_1c_80q.webp`;
  }

  /**
   * 生成哔哩哔哩中等尺寸图 URL
   */
  getMediumUrl(result: UploadResult): string {
    // 800宽，80质量 WebP
    return `${result.url}@800w_80q.webp`;
  }

  /**
   * 生成哔哩哔哩原图 URL
   */
  getOriginalUrl(result: UploadResult): string {
    return result.url;
  }
}
