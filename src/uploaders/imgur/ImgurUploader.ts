import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';

interface ImgurRustResult {
  url: string;
  deleteHash?: string;
}

export class ImgurUploader extends BaseUploader {
  readonly serviceId = 'imgur';
  readonly serviceName = 'Imgur';

  protected getRustCommand(): string {
    return 'upload_to_imgur';
  }

  async validateConfig(config: any): Promise<ValidationResult> {
    if (this.isEmpty(config.clientId)) {
      return {
        valid: false,
        missingFields: ['clientId'],
        errors: ['Client ID 不能为空']
      };
    }
    return { valid: true };
  }

  async upload(
    filePath: string,
    options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    this.log('info', '开始上传到 Imgur', { filePath });

    const rustResult = await this.uploadViaRust(
      filePath,
      {
        imgurClientId: options.config.clientId,
        imgurClientSecret: options.config.clientSecret
      },
      onProgress
    ) as ImgurRustResult;

    this.log('info', 'Imgur 上传成功', { url: rustResult.url });

    return {
      serviceId: 'imgur',
      fileKey: rustResult.deleteHash || rustResult.url,
      url: rustResult.url,
      metadata: {
        deleteHash: rustResult.deleteHash
      }
    };
  }

  getPublicUrl(result: UploadResult): string {
    return result.url;
  }

  getThumbnailUrl(result: UploadResult, size: 'small' | 'medium' | 'large' = 'medium'): string {
    const hash = result.metadata?.deleteHash;
    if (!hash) {
      return result.url;
    }

    const suffixes = {
      small: 's',
      medium: 'm',
      large: 'l'
    };

    return result.url.replace(/\.\w+$/, `${suffixes[size]}.jpg`);
  }

  async testConnection(config: any): Promise<import('../base/types').ConnectionTestResult> {
    const startTime = Date.now();
    try {
      // 调用 Imgur credits API 验证 Client ID
      const response = await fetch('https://api.imgur.com/3/credits', {
        headers: { 'Authorization': `Client-ID ${config.clientId}` }
      });
      const latency = Date.now() - startTime;
      if (!response.ok) {
        return { success: false, latency, error: `HTTP ${response.status}` };
      }
      return { success: true, latency };
    } catch (error: any) {
      const latency = Date.now() - startTime;
      return {
        success: false,
        latency,
        error: error.message || '连接测试失败'
      };
    }
  }
}
