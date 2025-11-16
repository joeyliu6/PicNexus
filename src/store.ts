// src/store.ts
// 简单的存储工具，使用 Tauri 的 fs API 替代 tauri-plugin-store-api
import { readTextFile, writeTextFile, exists, createDir } from '@tauri-apps/api/fs';
import { appDataDir, join } from '@tauri-apps/api/path';

class SimpleStore {
  private filePath: string;

  constructor(filename: string) {
    this.filePath = filename;
  }

  private async getDataPath(): Promise<string> {
    const appDir = await appDataDir();
    const dataPath = await join(appDir, this.filePath);
    return dataPath;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const dataPath = await this.getDataPath();
      
      // 检查文件是否存在
      if (!(await exists(dataPath))) {
        return null;
      }

      const content = await readTextFile(dataPath);
      const data = JSON.parse(content);
      return data[key] || null;
    } catch (error) {
      console.error(`[Store] 读取失败 (${key}):`, error);
      return null;
    }
  }

  async set(key: string, value: any): Promise<void> {
    try {
      const dataPath = await this.getDataPath();
      const appDir = await appDataDir();
      
      // 确保目录存在
      await createDir(appDir, { recursive: true });

      // 读取现有数据
      let data: Record<string, any> = {};
      if (await exists(dataPath)) {
        try {
          const content = await readTextFile(dataPath);
          data = JSON.parse(content);
        } catch (e) {
          // 如果文件损坏，使用空对象
          console.warn('[Store] 文件损坏，重置数据');
        }
      }

      // 更新数据
      data[key] = value;

      // 写入文件
      await writeTextFile(dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`[Store] 保存失败 (${key}):`, error);
      throw error;
    }
  }

  async save(): Promise<void> {
    // 对于简单存储，set 已经保存了，这个方法保持兼容性
    return Promise.resolve();
  }

  async clear(): Promise<void> {
    try {
      const dataPath = await this.getDataPath();
      if (await exists(dataPath)) {
        await writeTextFile(dataPath, JSON.stringify({}, null, 2));
      }
    } catch (error) {
      console.error('[Store] 清空失败:', error);
      throw error;
    }
  }
}

export { SimpleStore as Store };

