import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';
import type { ImgurServiceConfig } from '../../config/types';
import { getErrorMessage } from '../../types/errors';

interface ImgurRustResult {
  url: string;
  deleteHash?: string;
}

export class ImgurUploader extends BaseUploader<ImgurServiceConfig> {
  readonly serviceId = 'imgur';
  readonly serviceName = 'Imgur';

  protected getRustCommand(): string {
    return 'upload_to_imgur';
  }

  async validateConfig(config: ImgurServiceConfig): Promise<ValidationResult> {
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

    const config = options.config as ImgurServiceConfig;

    const rustResult = await this.uploadViaRust(
      filePath,
      {
        imgurClientId: config.clientId,
        imgurClientSecret: config.clientSecret
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
    const url = result.url;
    const suffixes = { small: 's', medium: 'm', large: 'l' };

    // Imgur URL 格式: https://i.imgur.com/{id}.{ext}
    // 缩略图格式: https://i.imgur.com/{id}{suffix}.{ext}
    const match = url.match(/^(https?:\/\/i\.imgur\.com\/)([^.]+)(\.\w+)$/);
    if (match) {
      return `${match[1]}${match[2]}${suffixes[size]}${match[3]}`;
    }
    return url;
  }

  async testConnection(config?: ImgurServiceConfig): Promise<import('../base/types').ConnectionTestResult> {
    if (!config) {
      return { success: false, error: '缺少 Imgur 配置' };
    }
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
    } catch (error) {
      const latency = Date.now() - startTime;
      return {
        success: false,
        latency,
        error: getErrorMessage(error) || '连接测试失败'
      };
    }
  }
}
