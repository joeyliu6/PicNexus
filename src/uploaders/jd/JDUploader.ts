import { JDRateLimiter } from './JDRateLimiter';
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
    options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    this.log('info', '开始上传到京东', { filePath });

    // 最大重试次数
    const MAX_RETRIES = 2;
    let lastError: any;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        // 1. 获取许可 (如果正在熔断会等待)
        await JDRateLimiter.getInstance().acquire();

        // 2. 尝试上传
        if (attempt > 0) {
          this.log('info', `第 ${attempt} 次重试上传到京东...`);
        }

        const rustResult = await this.uploadViaRust(
          filePath,
          {},
          onProgress
        ) as JDRustResult;

        this.log('info', '京东上传成功', { url: rustResult.url });

        return {
          serviceId: 'jd',
          fileKey: rustResult.url,
          url: rustResult.url,
          size: rustResult.size
        };

      } catch (error: any) {
        lastError = error;
        const errorMsg = String(error);

        // 3. 错误分析与熔断处理
        // 如果是 500 Forbidden (风控)，触发熔断
        if (errorMsg.includes('500') || errorMsg.includes('forbidden') || errorMsg.includes('limit')) {
          this.log('warn', `京东风控限制 (尝试 ${attempt + 1}/${MAX_RETRIES + 1})`, error);

          if (attempt < MAX_RETRIES) {
            // 触发 5~10 秒随机熔断
            const waitTime = 5000 + Math.random() * 5000;
            JDRateLimiter.getInstance().triggerCircuitBreaker(waitTime);
            // 循环会进入下一次重试，acquire() 会自动等待熔断结束
            continue;
          }
        }

        // 其他错误 (网络等) 也可以重试，但不需要触发全局熔断，只需退避
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); // 简单退避
          continue;
        }
      }
    }

    // 重试耗尽
    throw new Error(`京东图床上传失败: ${lastError}`);
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
