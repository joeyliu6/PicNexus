import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback, ConnectionTestResult } from '../base/types';
import type { WebDAVStorageProfile } from '../../config/types';
import { DEFAULT_WEBDAV_URL_TEMPLATE } from '../../config/types';
import { secureStorage } from '../../security/crypto';
import { assertAllowedWebDAVUrl } from '../../security/networkPolicy';
import { getErrorMessage } from '../../types/errors';
import { invoke } from '@tauri-apps/api/core';

interface WebDAVRustResult {
  url: string;
  remotePath: string;
  fileName: string;
}

interface WebDAVTestRustResult {
  success: boolean;
  message: string;
  probeUrl?: string;
}

/**
 * 解密 profile 密码
 *
 * 空串是合法的中间态（用户刚新建 profile 还没填密码），此时直接返回空串，
 * 让 validateConfig 报"密码不能为空"而不是"解密失败"——后者会把用户引向
 * 错误的排查方向。
 */
async function decryptPassword(profile: WebDAVStorageProfile): Promise<string> {
  if (!profile.passwordEncrypted) return '';
  try {
    return await secureStorage.decrypt(profile.passwordEncrypted);
  } catch {
    throw new Error('WebDAV 密码解密失败，请在设置中重新填写密码');
  }
}

export class WebDAVUploader extends BaseUploader<WebDAVStorageProfile> {
  readonly serviceId = 'webdav';
  readonly serviceName = 'WebDAV';

  protected getRustCommand(): string {
    return 'upload_to_webdav';
  }

  async validateConfig(config: WebDAVStorageProfile): Promise<ValidationResult> {
    const errors: string[] = [];
    const missingFields: string[] = [];

    if (this.isEmpty(config.url)) {
      missingFields.push('url');
      errors.push('WebDAV 地址不能为空');
    } else {
      const urlError = this.checkUrl(config.url, 'WebDAV 地址');
      if (urlError) errors.push(urlError);
    }

    if (this.isEmpty(config.username)) {
      missingFields.push('username');
      errors.push('用户名不能为空');
    }

    if (this.isEmpty(config.passwordEncrypted)) {
      missingFields.push('passwordEncrypted');
      errors.push('密码不能为空');
    }

    // Why 必填：WebDAV 端点本身通常需要认证，直接拿它当图片链接的话，
    // 别人打开会被要求输账号密码，粘进 Markdown 就是一张裂图。
    if (this.isEmpty(config.publicDomain)) {
      missingFields.push('publicDomain');
      errors.push('公开访问域名不能为空（WebDAV 地址通常需要认证，不能直接作为图片链接）');
    } else {
      const domainError = this.checkUrl(config.publicDomain, '公开访问域名');
      if (domainError) errors.push(domainError);
    }

    if (errors.length > 0) {
      return { valid: false, missingFields, errors };
    }

    return { valid: true };
  }

  async upload(
    filePath: string,
    options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    this.log('info', '开始上传到 WebDAV', { filePath });

    const config = options.config as WebDAVStorageProfile;

    const validation = await this.validateConfig(config);
    if (!validation.valid) {
      throw new Error(validation.errors?.join('；') || 'WebDAV 配置不完整');
    }

    const password = await decryptPassword(config);

    const rustResult = await this.uploadViaRust(
      filePath,
      {
        url: config.url,
        username: config.username,
        password,
        remotePath: config.remotePath || '',
        publicDomain: config.publicDomain,
        publicUrlTemplate: config.publicUrlTemplate || DEFAULT_WEBDAV_URL_TEMPLATE
      },
      onProgress
    ) as WebDAVRustResult;

    this.log('info', 'WebDAV 上传成功', { url: rustResult.url });

    return {
      serviceId: this.serviceId,
      fileKey: rustResult.remotePath,
      url: rustResult.url,
      metadata: {
        remotePath: rustResult.remotePath,
        fileName: rustResult.fileName
      }
    };
  }

  getPublicUrl(result: UploadResult): string {
    // URL 已在 Rust 侧按模板渲染完成，直接返回
    return result.url;
  }

  async testConnection(config?: WebDAVStorageProfile): Promise<ConnectionTestResult> {
    if (!config) {
      return { success: false, error: '缺少 WebDAV 配置' };
    }

    const validation = await this.validateConfig(config);
    if (!validation.valid) {
      return { success: false, error: validation.errors?.join('；') || 'WebDAV 配置不完整' };
    }

    const startTime = Date.now();
    try {
      const password = await decryptPassword(config);
      const result = await invoke<WebDAVTestRustResult>('test_webdav_storage', {
        url: config.url,
        username: config.username,
        password,
        remotePath: config.remotePath || '',
        publicDomain: config.publicDomain,
        publicUrlTemplate: config.publicUrlTemplate || DEFAULT_WEBDAV_URL_TEMPLATE
      });

      const latency = Date.now() - startTime;
      return result.success
        ? { success: true, latency }
        : { success: false, latency, error: result.message };
    } catch (error) {
      return {
        success: false,
        latency: Date.now() - startTime,
        error: getErrorMessage(error) || '连接测试失败'
      };
    }
  }

  private checkUrl(rawUrl: string, label: string): string | null {
    try {
      assertAllowedWebDAVUrl(rawUrl);
      return null;
    } catch (error) {
      return `${label}无效：${getErrorMessage(error)}`;
    }
  }
}
