// src/utils/webdav.ts
// 通用 WebDAV 客户端模块

import { getClient, Body, ResponseType } from '@tauri-apps/api/http';
import { WebDAVConfig } from '../config';

/**
 * WebDAV 客户端类
 * 提供基础的文件读写接口
 */
export class WebDAVClient {
  private config: WebDAVConfig;

  constructor(config: WebDAVConfig) {
    this.config = config;
  }

  /**
   * 更新配置
   * @param config 新的 WebDAV 配置
   */
  updateConfig(config: WebDAVConfig): void {
    this.config = config;
  }

  /**
   * 构建完整的 WebDAV URL
   * @param remotePath 远程路径
   * @returns 完整的 URL
   */
  private buildUrl(remotePath: string): string {
    const baseUrl = this.config.url.trim();
    let path = remotePath.trim();

    // 处理路径拼接
    if (baseUrl.endsWith('/') && path.startsWith('/')) {
      return baseUrl + path.substring(1);
    } else if (baseUrl.endsWith('/') || path.startsWith('/')) {
      return baseUrl + path;
    } else {
      return baseUrl + '/' + path;
    }
  }

  /**
   * 生成 Basic Auth 认证头
   * @returns Base64 编码的认证字符串
   */
  private getAuthHeader(): string {
    const auth = btoa(`${this.config.username.trim()}:${this.config.password.trim()}`);
    return `Basic ${auth}`;
  }

  /**
   * 验证 WebDAV 连接
   * @returns 连接是否成功
   */
  async testConnection(): Promise<boolean> {
    try {
      const client = await getClient();
      const testUrl = this.buildUrl(this.config.remotePath || '/');

      // 使用 PROPFIND 方法测试连接（WebDAV 标准方法）
      // 注意：Tauri HttpVerb 不包含 PROPFIND，使用类型断言
      const response = await client.request({
        method: 'PROPFIND' as 'GET',  // 类型断言绕过 TypeScript 检查
        url: testUrl,
        headers: {
          'Authorization': this.getAuthHeader(),
          'Depth': '0',
        },
        timeout: 10000, // 10秒超时
      });

      // 200, 207 (Multi-Status) 或 404 (文件不存在但连接成功) 都算成功
      return response.ok || response.status === 404;
    } catch (error) {
      console.error('[WebDAV] 连接测试失败:', error);
      return false;
    }
  }

  /**
   * 上传文件到 WebDAV (覆盖模式)
   * @param remotePath 远程路径
   * @param content 文件内容（字符串）
   * @returns 是否成功
   * @throws {Error} 上传失败时抛出错误
   */
  async putFile(remotePath: string, content: string): Promise<void> {
    try {
      const client = await getClient();
      const url = this.buildUrl(remotePath);

      const response = await client.put(url, Body.text(content), {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.getAuthHeader(),
          'Overwrite': 'T', // WebDAV 标准：允许覆盖现有文件
        },
        timeout: 30000, // 30秒超时
      });

      if (!response.ok) {
        const status = response.status;
        let errorMsg = `上传失败: HTTP ${status}`;
        
        if (status === 401 || status === 403) {
          errorMsg = '认证失败，请检查用户名和密码';
        } else if (status === 404) {
          errorMsg = '路径不存在，请检查远程路径配置';
        } else if (status === 507) {
          errorMsg = '存储空间不足，WebDAV 服务器空间已满';
        } else if (status >= 500) {
          errorMsg = `服务器错误 (HTTP ${status})，WebDAV 服务器可能暂时不可用`;
        }
        
        throw new Error(errorMsg);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[WebDAV] 上传文件失败:', errorMsg);
      throw new Error(`WebDAV 上传失败: ${errorMsg}`);
    }
  }

  /**
   * 从 WebDAV 下载文件
   * @param remotePath 远程路径
   * @returns 文件内容（字符串），如果文件不存在返回 null
   * @throws {Error} 下载失败时抛出错误
   */
  async getFile(remotePath: string): Promise<string | null> {
    try {
      const client = await getClient();
      const url = this.buildUrl(remotePath);

      const response = await client.get<string>(url, {
        responseType: ResponseType.Text,
        headers: {
          'Authorization': this.getAuthHeader(),
        },
        timeout: 30000, // 30秒超时
      });

      if (response.status === 404) {
        // 文件不存在，返回 null
        return null;
      }

      if (!response.ok) {
        const status = response.status;
        let errorMsg = `下载失败: HTTP ${status}`;
        
        if (status === 401 || status === 403) {
          errorMsg = '认证失败，请检查用户名和密码';
        } else if (status >= 500) {
          errorMsg = `服务器错误 (HTTP ${status})，WebDAV 服务器可能暂时不可用`;
        }
        
        throw new Error(errorMsg);
      }

      return response.data || null;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // 如果是 404 错误，返回 null 而不是抛出异常
      if (errorMsg.includes('404') || errorMsg.includes('not found')) {
        return null;
      }
      
      console.error('[WebDAV] 下载文件失败:', errorMsg);
      throw new Error(`WebDAV 下载失败: ${errorMsg}`);
    }
  }

  /**
   * 检查文件是否存在
   * @param remotePath 远程路径
   * @returns 文件是否存在
   */
  async exists(remotePath: string): Promise<boolean> {
    try {
      const content = await this.getFile(remotePath);
      return content !== null;
    } catch (error) {
      console.error('[WebDAV] 检查文件存在性失败:', error);
      return false;
    }
  }
}

