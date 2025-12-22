// src/uploaders/weibo/WeiboUploader.ts
// 微博图床上传器实现

import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';
import { WeiboServiceConfig } from '../../config/types';
import { convertToWeiboError } from './WeiboError';

/**
 * Rust 返回的微博上传结果
 */
interface WeiboRustResult {
  pid: string;
  width: number;
  height: number;
  size: number;
}

/**
 * 微博图床上传器
 * 实现微博图片上传功能
 */
export class WeiboUploader extends BaseUploader {
  readonly serviceId = 'weibo';
  readonly serviceName = '新浪微博';

  /**
   * 返回对应的 Rust 命令名
   */
  protected getRustCommand(): string {
    return 'upload_file_stream'; // 使用现有的 Rust 命令
  }

  /**
   * 验证微博配置
   */
  async validateConfig(config: any): Promise<ValidationResult> {
    const weiboConfig = config as WeiboServiceConfig;

    // 检查 Cookie 是否存在
    if (!weiboConfig.cookie || this.isEmpty(weiboConfig.cookie)) {
      return {
        valid: false,
        missingFields: ['Cookie'],
        errors: ['请先在设置中配置微博 Cookie']
      };
    }

    return { valid: true };
  }

  /**
   * 上传文件到微博
   */
  async upload(
    filePath: string,
    options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    const config = options.config as WeiboServiceConfig;

    this.log('info', '开始上传到微博', { filePath });

    try {
      // 调用基类的 Rust 上传方法
      const rustResult = await this.uploadViaRust(
        filePath,
        { weiboCookie: config.cookie },
        onProgress
      ) as WeiboRustResult;

      // 转换为标准 UploadResult
      const pid = rustResult.pid;
      const hashName = `${pid}.jpg`;
      const url = `https://tvax1.sinaimg.cn/large/${hashName}`;

      this.log('info', '微博上传成功', { pid, url });

      return {
        serviceId: 'weibo',
        fileKey: pid,
        url: url,
        size: rustResult.size,
        width: rustResult.width,
        height: rustResult.height,
        metadata: {
          hashName: hashName,
          pid: pid
        }
      };
    } catch (error) {
      this.log('error', '微博上传失败', error);
      throw convertToWeiboError(error);
    }
  }

  /**
   * 生成微博公开访问 URL
   */
  getPublicUrl(result: UploadResult): string {
    return result.url;
  }

  /**
   * 生成微博缩略图 URL
   */
  getThumbnailUrl(result: UploadResult): string {
    const pid = result.fileKey;
    return `https://tvax1.sinaimg.cn/thumbnail/${pid}.jpg`;
  }

  /**
   * 生成微博原图 URL
   */
  getOriginalUrl(result: UploadResult): string {
    const pid = result.fileKey;
    return `https://tvax1.sinaimg.cn/large/${pid}.jpg`;
  }
}
