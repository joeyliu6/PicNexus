import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';

interface SmmsRustResult {
  url: string;
  delete?: string;
  hash?: string;
}

export class SmmsUploader extends BaseUploader {
  readonly serviceId = 'smms';
  readonly serviceName = 'SM.MS';

  protected getRustCommand(): string {
    return 'upload_to_smms';
  }

  async validateConfig(config: any): Promise<ValidationResult> {
    if (this.isEmpty(config.token)) {
      return {
        valid: false,
        missingFields: ['token'],
        errors: ['API Token 不能为空']
      };
    }
    return { valid: true };
  }

  async upload(
    filePath: string,
    options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    this.log('info', '开始上传到 SM.MS', { filePath });

    const rustResult = await this.uploadViaRust(
      filePath,
      { smmsToken: options.config.token },
      onProgress
    ) as SmmsRustResult;

    this.log('info', 'SM.MS 上传成功', { url: rustResult.url });

    return {
      serviceId: 'smms',
      fileKey: rustResult.hash || rustResult.url,
      url: rustResult.url,
      metadata: {
        deleteUrl: rustResult.delete
      }
    };
  }

  getPublicUrl(result: UploadResult): string {
    return result.url;
  }

  async testConnection(config: any): Promise<import('../base/types').ConnectionTestResult> {
    const startTime = Date.now();
    try {
      // 调用 SM.MS profile API 验证 Token
      const response = await fetch('https://sm.ms/api/v2/profile', {
        headers: { 'Authorization': config.token }
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
