// 简单的存储工具，使用 Tauri 的 fs API 替代 tauri-plugin-store-api
// v2.8: 支持加密存储，使用 AES-GCM 加密敏感数据
// v2.9: 增强并发控制，使用全局互斥锁防止竞态条件
import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { secureStorage, isEncryptedData } from './crypto';

/**
 * 简单的 Promise-based 互斥锁
 * 用于防止并发文件操作导致的竞态条件
 */
class Mutex {
  private locked = false;
  private waitQueue: Array<() => void> = [];

  /**
   * 获取锁
   * 如果锁已被持有，则等待直到锁可用
   */
  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    // 等待锁释放
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  /**
   * 释放锁
   * 如果有等待的任务，唤醒队列中的第一个任务
   */
  release(): void {
    if (this.waitQueue.length > 0) {
      // 唤醒队列中的下一个等待者
      const next = this.waitQueue.shift();
      if (next) {
        next();
      }
    } else {
      this.locked = false;
    }
  }

  /**
   * 使用锁执行操作
   * 自动获取和释放锁，确保操作的原子性
   * @param fn 要执行的异步操作
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * 自定义错误类，用于存储操作
 * 提供更详细的错误信息，包括操作类型、键名和原始错误
 */
export class StoreError extends Error {
  /**
   * @param message 错误消息
   * @param operation 操作类型 ('read' | 'write' | 'clear' | 'init')
   * @param key 相关的键名（可选）
   * @param originalError 原始错误对象（可选）
   */
  constructor(
    message: string,
    public readonly operation: 'read' | 'write' | 'clear' | 'init',
    public readonly key?: string,
    public readonly originalError?: any
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

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

  /**
   * 创建存储实例
   * @param filename 存储文件名（相对于应用数据目录）
   * @throws {StoreError} 如果文件名无效
   */
  constructor(filename: string) {
    if (!filename || typeof filename !== 'string' || filename.trim().length === 0) {
      throw new StoreError(
        '文件名不能为空',
        'init',
        undefined,
        new Error('Invalid filename parameter')
      );
    }
    this.filePath = filename.trim();
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
      console.warn('[Store] 警告: get() 方法接收到无效的 key 参数:', key);
      return null;
    }

    try {
      const dataPath = await this.getDataPath();
      
      // 检查文件是否存在
      const fileExists = await exists(dataPath);
      if (!fileExists) {
        console.log(`[Store] 数据文件不存在: ${this.filePath}，返回 null`);
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
          console.log(`[Store] 文件不存在: ${dataPath}`);
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
        console.warn(`[Store] 警告: 数据文件为空: ${this.filePath}`);
        return null;
      }

      // 【v2.8 加密存储】尝试解密
      // 使用魔数前缀明确检测加密数据，避免启发式检测的不可靠性
      let decryptedContent = content;
      try {
        // 使用 isEncryptedData 进行精确检测（检查 PNXENC: 前缀）
        if (isEncryptedData(content.trim())) {
          console.log(`[Store] 检测到加密数据（魔数前缀），尝试解密...`);
          decryptedContent = await secureStorage.decrypt(content);
          console.log(`[Store] ✓ 解密成功`);
        } else if (!content.trim().startsWith('{') && !content.trim().startsWith('[')) {
          // 向后兼容：旧版本加密数据（无魔数前缀）
          console.log(`[Store] 检测到可能的旧版加密数据，尝试解密...`);
          try {
            decryptedContent = await secureStorage.decrypt(content);
            console.log(`[Store] ✓ 旧版加密数据解密成功`);
          } catch {
            // 旧版解密失败，可能是明文数据
            console.warn(`[Store] 旧版解密失败，尝试按明文解析`);
            decryptedContent = content;
          }
        }
      } catch (decryptError: any) {
        // 解密失败，记录错误但不静默降级
        const errorMsg = decryptError?.message || String(decryptError);
        console.error(`[Store] 解密失败: ${errorMsg}`);
        throw new StoreError(`加密数据解密失败: ${errorMsg}`, 'read', key);
      }

      // 解析 JSON
      let data: Record<string, any>;
      try {
        data = JSON.parse(decryptedContent);
      } catch (parseError: any) {
        // JSON 解析失败，文件可能损坏
        const errorMsg = parseError?.message || String(parseError);
        console.error(`[Store] JSON 解析失败 (${this.filePath}):`, errorMsg);
        console.error(`[Store] 文件内容预览 (前200字符):`, content.substring(0, 200));
        
        // 如果提供了默认值，尝试恢复
        if (defaultValue !== undefined) {
          console.warn(`[Store] 文件损坏，尝试使用默认值恢复配置: ${key}`);
          
          // 创建损坏文件的备份
          try {
            const backupPath = `${dataPath}.corrupted.${Date.now()}`;
            await writeTextFile(backupPath, content);
            console.log(`[Store] ✓ 已创建损坏文件的备份: ${backupPath}`);
          } catch (backupError) {
            console.warn(`[Store] 创建备份失败:`, backupError);
          }
          
          // 保存默认值到文件
          try {
            await this.set(key, defaultValue);
            console.log(`[Store] ✓ 已使用默认值恢复配置: ${key}`);
            return defaultValue;
          } catch (recoverError) {
            console.error(`[Store] 恢复配置失败:`, recoverError);
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
        console.warn(`[Store] 警告: 数据格式不正确，期望对象，实际: ${typeof data}`);
        return null;
      }

      const value = data[key];
      if (value === undefined) {
        console.log(`[Store] 键 "${key}" 不存在于数据文件中`);
        return null;
      }

      return value as T;
    } catch (error) {
      // 如果是 StoreError，直接抛出
      if (error instanceof StoreError) {
        console.error(`[Store] 读取失败 (${key}):`, error.message);
        throw error;
      }
      // 其他未知错误
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Store] 未知错误 (${key}):`, errorMsg);
      throw new StoreError(
        `读取数据时发生未知错误: ${errorMsg}`,
        'read',
        key,
        error
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
      console.warn(`[Store] 警告: 尝试保存 undefined 值到键 "${key}"`);
    }

    // 【v2.9】使用互斥锁保护整个读-修改-写操作
    // 这确保了即使有多个并发写入，也不会发生数据覆盖
    await this.mutex.withLock(async () => {
      await this._performWrite(key, value);
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

      // 读取现有数据（并尝试解密）
      // 【v2.9 增强】读取失败时不再静默使用空对象，避免数据丢失
      let data: Record<string, any> = {};
      const fileExists = await exists(dataPath);
      if (fileExists) {
        let oldFileContent: string;
        try {
          oldFileContent = await readTextFile(dataPath);
        } catch (readError: any) {
          // 读取失败，抛出错误而不是静默继续
          const errorMsg = readError?.message || String(readError);
          if (errorMsg.includes('Permission') || errorMsg.includes('permission')) {
            throw new StoreError(
              `读取现有数据权限不足: ${dataPath}`,
              'write',
              key,
              readError
            );
          }
          // 文件被占用等错误，抛出而不是静默覆盖
          throw new StoreError(
            `无法读取现有数据文件，操作中止以防止数据丢失: ${errorMsg}`,
            'write',
            key,
            readError
          );
        }

        if (oldFileContent && oldFileContent.trim().length > 0) {
          // 【v2.9】使用 isEncryptedData 进行精确检测
          let oldContent = oldFileContent;
          const trimmedContent = oldFileContent.trim();

          if (isEncryptedData(trimmedContent)) {
            // 带魔数前缀的加密数据
            try {
              console.log(`[Store] 检测到加密数据（魔数前缀），尝试解密...`);
              oldContent = await secureStorage.decrypt(oldFileContent);
              console.log(`[Store] ✓ 解密成功`);
            } catch (decryptError: any) {
              const errorMsg = decryptError?.message || String(decryptError);
              console.error(`[Store] 解密失败: ${errorMsg}`);
              // 创建损坏文件的备份
              try {
                const backupPath = `${dataPath}.corrupted.${Date.now()}`;
                await writeTextFile(backupPath, oldFileContent);
                console.log(`[Store] ✓ 已创建损坏文件的备份: ${backupPath}`);
              } catch (backupError) {
                console.warn(`[Store] 创建备份失败:`, backupError);
              }
              throw new StoreError(
                `配置文件解密失败，操作中止以防止数据丢失: ${errorMsg}`,
                'write',
                key,
                decryptError
              );
            }
          } else if (!trimmedContent.startsWith('{') && !trimmedContent.startsWith('[')) {
            // 可能是旧版加密数据（无魔数前缀），尝试解密
            try {
              console.log(`[Store] 检测到可能的旧版加密数据，尝试解密...`);
              oldContent = await secureStorage.decrypt(oldFileContent);
              console.log(`[Store] ✓ 旧版加密数据解密成功`);
            } catch (decryptError: any) {
              // 旧版解密失败，可能是明文数据，继续尝试解析
              const errorMsg = decryptError?.message || String(decryptError);
              console.warn(`[Store] 旧版解密失败，尝试按明文解析: ${errorMsg}`);
              oldContent = oldFileContent;
            }
          }

          // 解析 JSON
          try {
            data = JSON.parse(oldContent);
            // 验证解析后的数据是对象
            if (typeof data !== 'object' || data === null || Array.isArray(data)) {
              console.warn('[Store] 警告: 现有数据格式不正确（非对象），创建备份后重置');
              // 创建备份
              try {
                const backupPath = `${dataPath}.invalid.${Date.now()}`;
                await writeTextFile(backupPath, oldFileContent);
                console.log(`[Store] ✓ 已创建无效数据的备份: ${backupPath}`);
              } catch (backupError) {
                console.warn(`[Store] 创建备份失败:`, backupError);
              }
              data = {};
            }
          } catch (parseError: any) {
            // JSON 解析失败，创建备份并抛出错误
            const errorMsg = parseError?.message || String(parseError);
            console.error(`[Store] JSON 解析失败 (${this.filePath}):`, errorMsg);

            // 创建损坏文件的备份
            try {
              const backupPath = `${dataPath}.corrupted.${Date.now()}`;
              await writeTextFile(backupPath, oldFileContent);
              console.log(`[Store] ✓ 已创建损坏文件的备份: ${backupPath}`);
            } catch (backupError) {
              console.warn(`[Store] 创建备份失败:`, backupError);
            }

            throw new StoreError(
              `配置文件已损坏，操作中止以防止数据丢失。已创建备份文件。错误: ${errorMsg}`,
              'write',
              key,
              parseError
            );
          }
        }
      }

      // 更新数据
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

      // 【v2.8 加密存储】加密数据
      let encryptedContent: string;
      try {
        encryptedContent = await secureStorage.encrypt(jsonContent);
        console.log(`[Store] ✓ 数据加密成功`);
      } catch (encryptError: any) {
        const errorMsg = encryptError?.message || String(encryptError);
        console.error(`[Store] 加密失败: ${errorMsg}`);
        throw new StoreError(
          `加密数据失败: ${errorMsg}`,
          'write',
          key,
          encryptError
        );
      }

      // [v2.7 优化] 原子性写入：直接写入目标文件
      // Tauri 的 writeTextFile 本身是原子性的，可以直接覆盖原文件
      // 【v2.8】写入加密后的内容
      try {
        await writeTextFile(dataPath, encryptedContent);
        console.log(`[Store] 成功保存数据到键 "${key}" (${this.filePath})`);
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
      // 如果是 StoreError，直接抛出
      if (error instanceof StoreError) {
        console.error(`[Store] 保存失败 (${key}):`, error.message);
        throw error;
      }
      // 其他未知错误
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Store] 未知错误 (${key}):`, errorMsg);
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
    try {
      const dataPath = await this.getDataPath();
      const fileExists = await exists(dataPath);
      if (!fileExists) {
        console.log(`[Store] 数据文件不存在，无需清空: ${this.filePath}`);
        return;
      }

      try {
        // 【v2.8 加密存储】清空时也加密写入
        const emptyJson = JSON.stringify({}, null, 2);
        const encryptedContent = await secureStorage.encrypt(emptyJson);
        await writeTextFile(dataPath, encryptedContent);
        console.log(`[Store] 成功清空数据文件: ${this.filePath}`);
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
      // 如果是 StoreError，直接抛出
      if (error instanceof StoreError) {
        console.error('[Store] 清空失败:', error.message);
        throw error;
      }
      // 其他未知错误
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[Store] 清空时发生未知错误:', errorMsg);
      throw new StoreError(
        `清空数据时发生未知错误: ${errorMsg}`,
        'clear',
        undefined,
        error
      );
    }
  }
}

/**
 * 导出存储类
 * 使用别名 `Store` 以保持与旧 API 的兼容性
 */
export { SimpleStore as Store };

