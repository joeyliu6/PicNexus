/**
 * Store 门面实现（组合层）
 * 职责：
 *  1. 保留原 SimpleStore 的全部公开 API（get / set / setDirect / readRawAll / save / clear）
 *     以及构造参数签名，instances.ts / ThemeManager / useConfig / RetryService 等消费方不用动
 *  2. 用 Mutex 串行化所有公开操作，防止读-修改-写竞态
 *  3. 协调 CacheStore（内存层）与 EncryptedStore（磁盘层），并把自愈回调绑到 cache.clear()
 *
 * 设计约束：
 *  - 锁只在本层出现；CacheStore 和 EncryptedStore 都不加锁，从根本上杜绝重入死锁
 *  - 原 _performRead 对损坏文件的恢复路径（写入 defaultValue）现在走 EncryptedStore.loadForRead 的 recovery 参数
 *  - BackupPasswordRequiredError 必须原样传播，不能被外层 catch 包装成 StoreError
 *  - setDirect / set 在写入前必须用 JSON.parse(JSON.stringify(...)) 做 roundtrip，剥离 Vue 响应式 Proxy
 */

import { Mutex } from '../utils/mutex';
import { createLogger } from '../utils/logger';
import { StoreError } from '../utils/storeErrors';
import { BackupPasswordRequiredError } from '../crypto';
import { CacheStore } from './CacheStore';
import { EncryptedStore } from './EncryptedStore';
import { type StoreData, type StoreOptions, toErrorMessage } from './types';

const log = createLogger('Store');

export class MutexStore {
  private readonly filePath: string;
  private readonly mutex = new Mutex();
  private readonly cache = new CacheStore();
  private readonly disk: EncryptedStore;

  /**
   * 创建存储实例
   * @param filename 存储文件名（相对于应用数据目录）
   * @param options.selfHeal 启用自愈模式：解密失败时备份原文件并以空对象继续写入
   * @param options.encrypted 是否启用加密（默认 true）
   * @throws {StoreError} 如果文件名无效
   */
  constructor(filename: string, options: StoreOptions = {}) {
    if (!filename || typeof filename !== 'string' || filename.trim().length === 0) {
      throw new StoreError(
        '文件名不能为空',
        'init',
        undefined,
        new Error('Invalid filename parameter')
      );
    }
    this.filePath = filename.trim();
    this.disk = new EncryptedStore({
      filePath: this.filePath,
      encrypted: options.encrypted ?? true,
      selfHeal: options.selfHeal ?? false,
      // 自愈回调：EncryptedStore 清空磁盘时同步清空内存缓存
      onSelfHeal: () => this.cache.clear(),
    });
  }

  /**
   * 读取存储的数据，带错误恢复机制
   * @param key 数据键
   * @param defaultValue 当文件损坏时使用的默认值（可选）
   * @returns 数据值，如果不存在或读取失败返回 null
   * @throws {StoreError} 严重错误
   * @throws {BackupPasswordRequiredError} 需要输入备份密码
   */
  async get<T>(key: string, defaultValue?: T): Promise<T | null> {
    // 输入验证
    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      log.warn('警告: get() 方法接收到无效的 key 参数:', key);
      return null;
    }

