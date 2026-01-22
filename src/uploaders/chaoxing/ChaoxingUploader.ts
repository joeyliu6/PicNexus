// 超星图床上传器实现

import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';
import { ChaoxingServiceConfig } from '../../config/types';

/**
 * Rust 返回的超星上传结果
 */
interface ChaoxingRustResult {
  url: string;
  size: number;
}

/**
 * 超星图床上传器
 * 实现超星/学习通图片上传功能
 */
export class ChaoxingUploader extends BaseUploader {
  readonly serviceId = 'chaoxing';
  readonly serviceName = '超星';

  /**
   * 返回对应的 Rust 命令名
   */
  protected getRustCommand(): string {
    return 'upload_to_chaoxing';
  }

  /**
   * 验证超星配置
   */
  async validateConfig(config: any): Promise<ValidationResult> {
    const cxConfig = config as ChaoxingServiceConfig;

    // 检查 Cookie 是否存在
    if (!cxConfig.cookie || this.isEmpty(cxConfig.cookie)) {
      return {
        valid: false,
        missingFields: ['Cookie'],
        errors: ['请先在设置中配置超星 Cookie']
      };
    }

    // 检查必要字段
    if (!cxConfig.cookie.includes('_uid=')) {
      return {
        valid: false,
        missingFields: ['_uid'],
        errors: ['Cookie 缺少必要字段 _uid，请重新登录获取']
      };
    }

    return { valid: true };
  }

  /**
   * 上传文件到超星图床
   */
  async upload(
    filePath: string,
    options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    const config = options.config as ChaoxingServiceConfig;

    this.log('info', '开始上传到超星图床', { filePath });

    try {
      // 调用基类的 Rust 上传方法
      const rustResult = await this.uploadViaRust(
        filePath,
        { chaoxingCookie: config.cookie },
        onProgress
      ) as ChaoxingRustResult;

      this.log('info', '超星上传成功', { url: rustResult.url });

      return {
        serviceId: 'chaoxing',
        fileKey: rustResult.url,
        url: rustResult.url,
        size: rustResult.size
      };
    } catch (error) {
      this.log('error', '超星上传失败', error);
      throw error;
    }
  }

  /**
   * 生成超星公开访问 URL
   */
  getPublicUrl(result: UploadResult): string {
    return result.url;
  }

  /**
   * 生成超星缩略图 URL
   * 规则: 替换域名 + 替换文件名
   * 原图: https://p.cldisk.com/star4/{hash}/origin.jpg
   * 缩略: https://p.ananas.chaoxing.com/star4/{hash}/75_0cQ80.webp
   */
  getThumbnailUrl(result: UploadResult): string {
    let url = result.url;
    // 1. 替换域名
    if (url.includes('p.cldisk.com')) {
      url = url.replace('p.cldisk.com', 'p.ananas.chaoxing.com');
    }
    // 2. 替换文件名 (origin.ext -> 75_0cQ80.webp)
    // 忽略查询参数 (?...)
    return url.replace(/\/origin\.[a-zA-Z0-9]+(\?.*)?$/, '/75_0cQ80.webp');
  }

  /**
   * 生成超星中等尺寸图 URL (悬浮预览/时间线)
   * 规则: 替换域名 + 替换文件名
   * 原图: https://p.cldisk.com/star4/{hash}/origin.jpg
   * 中图: https://p.ananas.chaoxing.com/star4/{hash}/800_0cQ80.webp
   */
  getMediumUrl(result: UploadResult): string {
    let url = result.url;
    // 1. 替换域名
    if (url.includes('p.cldisk.com')) {
      url = url.replace('p.cldisk.com', 'p.ananas.chaoxing.com');
    }
    // 2. 替换文件名 (origin.ext -> 800_0cQ80.webp)
    return url.replace(/\/origin\.[a-zA-Z0-9]+(\?.*)?$/, '/800_0cQ80.webp');
  }

  /**
   * 生成超星原图 URL
   */
  getOriginalUrl(result: UploadResult): string {
    return result.url;
  }
}
