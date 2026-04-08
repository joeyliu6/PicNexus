// 简单的存储工具，使用 Tauri 的 fs API 替代 tauri-plugin-store-api
// v2.8: 支持加密存储，使用 AES-GCM 加密敏感数据
// v2.9: 增强并发控制，使用全局互斥锁防止竞态条件
// v2.10: 添加内存缓存，避免同一会话内重复解密
import { readTextFile, writeTextFile, exists, mkdir, remove } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { secureStorage, isAnyEncryptedData, BackupPasswordRequiredError } from './crypto';
import { createLogger } from './utils/logger';
import { Mutex } from './utils/mutex';
import { StoreError } from './utils/storeErrors';

export { StoreError } from './utils/storeErrors';

const log = createLogger('Store');

/**
 * 简单的键值存储类
 * 使用 JSON 文件存储数据，提供并发控制和错误处理
 * v2.9: 使用全局互斥锁确保读-修改-写操作的原子性
 */
class SimpleStore {
  /** 存储文件的路径（相对于应用数据目录） */
  private filePath: string;

  /** 全局互斥锁，用于保护读-修改-写操作 */
  private mutex: Mutex = new Mutex();

  /** 是否启用自愈模式（解密失败时备份后重置，而非中止写入） */
  private selfHeal: boolean;
  private encrypted: boolean;

  /** 内存缓存：避免同一会话内对同一文件重复读取和解密 */
  private memCache: Record<string, any> = {};

  /** 缓存是否已从磁盘完整加载过 */
  private cacheLoaded = false;

  /**
   * 创建存储实例
   * @param filename 存储文件名（相对于应用数据目录）
   * @param options.selfHeal 启用自愈模式：解密失败时备份原文件并以空对象继续写入（适用于可重建的瞬态存储）
   * @throws {StoreError} 如果文件名无效
   */
  constructor(filename: string, options: { selfHeal?: boolean; encrypted?: boolean } = {}) {
    if (!filename || typeof filename !== 'string' || filename.trim().length === 0) {
      throw new StoreError(
        '文件名不能为空',
        'init',
        undefined,
        new Error('Invalid filename parameter')
      );
    }
    this.filePath = filename.trim();
    this.selfHeal = options.selfHeal ?? false;
    this.encrypted = options.encrypted ?? true;
  }
  
  /**
   * 自愈重置：删除文件并清空内存缓存
   * write 路径删除失败时抛出错误（防止写入脏数据导致死循环）
   */
  private async selfHealReset(dataPath: string, throwOnRemoveFail: boolean, key?: string): Promise<void> {
    log.warn(`⚠ 自愈模式：明文 store 检测到加密数据，自动删除并重置 (${this.filePath})`);
    try {
      await remove(dataPath);
    } catch (e) {
      if (!throwOnRemoveFail) return;
      log.error(`⚠ 自愈模式删除文件失败，无法继续写入 (${this.filePath})`, e);
      throw new StoreError(`自愈模式删除文件失败`, 'write', key, e as Error);
    }
    this.memCache = {};
    this.cacheLoaded = false;
  }

  /**
   * 获取数据文件路径
   * @throws {StoreError} 如果无法获取应用数据目录
   */
  private async getDataPath(): Promise<string> {
    try {
      const appDir = await appDataDir();
      if (!appDir) {
        throw new StoreError(
          '无法获取应用数据目录',
          'init',
          undefined,
          new Error('appDataDir returned null or undefined')
        );
      }
      const dataPath = await join(appDir, this.filePath);
      if (!dataPath) {
        throw new StoreError(
          '无法构建数据文件路径',
          'init',
          undefined,
          new Error('join returned null or undefined')
        );
      }
      return dataPath;
    } catch (error) {
      if (error instanceof StoreError) {
        throw error;
      }
      throw new StoreError(
        `获取数据路径失败: ${error instanceof Error ? error.message : String(error)}`,
        'init',
        undefined,
        error
      );
    }
  }

  /**
   * 读取存储的数据，带错误恢复机制
   * 如果配置文件损坏，自动使用默认配置并创建备份
   * @param key 数据键
   * @param defaultValue 当文件损坏时使用的默认值（可选）
   * @returns 数据值，如果不存在或读取失败返回 null
   * @throws {StoreError} 如果发生严重错误（如权限问题）
   */
  async get<T>(key: string, defaultValue?: T): Promise<T | null> {
    // 输入验证
    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      log.warn('警告: get() 方法接收到无效的 key 参数:', key);
      return null;
    }

