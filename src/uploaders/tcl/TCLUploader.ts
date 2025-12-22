// src/uploaders/tcl/TCLUploader.ts
// TCL 图床上传器实现

import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';
// TCLServiceConfig 类型暂未使用，保留以备将来扩展
import { TCLRateLimiter } from './TCLRateLimiter';

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
  async validateConfig(_config: any): Promise<ValidationResult> {
    return { valid: true };
  }

  /**
   * 上传文件到 TCL
   */
  /**
   * 上传文件到 TCL
   */
  async upload(
    filePath: string,
    _options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    this.log('info', '开始上传到 TCL', { filePath });

    // TCL 只需要针对限流重试，网络错误通常不需要重试太多次
    const MAX_RETRIES = 2;
    let lastError: any;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        // 限制速率 (如果在冷却，这里会等待)
        await TCLRateLimiter.getInstance().acquire();

        // 调用基类的 Rust 上传方法
        const rustResult = await this.uploadViaRust(
          filePath,
          {},
          onProgress
        ) as TCLRustResult;

        this.log('info', 'TCL 上传成功', { url: rustResult.url });

        return {
          serviceId: 'tcl',
          fileKey: rustResult.url,
          url: rustResult.url,
          size: rustResult.size
        };
      } catch (error: any) {
        lastError = error;
        const errorMsg = String(error);

        // 检测限流关键字
        // "操作太频繁" 是 TCL 典型的限流错误
        if (errorMsg.includes('操作太频繁') || errorMsg.includes('frequent')) {
          this.log('warn', `TCL 限流 (尝试 ${attempt + 1}/${MAX_RETRIES + 1})`, error);

          // 如果遇到限流错误，说明 RateLimiter 可能没计算准（或者多实例并发了）
          // 我们这里手动做一个延时再重试
          if (attempt < MAX_RETRIES) {
            // 既然服务端说太频繁，咱就老实等 5 秒
            await new Promise(r => setTimeout(r, 5000));
            continue;
          }
        }

        // 其他错误直接抛出，或者按需重试
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
      }
    }

    this.log('error', 'TCL 上传失败', lastError);
    throw new Error(`TCL 图床上传失败: ${lastError}`);
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
