import { invoke } from '@tauri-apps/api/core';
import { secureStorage } from '../security/crypto';
import { assertAllowedWebDAVUrl } from '../security/networkPolicy';
import { createLogger } from './logger';

const log = createLogger('WebDAV');

/**
 * 认证失败的统一文案
 *
 * 与 Rust 侧 `src-tauri/src/commands/webdav_upload.rs` 的 `WEBDAV_AUTH_FAILED_MESSAGE`
 * 保持逐字一致：备份链路在这里拦、图床链路在 Rust 拦，是同一件事的两个拦截点，
 * 措辞一旦分叉，用户会以为自己撞上了两个不同的故障。
 *
 * 这条一致性由 `scripts/check-cross-language-constants.mjs` 在 `npm run lint` 阶段守着，
 * 不再只是口头约定；改名或挪窝时同步更新那里的 `PAIRS`。
 *
 * 📌 Rust 侧在 401 时还会读 `WWW-Authenticate` 头，服务端只给 Digest 时换用另一句提示。
 * **这里做不到**——`webdav_request` 的返回值只有 `{status, body}`，拿不到响应头。
 *
 * 但缺口只剩同步过程中的 PUT/GET 这一档：备份的「测试连接」由 Rust 的
 * `main.rs::probe_webdav_connection` 覆盖，它与图床链路共用同一个 `describe_status`。
 * 而连接测试是同步的前置门槛，撞 Digest 必然先在那里撞到。
 */
export const WEBDAV_AUTH_FAILED_MESSAGE = '认证失败，请检查用户名和密码';

/**
 * 认证过了但没权限（403）的统一文案
 *
 * 与 Rust 侧 `webdav_upload.rs` 的 `WEBDAV_FORBIDDEN_MESSAGE` 逐字一致，同样由
 * `scripts/check-cross-language-constants.mjs` 守着。
 *
 * Why 不并进上面那句：403 的含义是「工牌验过了，只是这扇门你进不去」——只读共享、
 * 目录权限没开、服务端按路径限制都会撞到它。混用 401 的文案会让用户一直去改
 * 本来就没错的密码。
 */
export const WEBDAV_FORBIDDEN_MESSAGE = '访问被拒绝，请检查账号对该路径的读写权限';

interface WebDAVClientConfig {
  url: string;
  username: string;
  password: string;
  remotePath?: string;
}

interface WebDAVRequestOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

interface WebDAVResponse {
  status: number;
  body?: string | null;
}

async function webdavRequest(options: WebDAVRequestOptions): Promise<WebDAVResponse> {
  assertAllowedWebDAVUrl(options.url);
  return await invoke<WebDAVResponse>('webdav_request', {
    request: {
      method: options.method,
      url: options.url,
      headers: options.headers ?? {},
      body: options.body ?? null,
      timeoutMs: options.timeoutMs ?? null,
    },
  });
}

function isOkStatus(status: number): boolean {
  return status >= 200 && status <= 299;
}

export class WebDAVClient {
  private config: WebDAVClientConfig;

  constructor(config: WebDAVClientConfig) {
    this.config = { ...config };
  }

  static async fromEncryptedConfig(encryptedConfig: {
    url: string;
    username: string;
    password?: string;
    passwordEncrypted?: string;
    remotePath?: string;
  }): Promise<WebDAVClient> {
    let decryptedPassword = '';

    if (encryptedConfig.passwordEncrypted) {
      try {
        decryptedPassword = await secureStorage.decrypt(encryptedConfig.passwordEncrypted);
      } catch (error) {
        log.error('密码解密失败', error);
        throw new Error('WebDAV 密码解密失败，请重新配置');
      }
    } else if (encryptedConfig.password) {
      log.warn('使用明文密码（建议重新保存配置以启用加密）');
      decryptedPassword = encryptedConfig.password;
    } else {
      throw new Error('WebDAV 密码未配置');
    }

    return new WebDAVClient({
      url: encryptedConfig.url,
      username: encryptedConfig.username,
      password: decryptedPassword,
      remotePath: encryptedConfig.remotePath,
    });
  }

  static async encryptPassword(password: string): Promise<string> {
    return await secureStorage.encrypt(password);
  }

  static async decryptPassword(encryptedPassword: string): Promise<string> {
    if (!encryptedPassword) return '';
    try {
      return await secureStorage.decrypt(encryptedPassword);
    } catch (error) {
      log.error('密码解密失败', error);
      return '';
    }
  }

  updateConfig(config: WebDAVClientConfig): void {
    this.config = { ...config };
  }

  private buildUrl(remotePath: string): string {
    const baseUrl = this.config.url.trim();
    assertAllowedWebDAVUrl(baseUrl);
    const path = remotePath.trim();

    if (baseUrl.endsWith('/') && path.startsWith('/')) return baseUrl + path.substring(1);
    if (baseUrl.endsWith('/') || path.startsWith('/')) return baseUrl + path;
    return `${baseUrl}/${path}`;
  }

