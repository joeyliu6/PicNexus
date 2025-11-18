// src/store.ts
// 简单的存储工具，使用 Tauri 的 fs API 替代 tauri-plugin-store-api
import { readTextFile, writeTextFile, exists, createDir } from '@tauri-apps/api/fs';
import { appDataDir, join } from '@tauri-apps/api/path';

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
 */
class SimpleStore {
  /** 存储文件的路径（相对于应用数据目录） */
  private filePath: string;
  
  /** 待处理的写操作队列，用于防止并发写入冲突 */
  private pendingWrites: Map<string, Promise<void>> = new Map();

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
   * 等待所有待处理的写操作完成
   * 用于防止并发写入冲突
   * @param excludeKey 要排除的键名（当前正在写入的键）
   * @private
   */
  private async waitForPendingWrites(excludeKey?: string): Promise<void> {
    const promises = Array.from(this.pendingWrites.entries())
      .filter(([key]) => key !== excludeKey)
      .map(([_, promise]) => promise.catch(() => {})); // 忽略错误，只等待完成
    
    if (promises.length > 0) {
      await Promise.all(promises);
    }
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

      // 解析 JSON
      let data: Record<string, any>;
      try {
        data = JSON.parse(content);
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
    
    // 等待其他写操作完成，避免并发写入冲突
    await this.waitForPendingWrites(key);
    
    // 创建写入Promise并注册
    const writePromise = (async () => {
      try {
        await this._performWrite(key, value);
      } finally {
        // 写入完成后清除
        this.pendingWrites.delete(key);
      }
    })();
    
    this.pendingWrites.set(key, writePromise);
    await writePromise;
  }
  
  /**
   * 执行实际的写入操作
   */
  private async _performWrite(key: string, value: any): Promise<void> {
    try {
      const dataPath = await this.getDataPath();
      const appDir = await appDataDir();
      
      // 确保目录存在
      try {
        await createDir(appDir, { recursive: true });
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

      // 读取现有数据
      let data: Record<string, any> = {};
      const fileExists = await exists(dataPath);
      if (fileExists) {
        try {
          const content = await readTextFile(dataPath);
          if (content && content.trim().length > 0) {
            try {
              data = JSON.parse(content);
              // 验证解析后的数据是对象
              if (typeof data !== 'object' || data === null || Array.isArray(data)) {
                console.warn('[Store] 警告: 现有数据格式不正确，将重置为空对象');
                data = {};
              }
            } catch (parseError: any) {
              // 如果文件损坏，使用空对象
              console.warn(`[Store] 警告: 数据文件损坏 (${this.filePath})，将重置数据`);
              console.warn(`[Store] 解析错误详情:`, parseError?.message || String(parseError));
              data = {};
            }
          }
        } catch (readError: any) {
          // 读取失败，但继续使用空对象（可能是文件被占用或权限问题）
          const errorMsg = readError?.message || String(readError);
          if (errorMsg.includes('Permission') || errorMsg.includes('permission')) {
            throw new StoreError(
              `读取现有数据权限不足: ${dataPath}`,
              'write',
              key,
              readError
            );
          }
          console.warn(`[Store] 警告: 无法读取现有数据，将创建新文件: ${errorMsg}`);
          data = {};
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

      // 写入文件
      try {
        await writeTextFile(dataPath, jsonContent);
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
        await writeTextFile(dataPath, JSON.stringify({}, null, 2));
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