    // 【v2.10】使用互斥锁保护读操作，防止与并发写入产生竞态条件
    return this.mutex.withLock(() => this._performRead<T>(key, defaultValue));
  }

  /**
   * 执行实际的读取操作（在锁内调用）
   * 注意：恢复损坏文件时直接调用 _performWrite 而非 set，避免二次加锁导致死锁
   */
  private async _performRead<T>(key: string, defaultValue?: T): Promise<T | null> {
    // 缓存命中：跳过文件 I/O 和解密
    if (this.cacheLoaded) {
      const cached = this.memCache[key];
      if (cached !== undefined) return cached as T;
      return defaultValue !== undefined ? defaultValue : null;
    }

    try {
      const dataPath = await this.getDataPath();

      // 检查文件是否存在
      const fileExists = await exists(dataPath);
      if (!fileExists) {
        log.debug(`数据文件不存在: ${this.filePath}，返回 null`);
        return null;
      }

      // 读取文件内容
      let content: string;
      try {
        content = await readTextFile(dataPath);
      } catch (readError: any) {
        // 文件读取失败可能是权限问题或文件被占用
        const errorMsg = readError?.message || String(readError);
        if (errorMsg.includes('Permission') || errorMsg.includes('permission')) {
          throw new StoreError(
            `读取文件权限不足: ${dataPath}`,
            'read',
            key,
            readError
          );
        }
        if (errorMsg.includes('not found') || errorMsg.includes('不存在')) {
          log.debug(`文件不存在: ${dataPath}`);
          return null;
        }
        throw new StoreError(
          `读取文件失败: ${errorMsg}`,
          'read',
          key,
          readError
        );
      }

      // 验证文件内容不为空
      if (!content || content.trim().length === 0) {
        log.warn(`警告: 数据文件为空: ${this.filePath}`);
        return null;
      }

      // 【v3.0 加密存储】尝试解密
      // 支持 PNXENC（随机密钥）和 PNXPWD（备份密码）两种格式
      let decryptedContent = content;
      const trimmedContent = content.trim();
      if (!this.encrypted && isAnyEncryptedData(trimmedContent)) {
        if (this.selfHeal) {
          await this.selfHealReset(dataPath, false);
          return null;
        }
        throw new StoreError(
          `Detected encrypted data in plaintext store ${this.filePath}. Please delete the file manually and retry.`,
          'read',
          key
        );
      }
      try {
        if (this.encrypted && isAnyEncryptedData(trimmedContent)) {
          log.debug(`检测到加密数据，尝试解密...`);
          decryptedContent = await secureStorage.decrypt(trimmedContent);
          log.info(`✓ 解密成功`);
        } else if (this.encrypted && !trimmedContent.startsWith('{') && !trimmedContent.startsWith('[')) {
          // 向后兼容：旧版本加密数据（无魔数前缀）
          log.debug(`检测到可能的旧版加密数据，尝试解密...`);
          try {
            decryptedContent = await secureStorage.decrypt(trimmedContent);
            log.info(`✓ 旧版加密数据解密成功`);
          } catch {
            log.warn(`旧版解密失败，尝试按明文解析`);
            decryptedContent = content;
          }
        }
      } catch (decryptError: any) {
        // 备份密码需要输入：直接传播，不降级
        if (decryptError instanceof BackupPasswordRequiredError) {
          throw decryptError;
        }
        if (decryptError instanceof StoreError) {
          throw decryptError;
        }
        const errorMsg = decryptError?.message || String(decryptError);
        log.error(`解密失败: ${errorMsg}`);
        throw new StoreError(`加密数据解密失败: ${errorMsg}`, 'read', key);
      }

      // 解析 JSON
      let data: Record<string, any>;
      try {
        data = JSON.parse(decryptedContent);
      } catch (parseError: any) {
        // JSON 解析失败，文件可能损坏
        const errorMsg = parseError?.message || String(parseError);
        log.error(`JSON 解析失败 (${this.filePath}):`, errorMsg);
        log.error(`文件内容预览 (前200字符):`, content.substring(0, 200));

        // 如果提供了默认值，尝试恢复
        if (defaultValue !== undefined) {
          log.warn(`文件损坏，尝试使用默认值恢复配置: ${key}`);

          // 创建损坏文件的备份
          try {
            const backupPath = `${dataPath}.corrupted.${Date.now()}`;
            await writeTextFile(backupPath, content);
            log.info(`✓ 已创建损坏文件的备份: ${backupPath}`);
          } catch (backupError) {
            log.warn(`创建备份失败:`, backupError);
          }

          // 直接调用 _performWrite 恢复，避免通过 set() 二次加锁导致死锁
          try {
            await this._performWrite(key, defaultValue);
            log.info(`✓ 已使用默认值恢复配置: ${key}`);
            return defaultValue;
          } catch (recoverError) {
            log.error(`恢复配置失败:`, recoverError);
          }
        }

        throw new StoreError(
          `数据文件格式错误（可能已损坏）: ${errorMsg}`,
          'read',
          key,
          parseError
        );
      }

      // 验证数据是对象
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        log.warn(`警告: 数据格式不正确，期望对象，实际: ${typeof data}`);
        return null;
      }

      const value = data[key];
      if (value === undefined) {
        log.debug(`键 "${key}" 不存在于数据文件中`);
        // 加载完整缓存，后续读取直接从内存返回
        this.memCache = { ...data };
        this.cacheLoaded = true;
        return defaultValue !== undefined ? defaultValue : null;
      }

      // 加载完整缓存，后续读取直接从内存返回
      this.memCache = { ...data };
      this.cacheLoaded = true;
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
      const errorMsg = error instanceof Error ? error.message : String(error);
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
   * 从磁盘加载完整数据（仅在缓存未初始化时调用）
   * 支持 PNXENC 和 PNXPWD 两种加密格式，以及旧版兼容
   */
  private async _loadFromDisk(key: string, dataPath: string): Promise<Record<string, any>> {
    const fileExists = await exists(dataPath);
    if (!fileExists) return {};

    let oldFileContent: string;
    try {
      oldFileContent = await readTextFile(dataPath);
    } catch (readError: any) {
      const errorMsg = readError?.message || String(readError);
      if (errorMsg.includes('Permission') || errorMsg.includes('permission')) {
        throw new StoreError(`读取现有数据权限不足: ${dataPath}`, 'write', key, readError);
      }
      throw new StoreError(
        `无法读取现有数据文件，操作中止以防止数据丢失: ${errorMsg}`,
        'write', key, readError
      );
    }

    if (!oldFileContent || oldFileContent.trim().length === 0) return {};

    let oldContent = oldFileContent;
    const trimmedContent = oldFileContent.trim();
    if (!this.encrypted && isAnyEncryptedData(trimmedContent)) {
      if (this.selfHeal) {
        await this.selfHealReset(dataPath, true, key);
        return {};
      }
      throw new StoreError(
        `Detected encrypted data in plaintext store ${this.filePath}. Please delete the file manually and retry.`,
        'write',
        key
      );
    }

    if (this.encrypted && isAnyEncryptedData(trimmedContent)) {
      try {
        log.debug(`检测到加密数据，尝试解密...`);
        oldContent = await secureStorage.decrypt(trimmedContent);
        log.info(`✓ 解密成功`);
      } catch (decryptError: any) {
        if (decryptError instanceof BackupPasswordRequiredError) throw decryptError;
        const errorMsg = decryptError?.message || String(decryptError);
        log.error(`解密失败: ${errorMsg}`);
        try {
          const backupPath = `${dataPath}.corrupted.${Date.now()}`;
          await writeTextFile(backupPath, oldFileContent);
          log.info(`✓ 已创建损坏文件的备份: ${backupPath}`);
        } catch (backupError) {
          log.warn(`创建备份失败:`, backupError);
        }
        if (this.selfHeal) {
          try { await remove(dataPath); } catch {}
          log.warn(`⚠ 自愈模式：已备份损坏文件并重置，继续写入新数据 (${this.filePath})`);
          return {};
        }
        throw new StoreError(
          `配置文件解密失败，操作中止以防止数据丢失: ${errorMsg}`,
          'write', key, decryptError
        );
      }
    } else if (this.encrypted && !trimmedContent.startsWith('{') && !trimmedContent.startsWith('[')) {
      try {
        log.debug(`检测到可能的旧版加密数据，尝试解密...`);
        oldContent = await secureStorage.decrypt(trimmedContent);
        log.info(`✓ 旧版加密数据解密成功`);
      } catch (decryptError: any) {
        const errorMsg = decryptError?.message || String(decryptError);
        log.warn(`旧版解密失败，尝试按明文解析: ${errorMsg}`);
        oldContent = oldFileContent;
      }
    }

    try {
      const data = JSON.parse(oldContent);
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        log.warn('警告: 现有数据格式不正确（非对象），创建备份后重置');
        try {
          const backupPath = `${dataPath}.invalid.${Date.now()}`;
          await writeTextFile(backupPath, oldFileContent);
          log.info(`✓ 已创建无效数据的备份: ${backupPath}`);
        } catch (backupError) {
          log.warn(`创建备份失败:`, backupError);
        }
        return {};
      }
      return data;
    } catch (parseError: any) {
      const errorMsg = parseError?.message || String(parseError);
      log.error(`JSON 解析失败 (${this.filePath}):`, errorMsg);
      try {
        const backupPath = `${dataPath}.corrupted.${Date.now()}`;
        await writeTextFile(backupPath, oldFileContent);
        log.info(`✓ 已创建损坏文件的备份: ${backupPath}`);
      } catch (backupError) {
        log.warn(`创建备份失败:`, backupError);
      }
      throw new StoreError(
        `配置文件已损坏，操作中止以防止数据丢失。已创建备份文件。错误: ${errorMsg}`,
        'write', key, parseError
      );
    }
  }

  /**
   * 保存数据到存储
   * 使用互斥锁确保读-修改-写操作的原子性，防止竞态条件
   * @param key 数据键
   * @param value 数据值
   * @throws {StoreError} 如果保存失败
   */
  async set(key: string, value: any): Promise<void> {
    // 输入验证
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

    // 【v2.9】使用互斥锁保护整个读-修改-写操作
    // 这确保了即使有多个并发写入，也不会发生数据覆盖
    await this.mutex.withLock(async () => {
      await this._performWrite(key, value);
    });
  }
  
  /**
   * 直接写入完整数据（跳过读旧文件合并）
   * 用于密钥切换场景：旧文件用旧密钥加密，新密钥无法解密，
   * 所以跳过读取直接用新密钥加密写入全量数据
   */
  async setDirect(data: Record<string, any>): Promise<void> {
    await this.mutex.withLock(async () => {
      const dataPath = await this.getDataPath();
      const appDir = await appDataDir();
      await mkdir(appDir, { recursive: true });

      const jsonContent = JSON.stringify(data, null, 2);
      const contentToWrite = this.encrypted
        ? await secureStorage.encrypt(jsonContent)
        : jsonContent;
      await writeTextFile(dataPath, contentToWrite);
      // 密钥切换后同步更新缓存
      this.memCache = JSON.parse(jsonContent) as Record<string, any>;
      this.cacheLoaded = true;
      log.info(`✓ 直接写入成功 (${this.filePath})`);
    });
  }

  /**
   * 读取文件的完整原始对象（用于密钥切换时快照全量数据）
   * @returns 解密并解析后的完整对象，文件不存在时返回 null
   */
  async readRawAll(): Promise<Record<string, unknown> | null> {
    return this.mutex.withLock(async () => {
      const dataPath = await this.getDataPath();
      if (!await exists(dataPath)) return null;
      const content = await readTextFile(dataPath);
      if (!content || !content.trim()) return null;
      const trimmed = content.trim();
      let decoded = content;
      if (this.encrypted) {
        if (isAnyEncryptedData(trimmed)) {
          decoded = await secureStorage.decrypt(trimmed);
        }
      } else if (isAnyEncryptedData(trimmed)) {
        if (this.selfHeal) {
          await this.selfHealReset(dataPath, false);
          return null;
        }
        throw new StoreError(
          `Detected encrypted data in plaintext store ${this.filePath}. Please delete the file manually and retry.`,
          'read'
        );
      }
      return JSON.parse(decoded) as Record<string, unknown>;
    });
  }

  /**
   * 执行实际的写入操作
   * 支持原子性写入
   */
  private async _performWrite(key: string, value: any): Promise<void> {
    try {
      const dataPath = await this.getDataPath();
      const appDir = await appDataDir();

      // 确保目录存在
      try {
        await mkdir(appDir, { recursive: true });
      } catch (dirError: any) {
        const errorMsg = dirError?.message || String(dirError);
        if (errorMsg.includes('Permission') || errorMsg.includes('permission')) {
          throw new StoreError(
            `创建目录权限不足: ${appDir}`,
            'write',
            key,
            dirError
          );
        }
        throw new StoreError(
          `创建目录失败: ${errorMsg}`,
          'write',
          key,
          dirError
        );
      }

      // 优先从内存缓存获取现有数据，避免重复读取文件和解密
      let data: Record<string, any>;
      if (this.cacheLoaded) {
        data = { ...this.memCache };
      } else {
        // 缓存未加载时，走原有文件读取流程
        data = await this._loadFromDisk(key, dataPath);
      }

      // 更新数据并同步内存缓存
      data[key] = value;

      // 序列化数据
      let jsonContent: string;
      try {
        jsonContent = JSON.stringify(data, null, 2);
      } catch (stringifyError: any) {
        throw new StoreError(
          `序列化数据失败: ${stringifyError?.message || String(stringifyError)}`,
          'write',
          key,
          stringifyError
        );
      }

      // 生成纯 JSON 的内存缓存，避免响应式 Proxy 留在缓存中
      this.memCache = JSON.parse(jsonContent) as Record<string, any>;
      this.cacheLoaded = true;

      // 【v2.8 加密存储】加密数据（或直接明文写入）
      let contentToWrite = jsonContent;
      if (this.encrypted) {
        try {
          contentToWrite = await secureStorage.encrypt(jsonContent);
        } catch (encryptError: any) {
          const errorMsg = encryptError?.message || String(encryptError);
          log.error(`加密失败: ${errorMsg}`);
          throw new StoreError(
            `加密数据失败: ${errorMsg}`,
            'write',
            key,
            encryptError
          );
        }
      }

      // [v2.7 优化] 原子性写入：直接写入目标文件
      // Tauri 的 writeTextFile 本身是原子性的，可以直接覆盖原文件
      // 【v2.8】写入加密后的内容
      try {
        await writeTextFile(dataPath, contentToWrite);
        log.debug(`成功保存数据到键 "${key}" (${this.filePath})`);
      } catch (writeError: any) {
        
        const errorMsg = writeError?.message || String(writeError);
        if (errorMsg.includes('Permission') || errorMsg.includes('permission')) {
          throw new StoreError(
            `写入文件权限不足: ${dataPath}`,
            'write',
            key,
            writeError
          );
        }
        if (errorMsg.includes('disk') || errorMsg.includes('space') || errorMsg.includes('空间')) {
          throw new StoreError(
            `磁盘空间不足，无法保存数据: ${errorMsg}`,
            'write',
            key,
            writeError
          );
        }
        throw new StoreError(
          `写入文件失败: ${errorMsg}`,
          'write',
          key,
          writeError
        );
      }
    } catch (error) {
      // 备份密码需要输入：直接传播到 UI 层
      if (error instanceof BackupPasswordRequiredError) {
        throw error;
      }
      // 如果是 StoreError，直接抛出
      if (error instanceof StoreError) {
        log.error(`保存失败 (${key}):`, error.message);
        throw error;
      }
      // 其他未知错误
      const errorMsg = error instanceof Error ? error.message : String(error);
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
   * 保存数据（兼容性方法）
   * 注意：在此实现中，`set()` 方法已经自动保存数据，因此此方法为空操作
   * 保留此方法是为了与旧 API 兼容
   */
  async save(): Promise<void> {
    // 对于简单存储，set 已经保存了，这个方法保持兼容性
    return Promise.resolve();
  }

  /**
   * 清空所有数据
   * 将存储文件重置为空对象
   * @throws {StoreError} 如果清空失败
   */
  async clear(): Promise<void> {
    // 【v2.10】使用互斥锁保护清空操作，防止与并发 set() 竞态导致 clear 效果丢失
    await this.mutex.withLock(async () => {
      try {
        const dataPath = await this.getDataPath();
        const fileExists = await exists(dataPath);
        if (!fileExists) {
          log.debug(`数据文件不存在，无需清空: ${this.filePath}`);
          return;
        }

        try {
          const emptyJson = JSON.stringify({}, null, 2);
          const contentToWrite = this.encrypted
            ? await secureStorage.encrypt(emptyJson)
            : emptyJson;
          await writeTextFile(dataPath, contentToWrite);
          // 同步清空内存缓存
          this.memCache = {};
          this.cacheLoaded = false;
          log.info(`✓ 成功清空数据文件: ${this.filePath}`);
        } catch (writeError: any) {
          const errorMsg = writeError?.message || String(writeError);
          if (errorMsg.includes('Permission') || errorMsg.includes('permission')) {
            throw new StoreError(
              `清空文件权限不足: ${dataPath}`,
              'clear',
              undefined,
              writeError
            );
          }
          throw new StoreError(
            `清空文件失败: ${errorMsg}`,
            'clear',
            undefined,
            writeError
          );
        }
      } catch (error) {
        if (error instanceof StoreError) {
          log.error('清空失败:', error.message);
          throw error;
        }
        const errorMsg = error instanceof Error ? error.message : String(error);
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

/**
 * 导出存储类
 * 使用别名 `Store` 以保持与旧 API 的兼容性
 */
export { SimpleStore as Store };