  private getAuthHeader(): string {
    const credentials = `${this.config.username.trim()}:${this.config.password.trim()}`;
    const bytes = new TextEncoder().encode(credentials);
    const base64 = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
    return `Basic ${base64}`;
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await webdavRequest({
        method: 'PROPFIND',
        url: this.buildUrl(this.config.remotePath || '/'),
        headers: {
          Authorization: this.getAuthHeader(),
          Depth: '0',
        },
        timeoutMs: 10000,
      });

      return isOkStatus(response.status) || response.status === 404;
    } catch (error) {
      log.error('连接测试失败', error);
      return false;
    }
  }

  async putFile(remotePath: string, content: string): Promise<void> {
    const lastSlashIndex = remotePath.lastIndexOf('/');
    if (lastSlashIndex > 0) {
      await this.ensureDir(remotePath.substring(0, lastSlashIndex + 1));
    }

    const url = this.buildUrl(remotePath);
    let response: WebDAVResponse;
    try {
      response = await webdavRequest({
        method: 'PUT',
        url,
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.getAuthHeader(),
          Overwrite: 'T',
        },
        body: content,
        timeoutMs: 30000,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('上传文件失败', errorMsg);
      throw new Error(`WebDAV 上传失败: ${errorMsg}`);
    }

    if (!isOkStatus(response.status)) {
      const status = response.status;
      if (status === 401) throw new Error(WEBDAV_AUTH_FAILED_MESSAGE);
      if (status === 403) throw new Error(WEBDAV_FORBIDDEN_MESSAGE);
      if (status === 404) throw new Error('路径不存在，请检查远程路径配置');
      if (status === 507) throw new Error('存储空间不足，WebDAV 服务器空间已满');
      if (status >= 500) throw new Error(`服务器错误 (HTTP ${status})，WebDAV 服务器可能暂时不可用`);
      throw new Error(`上传失败: HTTP ${status}`);
    }
  }

  async getFile(remotePath: string): Promise<string | null> {
    const url = this.buildUrl(remotePath);
    let response: WebDAVResponse;
    try {
      response = await webdavRequest({
        method: 'GET',
        url,
        headers: {
          Authorization: this.getAuthHeader(),
        },
        timeoutMs: 30000,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('下载文件失败', errorMsg);
      throw new Error(`WebDAV 下载失败: ${errorMsg}`);
    }

    if (response.status === 404) return null;

    if (!isOkStatus(response.status)) {
      const status = response.status;
      if (status === 401) throw new Error(WEBDAV_AUTH_FAILED_MESSAGE);
      if (status === 403) throw new Error(WEBDAV_FORBIDDEN_MESSAGE);
      if (status >= 500) throw new Error(`服务器错误 (HTTP ${status})，WebDAV 服务器可能暂时不可用`);
      throw new Error(`下载失败: HTTP ${status}`);
    }

    return response.body ?? '';
  }

  async exists(remotePath: string): Promise<boolean> {
    try {
      const response = await webdavRequest({
        method: 'PROPFIND',
        url: this.buildUrl(remotePath),
        headers: {
          Authorization: this.getAuthHeader(),
          Depth: '0',
        },
        timeoutMs: 10000,
      });
      return isOkStatus(response.status);
    } catch (error) {
      log.error('检查文件存在性失败', error);
      return false;
    }
  }

  async mkDir(remotePath: string): Promise<boolean> {
    try {
      const dirPath = remotePath.endsWith('/') ? remotePath : `${remotePath}/`;
      const response = await webdavRequest({
        method: 'MKCOL',
        url: this.buildUrl(dirPath),
        headers: {
          Authorization: this.getAuthHeader(),
        },
        timeoutMs: 10000,
      });

      const status = response.status;
      if (status === 201 || status === 405 || status === 301 || status === 302) return true;
      if (status === 409) {
        log.warn('创建目录失败: 父目录不存在', { dirPath });
        return false;
      }

      log.error('创建目录失败', { status, dirPath });
      return false;
    } catch (error) {
      log.error('创建目录异常', error);
      return false;
    }
  }

  async ensureDir(remotePath: string): Promise<void> {
    let path = remotePath.trim();
    if (!path.startsWith('/')) path = `/${path}`;
    if (!path.endsWith('/')) path = `${path}/`;

    const parts = path.split('/').filter(p => p.length > 0);
    let currentPath = '/';
    for (const part of parts) {
      currentPath += `${part}/`;
      const success = await this.mkDir(currentPath);
      if (!success) {
        log.warn('创建目录可能失败，继续尝试', { currentPath });
      }
    }
  }
}
