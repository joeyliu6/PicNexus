// src/services/storage/StorageManagerFactory.ts
// 云存储管理器工厂

import { IStorageManager } from './IStorageManager';
import { R2StorageManager } from './R2StorageManager';
import { TencentStorageManager } from './TencentStorageManager';
import { AliyunStorageManager } from './AliyunStorageManager';
import { QiniuStorageManager } from './QiniuStorageManager';
import { UpyunStorageManager } from './UpyunStorageManager';

export class StorageManagerFactory {
  private static managers: Map<string, () => IStorageManager> = new Map();

  static {
    this.register('r2', () => new R2StorageManager());
    this.register('tencent', () => new TencentStorageManager());
    this.register('aliyun', () => new AliyunStorageManager());
    this.register('qiniu', () => new QiniuStorageManager());
    this.register('upyun', () => new UpyunStorageManager());
  }

  static register(serviceId: string, factory: () => IStorageManager): void {
    this.managers.set(serviceId, factory);
  }

  static create(serviceId: string, config: any): IStorageManager {
    const factory = this.managers.get(serviceId);
    if (!factory) {
      throw new Error(`未知的存储服务: ${serviceId}`);
    }
    const manager = factory();
    manager.init(config);
    return manager;
  }

  static getSupportedServices(): string[] {
    return Array.from(this.managers.keys());
  }
}
