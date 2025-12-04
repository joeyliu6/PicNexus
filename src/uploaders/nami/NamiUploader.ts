// src/uploaders/nami/NamiUploader.ts
// 纳米图床上传器实现

import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';
import { NamiServiceConfig } from '../../config/types';

/**
 * Rust 返回的纳米上传结果
 */
interface NamiRustResult {
  url: string;
  size: number;
  instant: boolean;  // 是否秒传
}

/**
 * 纳米图床上传器
 * 使用火山引擎 TOS 对象存储
 */
export class NamiUploader extends BaseUploader {
  readonly serviceId = 'nami';
  readonly serviceName = '纳米图床';

  /**
   * 返回对应的 Rust 命令名
   */
  protected getRustCommand(): string {
    return 'upload_to_nami';
  }

  /**
   * 验证纳米配置
   * 纳米图床需要 Cookie 和 Auth-Token 认证
   */
  async validateConfig(config: any): Promise<ValidationResult> {
    const namiConfig = config as NamiServiceConfig;

    // 检查 Cookie 是否存在
    if (!namiConfig.cookie || this.isEmpty(namiConfig.cookie)) {
      return {
        valid: false,
        missingFields: ['Cookie'],
        errors: ['请先在设置中配置纳米 Cookie']
      };
    }

    // 检查 Auth-Token 是否存在
    if (!namiConfig.authToken || this.isEmpty(namiConfig.authToken)) {
      return {
        valid: false,
        missingFields: ['Auth-Token'],
        errors: ['请先在设置中配置纳米 Auth-Token（通过自动获取 Cookie 获得）']
      };
    }

    return { valid: true };
  }

  /**
   * 上传文件到纳米图床
   */
  async upload(
    filePath: string,
    options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    const config = options.config as NamiServiceConfig;

    this.log('info', '开始上传到纳米图床', { filePath });

    try {
      // 调用基类的 Rust 上传方法
      const rustResult = await this.uploadViaRust(
        filePath,
        {
          cookie: config.cookie,
          authToken: config.authToken
        },
        onProgress
      ) as NamiRustResult;

      this.log('info', '纳米图床上传成功', {
        url: rustResult.url,
        instant: rustResult.instant
      });

      return {
        serviceId: 'nami',
        fileKey: rustResult.url,
        url: rustResult.url,
        size: rustResult.size
      };
    } catch (error: any) {
      this.log('error', '纳米图床上传失败', error);
      throw new Error(`纳米图床上传失败: ${error.message || error.toString()}`);
    }
  }

  /**
   * 生成公开访问 URL
   */
  getPublicUrl(result: UploadResult): string {
    return result.url;
  }
}
