// src/services/storage/S3StorageManager.ts
// S3 兼容存储管理器基类
// 支持：R2、腾讯云 COS、阿里云 OSS、七牛云、又拍云

import { invoke } from '@tauri-apps/api/core';
import { IStorageManager, ListResult, ListOptions, ConnectionTestResult } from './IStorageManager';

export abstract class BaseS3StorageManager implements IStorageManager {
  abstract readonly serviceId: string;
  abstract readonly serviceName: string;

  protected config: any = null;

  protected abstract getEndpoint(): string;
  protected abstract getAccessKey(): string;
  protected abstract getSecretKey(): string;
  protected abstract getRegion(): string;
  protected abstract getBucket(): string;

  async testConnection(): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    try {
      console.log('[S3Manager] 测试连接:', {
        endpoint: this.getEndpoint(),
        region: this.getRegion(),
        bucket: this.getBucket(),
      });

      // 使用后端的测试连接命令（与设置页面一致）
      // 后端期望: serviceId + config 对象
      const result = await invoke('test_s3_connection', {
        serviceId: this.serviceId,
        config: this.config,
      });

      const latency = Date.now() - startTime;
      console.log('[S3Manager] 连接成功, 延迟:', latency, 'ms, 结果:', result);
      return { success: true, latency };
    } catch (error: any) {
      const latency = Date.now() - startTime;

      // 提取错误信息：后端 AppError 格式为 { type: "XXX", data: { message: "..." } }
      let errorMessage = '连接测试失败';
      if (typeof error === 'string') {
        errorMessage = error;
      } else if (error?.data?.message) {
        // Tauri AppError 结构
        errorMessage = error.data.message;
      } else if (error?.message) {
        errorMessage = error.message;
      }

      console.error('[S3Manager] 连接失败:', errorMessage, '类型:', error?.type);
      return { success: false, latency, error: errorMessage };
    }
  }

  async listObjects(options: ListOptions = {}): Promise<ListResult> {
    const result = await invoke('list_s3_objects', {
      endpoint: this.getEndpoint(),
      accessKey: this.getAccessKey(),
      secretKey: this.getSecretKey(),
      region: this.getRegion(),
      bucket: this.getBucket(),
      prefix: options.prefix,
      delimiter: options.delimiter || '/',
      maxKeys: options.maxKeys || 100
    });

    const data = result as {
      objects: any[];
      prefixes: string[];
      is_truncated: boolean;
      continuation_token: string;
    };

    // 解析文件列表，提取文件名（去除当前路径前缀）
    const currentPrefix = options.prefix || '';
    const objects = data.objects.map((obj: any) => ({
      key: obj.key,
      name: obj.key.replace(currentPrefix, '').split('/').pop() || obj.key,
      size: obj.size,
      lastModified: new Date(obj.last_modified),
      isDirectory: false,
      type: 'file' as const,
      url: this.buildPublicUrl(obj.key),
      etag: obj.etag
    }));

    return {
      objects,
      prefixes: data.prefixes,
      isTruncated: data.is_truncated,
      continuationToken: data.continuation_token || undefined,
      totalCount: objects.length
    };
  }

  async uploadFile(
    localPath: string,
    remotePath: string,
    _onProgress?: (percent: number) => void
  ): Promise<string> {
    const result = await invoke('upload_to_s3_compatible', {
      id: `${this.serviceId}_${Date.now()}`,
      filePath: localPath,
      endpoint: this.getEndpoint(),
      accessKey: this.getAccessKey(),
      secretKey: this.getSecretKey(),
      region: this.getRegion(),
      bucket: this.getBucket(),
      key: remotePath,
      publicDomain: this.getPublicDomain()
    });

    return (result as any).url;
  }

  async downloadFile(
    _remotePath: string,
    _localPath: string,
    _onProgress?: (percent: number) => void
  ): Promise<void> {
    throw new Error('下载功能待实现');
  }

  async deleteFile(remotePath: string): Promise<void> {
    await invoke('delete_s3_object', {
      endpoint: this.getEndpoint(),
      accessKey: this.getAccessKey(),
      secretKey: this.getSecretKey(),
      region: this.getRegion(),
      bucket: this.getBucket(),
      key: remotePath
    });
  }

  async deleteFiles(remotePaths: string[]): Promise<{
    success: string[];
    failed: { path: string; error: string }[];
  }> {
    const result = await invoke('delete_s3_objects', {
      endpoint: this.getEndpoint(),
      accessKey: this.getAccessKey(),
      secretKey: this.getSecretKey(),
      region: this.getRegion(),
      bucket: this.getBucket(),
      keys: remotePaths
    });

    const data = result as { success: string[]; failed: string[] };
    return {
      success: data.success,
      failed: data.failed.map(path => ({
        path,
        error: '删除失败'
      }))
    };
  }

  async createFolder(folderPath: string): Promise<void> {
    const path = folderPath.endsWith('/') ? folderPath : folderPath + '/';

    await invoke('create_s3_folder', {
      endpoint: this.getEndpoint(),
      accessKey: this.getAccessKey(),
      secretKey: this.getSecretKey(),
      region: this.getRegion(),
      bucket: this.getBucket(),
      key: path
    });
  }

  protected getPublicDomain(): string {
    return '';
  }

  protected buildPublicUrl(key: string): string {
    const domain = this.getPublicDomain();
    if (domain) {
      return `${domain}/${key}`;
    }
    return `${this.getEndpoint()}/${this.getBucket()}/${key}`;
  }

  init(config: any): void {
    this.config = config;
  }
}
