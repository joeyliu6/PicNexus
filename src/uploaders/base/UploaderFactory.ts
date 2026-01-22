// 上传器工厂类，负责注册和创建上传器实例

import { IUploader } from './IUploader';

/**
 * 上传器工厂函数类型
 */
type UploaderFactoryFunction = () => IUploader;

/**
 * 上传器工厂类
 * 使用工厂模式集中管理所有图床上传器的创建
 *
 * 使用方式：
 * 1. 在应用启动时注册所有上传器
 *    UploaderFactory.register('weibo', () => new WeiboUploader());
 *    UploaderFactory.register('r2', () => new R2Uploader());
 *
 * 2. 根据服务类型创建上传器实例
 *    const uploader = UploaderFactory.create('weibo');
 *
 * 3. 获取所有可用服务列表
 *    const services = UploaderFactory.getAvailableServices();
 */
export class UploaderFactory {
  /**
   * 上传器注册表
   * key: 服务ID (如 'weibo', 'r2')
   * value: 工厂函数（返回上传器实例）
   */
  private static registry: Map<string, UploaderFactoryFunction> = new Map();

  /**
   * 注册上传器
   * 在应用启动时调用，注册所有可用的上传器
   *
   * @param serviceId 服务唯一标识符 (如 'weibo', 'r2', 'nami')
   * @param factory 工厂函数，返回上传器实例
   *
   * @example
   * UploaderFactory.register('weibo', () => new WeiboUploader());
   * UploaderFactory.register('r2', () => new R2Uploader());
   */
  static register(serviceId: string, factory: UploaderFactoryFunction): void {
    if (!serviceId || serviceId.trim().length === 0) {
      throw new Error('服务 ID 不能为空');
    }

    if (this.registry.has(serviceId)) {
      console.warn(`[UploaderFactory] 服务 "${serviceId}" 已存在，将被覆盖`);
    }

    this.registry.set(serviceId, factory);
    console.log(`[UploaderFactory] 已注册上传器: ${serviceId}`);
  }

  /**
   * 创建上传器实例
   * 根据服务 ID 创建对应的上传器实例
   *
   * @param serviceId 服务唯一标识符
   * @returns 上传器实例
   * @throws {Error} 如果服务 ID 未注册
   *
   * @example
   * const uploader = UploaderFactory.create('weibo');
   * const result = await uploader.upload('/path/to/image.jpg', {...});
   */
  static create(serviceId: string): IUploader {
    const factory = this.registry.get(serviceId);

    if (!factory) {
      const available = Array.from(this.registry.keys()).join(', ');
      throw new Error(
        `未知的图床服务: "${serviceId}"\n可用服务: ${available || '无'}`
      );
    }

    try {
      const uploader = factory();
      console.log(`[UploaderFactory] 已创建上传器: ${serviceId} (${uploader.serviceName})`);
      return uploader;
    } catch (error) {
      console.error(`[UploaderFactory] 创建上传器失败: ${serviceId}`, error);
      throw new Error(`创建上传器 "${serviceId}" 失败: ${error}`);
    }
  }

  /**
   * 获取所有已注册的服务 ID 列表
   *
   * @returns 服务 ID 数组
   *
   * @example
   * const services = UploaderFactory.getAvailableServices();
   * // ['weibo', 'r2', 'nami']
   */
  static getAvailableServices(): string[] {
    return Array.from(this.registry.keys());
  }

  /**
   * 检查服务是否已注册
   *
   * @param serviceId 服务 ID
   * @returns 是否已注册
   *
   * @example
   * if (UploaderFactory.isRegistered('weibo')) {
   *   // 服务已注册
   * }
   */
  static isRegistered(serviceId: string): boolean {
    return this.registry.has(serviceId);
  }

  /**
   * 注销服务
   * 从注册表中移除服务（一般用于测试或动态插件场景）
   *
   * @param serviceId 服务 ID
   * @returns 是否成功注销
   *
   * @example
   * UploaderFactory.unregister('weibo');
   */
  static unregister(serviceId: string): boolean {
    const existed = this.registry.has(serviceId);

    if (existed) {
      this.registry.delete(serviceId);
      console.log(`[UploaderFactory] 已注销上传器: ${serviceId}`);
    } else {
      console.warn(`[UploaderFactory] 服务 "${serviceId}" 未注册，无需注销`);
    }

    return existed;
  }

  /**
   * 清空所有注册的服务
   * 一般用于测试场景
   */
  static clear(): void {
    const count = this.registry.size;
    this.registry.clear();
    console.log(`[UploaderFactory] 已清空所有注册的上传器 (共 ${count} 个)`);
  }

  /**
   * 获取注册表的快照（用于调试）
   *
   * @returns 服务 ID 到服务名称的映射
   */
  static getRegistrySnapshot(): Map<string, string> {
    const snapshot = new Map<string, string>();

    for (const [serviceId, factory] of this.registry) {
      try {
        const uploader = factory();
        snapshot.set(serviceId, uploader.serviceName);
      } catch (error) {
        snapshot.set(serviceId, '(创建失败)');
      }
    }

    return snapshot;
  }
}
