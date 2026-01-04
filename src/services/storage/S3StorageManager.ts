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
      await this.listObjects({ maxKeys: 1 });
      const latency = Date.now() - startTime;
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

  async listObjects(options: ListOptions = {}): Promise<ListResult> {
    const result = await invoke('list_s3_objects', {
      endpoint: this.getEndpoint(),
      accessKey: this.getAccessKey(),
      secretKey: this.getSecretKey(),
      region: this.getRegion(),
      bucket: this.getBucket(),
      prefix: options.prefix,
      maxKeys: options.maxKeys || 100
    });

    const objects = (result as any[]).map((obj: any) => ({
      key: obj.key,
      name: obj.key.split('/').pop() || obj.key,
      size: obj.size,
      lastModified: new Date(obj.last_modified),
      isDirectory: false,
      url: this.buildPublicUrl(obj.key),
      etag: obj.etag
    }));

    return {
      objects,
      prefixes: [],
      isTruncated: false,
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
