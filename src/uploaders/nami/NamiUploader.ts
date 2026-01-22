// 纳米图床上传器实现

import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';
import { NamiServiceConfig } from '../../config/types';
import { invoke } from '@tauri-apps/api/core';

/**
 * 纳米动态 Headers（通过 Sidecar 获取）
 */
interface NamiDynamicHeaders {
  accessToken: string;
  zmToken: string;
}

/**
 * Rust 返回的纳米上传结果
 */
interface NamiRustResult {
  url: string;
  size: number;
  instant: boolean;  // 是否秒传
}

/** Token 刷新间隔（25分钟，略小于30分钟的有效期） */
const TOKEN_REFRESH_INTERVAL_MS = 25 * 60 * 1000;

/**
 * 纳米图床上传器
 * 使用火山引擎 TOS 对象存储
 *
 * 特点：
 * - 需要动态 Headers（通过 Sidecar 获取）
 * - Token 有效期约 30 分钟
 * - 支持自动刷新 Token
 */
export class NamiUploader extends BaseUploader {
  readonly serviceId = 'nami';
  readonly serviceName = '纳米图床';

  /** 上次 Token 获取时间 */
  private lastTokenFetchTime = 0;

  /** 当前配置的凭证（用于检测配置变化） */
  private currentCredentials: { cookie: string; authToken: string } | null = null;

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
   * 检查凭证是否发生变化
   */
  private credentialsChanged(config: NamiServiceConfig): boolean {
    if (!this.currentCredentials) {
      return true;
    }

    return (
      this.currentCredentials.cookie !== config.cookie ||
      this.currentCredentials.authToken !== config.authToken
    );
  }

  /**
   * 确保有新鲜的动态 Token
   *
   * 在以下情况下会刷新 Token：
   * 1. 从未获取过 Token
   * 2. Token 即将过期（25分钟内获取的 Token 不会刷新）
   * 3. 用户凭证发生变化
   */
  private async ensureFreshToken(config: NamiServiceConfig): Promise<void> {
    const now = Date.now();
    const timeSinceLastFetch = now - this.lastTokenFetchTime;

    // 检查是否需要刷新
    const needsRefresh =
      this.lastTokenFetchTime === 0 ||
      timeSinceLastFetch > TOKEN_REFRESH_INTERVAL_MS ||
      this.credentialsChanged(config);

    if (!needsRefresh) {
      // Token 仍然有效，跳过刷新
      return;
    }

    this.log('info', '开始刷新纳米 Token...', {
      reason: this.lastTokenFetchTime === 0
        ? '首次获取'
        : this.credentialsChanged(config)
          ? '凭证变化'
          : 'Token 即将过期'
    });

    try {
      // 通过 Sidecar 获取动态 Headers
      const dynamicHeaders = await invoke<NamiDynamicHeaders>('fetch_nami_token', {
        cookie: config.cookie,
        authToken: config.authToken,
      });

      // 更新状态
      this.lastTokenFetchTime = now;
      this.currentCredentials = {
        cookie: config.cookie,
        authToken: config.authToken
      };

      this.log('info', '纳米 Token 刷新成功', {
        accessToken: dynamicHeaders.accessToken ? '已获取' : '未获取',
        zmToken: dynamicHeaders.zmToken ? '已获取' : '未获取'
      });

    } catch (error: any) {
      // Token 刷新失败，但不阻止上传尝试
      // Rust 端会自行获取动态 Headers
      this.log('warn', '纳米 Token 刷新失败，将在上传时重新获取', {
        error: error.message || error.toString()
      });

      // 如果是首次获取失败，抛出错误
      if (this.lastTokenFetchTime === 0) {
        throw new Error(`无法获取纳米 Token: ${error.message || error}`);
      }
    }
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
      // 确保有新鲜的 Token（不阻塞主流程）
      await this.ensureFreshToken(config).catch((error) => {
        this.log('warn', 'Token 预刷新失败，继续尝试上传', { error: error.message });
      });

      // 调用基类的 Rust 上传方法
      // Rust 端会处理动态 Headers 的获取
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

      // 检查是否是 Token 相关错误
      const errorMsg = error.message || error.toString();
      if (
        errorMsg.includes('Token') ||
        errorMsg.includes('认证') ||
        errorMsg.includes('401') ||
        errorMsg.includes('403')
      ) {
        // 清除状态，下次上传时会重新获取 Token
        this.lastTokenFetchTime = 0;
        this.currentCredentials = null;

        throw new Error(`纳米图床认证失败，请检查 Cookie 和 Auth-Token 是否有效: ${errorMsg}`);
      }

      throw new Error(`纳米图床上传失败: ${errorMsg}`);
    }
  }

  /**
   * 生成公开访问 URL
   */
  getPublicUrl(result: UploadResult): string {
    return result.url;
  }

  /**
   * 生成纳米缩略图 URL
   * 使用火山引擎 TOS 图片处理参数
   */
  getThumbnailUrl(result: UploadResult): string {
    return `${result.url}?x-tos-process=image/resize,l_75/quality,q_70/format,jpg`;
  }

  /**
   * 强制刷新 Token
   *
   * 可在设置页面调用，用于测试 Token 获取
   */
  async forceRefreshToken(config: NamiServiceConfig): Promise<boolean> {
    // 重置状态，强制刷新
    this.lastTokenFetchTime = 0;
    this.currentCredentials = null;

    try {
      await this.ensureFreshToken(config);
      return true;
    } catch {
      return false;
    }
  }
}
