// 牛客图床上传器实现

import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';
import { NowcoderServiceConfig } from '../../config/types';

/**
 * Rust 返回的牛客上传结果
 */
interface NowcoderRustResult {
  url: string;
  size: number;
}

/**
 * 牛客图床上传器
 * 实现牛客网图片上传功能
 */
export class NowcoderUploader extends BaseUploader {
  readonly serviceId = 'nowcoder';
  readonly serviceName = '牛客图床';

  /**
   * 返回对应的 Rust 命令名
   */
  protected getRustCommand(): string {
    return 'upload_to_nowcoder';
  }

  /**
   * 验证牛客配置
   * 牛客图床需要 Cookie 认证
   */
  async validateConfig(config: any): Promise<ValidationResult> {
    const nowcoderConfig = config as NowcoderServiceConfig;

    // 检查 Cookie 是否存在
    if (!nowcoderConfig.cookie || this.isEmpty(nowcoderConfig.cookie)) {
      return {
        valid: false,
        missingFields: ['Cookie'],
        errors: ['请先在设置中配置牛客 Cookie']
      };
    }

    return { valid: true };
  }

  /**
   * 上传文件到牛客图床
   */
  async upload(
    filePath: string,
    options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    const config = options.config as NowcoderServiceConfig;

    this.log('info', '开始上传到牛客图床', { filePath });

    try {
      // 调用基类的 Rust 上传方法
      const rustResult = await this.uploadViaRust(
        filePath,
        { nowcoderCookie: config.cookie },
        onProgress
      ) as NowcoderRustResult;

      this.log('info', '牛客图床上传成功', { url: rustResult.url });

      return {
        serviceId: 'nowcoder',
        fileKey: rustResult.url,
        url: rustResult.url,
        size: rustResult.size
      };
    } catch (error: any) {
      this.log('error', '牛客图床上传失败', error);
      throw new Error(`牛客图床上传失败: ${error.message || error.toString()}`);
    }
  }

  /**
   * 生成公开访问 URL
   */
  getPublicUrl(result: UploadResult): string {
    return result.url;
  }

  /**
   * 生成牛客缩略图 URL
   * 使用阿里云 OSS 图片处理参数
   */
  getThumbnailUrl(result: UploadResult): string {
    return `${result.url}?x-oss-process=image%2Fresize%2Cw_75%2Ch_75%2Cm_mfit%2Fformat%2Cpng`;
  }
}
