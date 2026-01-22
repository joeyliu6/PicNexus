// 七鱼图床上传器
// 基于网易七鱼客服系统的 NOS 对象存储
// Token 自动获取，需要系统安装 Chrome 浏览器

import { invoke } from '@tauri-apps/api/core';
import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';

interface QiyuRustResult {
  url: string;
  size: number;
}

export class QiyuUploader extends BaseUploader {
  readonly serviceId = 'qiyu';
  readonly serviceName = '七鱼图床';

  protected getRustCommand(): string {
    return 'upload_to_qiyu';
  }

  async validateConfig(_config: any): Promise<ValidationResult> {
    // 七鱼图床不需要手动配置 Token，但需要检查 Chrome 是否安装
    try {
      const chromeInstalled = await invoke<boolean>('check_chrome_installed');
      if (!chromeInstalled) {
        return {
          valid: false,
          errors: ['七鱼图床需要系统安装 Chrome 或 Edge 浏览器才能使用']
        };
      }
      return { valid: true };
    } catch (error) {
      console.error('[QiyuUploader] 检查 Chrome 失败:', error);
      return {
        valid: false,
        errors: ['无法检测 Chrome 安装状态']
      };
    }
  }

  async upload(
    filePath: string,
    _options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    // Token 现在由后端自动获取，不再需要传递
    const rustResult = await this.uploadViaRust(
      filePath,
      {}, // 无需额外参数
      onProgress
    ) as QiyuRustResult;

    return {
      serviceId: 'qiyu',
      fileKey: rustResult.url,
      url: rustResult.url,
      size: rustResult.size
    };
  }

  getPublicUrl(result: UploadResult): string {
    return result.url;
  }

  /**
   * 生成七鱼缩略图 URL
   * 使用 NOS 图片处理参数
   */
  getThumbnailUrl(result: UploadResult): string {
    return `${result.url}?imageView&thumbnail=50x0`;
  }
}