    return this.mutex.withLock(() => this._performRead<T>(key, defaultValue));
  }

  /**
   * 执行实际的读取操作（在锁内调用）
   */
  private async _performRead<T>(key: string, defaultValue?: T): Promise<T | null> {
    // Why: 调用方常传入 DEFAULT_CONFIG 作默认值，若原样返回则 Vue ref 会把模块级常量包成 Proxy，
    //      后续任何 config.value.xxx = ... 会直接污染 DEFAULT_CONFIG。此处统一克隆一次。
    const cloneDefault = (): T | null => {
      if (defaultValue === undefined) return null;
      return typeof defaultValue === 'object' && defaultValue !== null
        ? structuredClone(defaultValue)
        : defaultValue;
    };

    try {
      // 缓存命中：跳过文件 I/O 和解密
      if (this.cache.isLoaded()) {
        const cached = this.cache.get<T>(key);
        if (cached !== undefined) return cached;
        return cloneDefault();
      }

      // 缓存未加载 → 从磁盘加载
      const recovery = defaultValue !== undefined
        ? { key, defaultValue }
        : undefined;
      const data = await this.disk.loadForRead(key, recovery);

      // 文件不存在 / 空 / 自愈重置 / 数据非对象
      if (data === null) return null;

      // 加载完整缓存，后续读取直接从内存返回
      this.cache.replaceAll(data);

      const value = data[key];
      if (value === undefined) {
        log.debug(`键 "${key}" 不存在于数据文件中`);
        return cloneDefault();
      }
      return value as T;
    } catch (error) {
      // 备份密码需要输入：直接传播到 UI 层
      if (error instanceof BackupPasswordRequiredError) {
        throw error;
      }
      // 如果是 StoreError，直接抛出
      if (error instanceof StoreError) {
        log.error(`读取失败 (${key}):`, error.message);
        throw error;
      }
      // 其他未知错误
      const errorMsg = toErrorMessage(error);
      log.error(`未知错误 (${key}):`, errorMsg);
      throw new StoreError(
        `读取数据时发生未知错误: ${errorMsg}`,
        'read',
        key,
        error
      );
    }
  }

  /**
   * 保存数据到存储（读-修改-写，在锁内原子进行）
   * @throws {StoreError} 保存失败
   */
  async set(key: string, value: unknown): Promise<void> {
    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      throw new StoreError(
        '键名不能为空',
        'write',
        key,
        new Error('Invalid key parameter')
      );
    }

    if (value === undefined) {
      log.warn(`警告: 尝试保存 undefined 值到键 "${key}"`);
    }

    await this.mutex.withLock(() => this._performWrite(key, value));
  }

  /**
   * 执行实际的写入操作（在锁内调用）
   */
  private async _performWrite(key: string, value: unknown): Promise<void> {
    try {
      // 取现有数据快照：优先用缓存，缓存未加载走磁盘
      let data: StoreData;
      if (this.cache.isLoaded()) {
        data = this.cache.snapshot();
      } else {
        data = await this.disk.loadForWrite(key);
      }

      // 合并新值
      data[key] = value;

      // 序列化 + roundtrip 剥离 Vue 响应式 Proxy
      let jsonContent: string;
      try {
        jsonContent = JSON.stringify(data, null, 2);
      } catch (stringifyError) {
        throw new StoreError(
          `序列化数据失败: ${toErrorMessage(stringifyError)}`,
          'write',
          key,
          stringifyError
        );
      }
      const parsed = JSON.parse(jsonContent) as StoreData;

      // 写入磁盘 → 同步更新缓存
      await this.disk.writeAll(parsed, key);
      this.cache.replaceAll(parsed);
      log.debug(`成功保存数据到键 "${key}" (${this.filePath})`);
    } catch (error) {
      // 备份密码需要输入：直接传播到 UI 层
      if (error instanceof BackupPasswordRequiredError) {
        throw error;
      }
      if (error instanceof StoreError) {
        log.error(`保存失败 (${key}):`, error.message);
        throw error;
      }
      const errorMsg = toErrorMessage(error);
      log.error(`未知错误 (${key}):`, errorMsg);
      throw new StoreError(
        `保存数据时发生未知错误: ${errorMsg}`,
        'write',
        key,
        error
      );
    }
  }

  /**
   * 直接写入完整数据（跳过读旧文件合并）
   * 用于密钥切换场景：旧文件用旧密钥加密，新密钥无法解密，直接用新密钥全量覆盖
   */
  async setDirect(data: StoreData): Promise<void> {
    await this.mutex.withLock(async () => {
      // 剥离 Proxy 后再写入和缓存
      const parsed = JSON.parse(JSON.stringify(data)) as StoreData;
      await this.disk.writeAll(parsed);
      this.cache.replaceAll(parsed);
      log.info(`✓ 直接写入成功 (${this.filePath})`);
    });
  }

  /**
   * 读取文件的完整原始对象（用于密钥切换时快照全量数据）
   * 不涉及缓存
   * @returns 解密并解析后的完整对象，文件不存在时返回 null
   */
  async readRawAll(): Promise<StoreData | null> {
    return this.mutex.withLock(() => this.disk.readRawAll());
  }

  /**
   * 保存数据（兼容性方法）
   * 注意：在此实现中，`set()` 方法已经自动保存数据，因此此方法为空操作
   */
  async save(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * 清空所有数据
   * @throws {StoreError} 清空失败
   */
  async clear(): Promise<void> {
    await this.mutex.withLock(async () => {
      try {
        await this.disk.clearFile();
        this.cache.clear();
      } catch (error) {
        if (error instanceof StoreError) {
          log.error('清空失败:', error.message);
          throw error;
        }
        const errorMsg = toErrorMessage(error);
        log.error('清空时发生未知错误:', errorMsg);
        throw new StoreError(
          `清空数据时发生未知错误: ${errorMsg}`,
          'clear',
          undefined,
          error
        );
      }
    });
  }
}
