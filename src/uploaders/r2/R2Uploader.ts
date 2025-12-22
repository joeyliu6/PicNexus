// src/uploaders/r2/R2Uploader.ts
// Cloudflare R2 上传器实现

import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';
import { R2ServiceConfig } from '../../config/types';
import { convertToR2Error } from './R2Error';
import { basename } from '@tauri-apps/api/path';

/**
 * Rust 返回的 R2 上传结果
 */
interface R2RustResult {
  e_tag?: string;
  size: number;
}

/**
 * Cloudflare R2 上传器
 * 实现 R2 对象存储上传功能
 */
export class R2Uploader extends BaseUploader {
  readonly serviceId = 'r2';
  readonly serviceName = 'Cloudflare R2';

  /**
   * 返回对应的 Rust 命令名
   */
  protected getRustCommand(): string {
    return 'upload_to_r2'; // 新的 Rust 命令
  }

  /**
   * 验证 R2 配置
   */
  async validateConfig(config: any): Promise<ValidationResult> {
    const r2Config = config as R2ServiceConfig;
    const missingFields: string[] = [];

    if (this.isEmpty(r2Config.accountId)) {
      missingFields.push('账户 ID (Account ID)');
    }
    if (this.isEmpty(r2Config.accessKeyId)) {
      missingFields.push('访问密钥 ID (Access Key ID)');
    }
    if (this.isEmpty(r2Config.secretAccessKey)) {
      missingFields.push('访问密钥 (Secret Access Key)');
    }
    if (this.isEmpty(r2Config.bucketName)) {
      missingFields.push('存储桶名称 (Bucket Name)');
    }
    if (this.isEmpty(r2Config.publicDomain)) {
      missingFields.push('公开访问域名 (Public Domain)');
    }

    if (missingFields.length > 0) {
      return {
        valid: false,
        missingFields,
        errors: [`缺少必填字段: ${missingFields.join(', ')}`]
      };
    }

    return { valid: true };
  }

  /**
   * 上传文件到 R2
   */
  async upload(
    filePath: string,
    options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    const config = options.config as R2ServiceConfig;

    this.log('info', '开始上传到 R2', { filePath });

    try {
      // 生成 R2 存储的 Key
      const fileName = await basename(filePath);
      const key = this.buildKey(config.path, fileName);

      this.log('info', 'R2 存储路径', { key });

      // 调用 Rust 上传
      const rustResult = await this.uploadViaRust(
        filePath,
        {
          accountId: config.accountId,
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
          bucketName: config.bucketName,
          key: key
        },
        onProgress
      ) as R2RustResult;

      // 生成公开访问 URL
      const url = this.buildPublicUrl(config.publicDomain, key);

      this.log('info', 'R2 上传成功', { key, url });

      return {
        serviceId: 'r2',
        fileKey: key,
        url: url,
        size: rustResult.size,
        metadata: {
          eTag: rustResult.e_tag,
          bucket: config.bucketName
        }
      };
    } catch (error) {
      this.log('error', 'R2 上传失败', error);
      throw convertToR2Error(error);
    }
  }

  /**
   * 生成 R2 公开访问 URL
   */
  getPublicUrl(result: UploadResult): string {
    return result.url;
  }

  /**
   * 构建 R2 存储 Key
   */
  private buildKey(path: string, fileName: string): string {
    // 清理路径，移除多余的斜杠
    const cleanPath = path.replace(/^\/+|\/+$/g, ''); // 移除首尾斜杠
    const cleanFileName = fileName.replace(/^\/+/, ''); // 移除文件名开头的斜杠

    if (cleanPath) {
      return `${cleanPath}/${cleanFileName}`;
    }

    return cleanFileName;
  }

  /**
   * 构建公开访问 URL
   */
  private buildPublicUrl(publicDomain: string, key: string): string {
    // 移除域名末尾的斜杠
    const domain = publicDomain.replace(/\/+$/, '');
    // 确保 key 不以斜杠开头
    const cleanKey = key.replace(/^\/+/, '');

    return `${domain}/${cleanKey}`;
  }
}
