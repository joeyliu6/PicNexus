/**
 * 加密文件 I/O 层
 * 职责：Tauri fs 读写 + AES-GCM 加密/解密 + 自愈 + 损坏备份。
 *
 * 设计约束（务必遵守）：
 *  - 无锁、无内存缓存；所有方法都假定调用方已持有外层 Mutex。
 *  - 自愈时不能反向引用 CacheStore；通过构造参数 `onSelfHeal` 回调通知调用方清缓存。
 *  - `BackupPasswordRequiredError` 必须无包装传播（不能被 StoreError 吃掉），
 *    否则 UI 的"输入备份密码"弹窗流程会断。
 *  - 两个 load 方法（loadForRead / loadForWrite）保留原 store.ts 里不同的错误处理策略：
 *      loadForRead: 损坏 + 有 defaultValue 时尝试用默认值写回恢复
 *      loadForWrite: 非自愈模式下损坏直接抛 write 错；自愈模式下备份+重置+返回 {}
 */

import { readTextFile, writeTextFile, exists, mkdir, remove } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { secureStorage, isAnyEncryptedData, BackupPasswordRequiredError } from '../security/crypto';
import { getUserDataDir } from '../utils/appPaths';
import { createLogger } from '../utils/logger';
import { StoreError } from '../utils/storeErrors';
import { type StoreData, toErrorMessage } from './types';

const log = createLogger('Store');

export interface EncryptedStoreOptions {
  filePath: string;
  encrypted: boolean;
  selfHeal: boolean;
  /** 自愈触发回调：由 MutexStore 注入 `() => cacheStore.clear()` */
  onSelfHeal: () => void;
}

export class EncryptedStore {
  private readonly filePath: string;
  private readonly encrypted: boolean;
  private readonly selfHeal: boolean;
  private readonly onSelfHeal: () => void;

  constructor(options: EncryptedStoreOptions) {
    this.filePath = options.filePath;
    this.encrypted = options.encrypted;
    this.selfHeal = options.selfHeal;
    this.onSelfHeal = options.onSelfHeal;
  }

  /**
   * 同时返回数据文件路径和应用数据目录（一次 IPC 获取两个路径，避免重复调用 appDataDir）
   * @throws {StoreError} 如果无法获取应用数据目录
   */
  private async getPaths(): Promise<{ dataPath: string; appDir: string }> {
    try {
      const appDir = await getUserDataDir();
      if (!appDir) {
        throw new StoreError('无法获取应用数据目录', 'init', undefined, new Error('appDataDir returned null or undefined'));
      }
      const dataPath = await join(appDir, this.filePath);
      if (!dataPath) {
        throw new StoreError('无法构建数据文件路径', 'init', undefined, new Error('join returned null or undefined'));
      }
      return { dataPath, appDir };
    } catch (error) {
      if (error instanceof StoreError) throw error;
      throw new StoreError(`获取数据路径失败: ${toErrorMessage(error)}`, 'init', undefined, error);
    }
  }

  /**
   * 获取数据文件的绝对路径
   * @throws {StoreError} 如果无法获取应用数据目录
   */
  private async getDataPath(): Promise<string> {
    return (await this.getPaths()).dataPath;
  }

  /**
   * 把损坏的原始内容写到一个带时间戳的备份文件，失败时只告警不抛。
   * 三处调用点都是"尽最大努力保留证据，备份失败不应中断主流程"的语义。
   */
  private async backupCorrupted(
    dataPath: string,
    content: string,
    suffix: 'corrupted' | 'invalid' = 'corrupted'
  ): Promise<void> {
    try {
      const backupPath = `${dataPath}.${suffix}.${Date.now()}`;
      await writeTextFile(backupPath, content);
      log.info(`✓ 已创建${suffix === 'invalid' ? '无效' : '损坏'}数据的备份: ${backupPath}`);
    } catch (backupError) {
      log.warn(`创建备份失败:`, backupError);
    }
  }

  /**
   * 把 writeTextFile 的错误包装成带语义的 StoreError（权限/磁盘/其他）
   */
  private wrapWriteError(
    err: unknown,
    dataPath: string,
    operation: 'write' | 'clear',
    key?: string
  ): StoreError {
    const errorMsg = toErrorMessage(err);
    if (errorMsg.includes('Permission') || errorMsg.includes('permission')) {
      return new StoreError(
        operation === 'clear' ? `清空文件权限不足: ${dataPath}` : `写入文件权限不足: ${dataPath}`,
        operation, key, err
      );
    }
    if (errorMsg.includes('disk') || errorMsg.includes('space') || errorMsg.includes('空间')) {
      return new StoreError(`磁盘空间不足，无法保存数据: ${errorMsg}`, operation, key, err);
    }
    return new StoreError(
      operation === 'clear' ? `清空文件失败: ${errorMsg}` : `写入文件失败: ${errorMsg}`,
      operation, key, err
    );
  }

  /**
   * 把 mkdir 错误包装成带 key 的 StoreError（write 路径专用）
   */
  private wrapMkdirError(err: unknown, appDir: string, key?: string): StoreError {
    const errorMsg = toErrorMessage(err);
    if (errorMsg.includes('Permission') || errorMsg.includes('permission')) {
      return new StoreError(`创建目录权限不足: ${appDir}`, 'write', key, err);
    }
    return new StoreError(`创建目录失败: ${errorMsg}`, 'write', key, err);
  }

  /**
   * 自愈重置：删除文件 + 通知外层清缓存
   * @param throwOnRemoveFail 写路径要求 true（删不掉就停），读路径要求 false
   */
  private async selfHealReset(dataPath: string, throwOnRemoveFail: boolean, key?: string): Promise<void> {
    log.warn(`⚠ 自愈模式：明文 store 检测到加密数据，自动删除并重置 (${this.filePath})`);
    try {
      await remove(dataPath);
    } catch (e) {
      if (!throwOnRemoveFail) {
        this.onSelfHeal();
        return;
      }
      log.error(`⚠ 自愈模式删除文件失败，无法继续写入 (${this.filePath})`, e);
      throw new StoreError(`自愈模式删除文件失败`, 'write', key, e as Error);
    }
    this.onSelfHeal();
  }

  /**
   * 读路径专用：加载完整数据
   *
   * 返回值：
   *  - `StoreData` — 成功解析的对象
   *  - `null` — 文件不存在 / 内容为空 / 自愈模式检测到加密数据并重置 / 数据非对象
   *
   * @param key 当前请求的 key（仅用于 StoreError 的 key 字段）
   * @param recovery 可选的损坏恢复参数：JSON 解析失败时用 defaultValue 写回 { [key]: defaultValue } 并返回
   * @throws {StoreError} 非自愈模式下的解密/解析失败
   * @throws {BackupPasswordRequiredError} 需要输入备份密码时，原样传播不包装
   */
  async loadForRead(
    key: string,
    recovery?: { key: string; defaultValue: unknown }
  ): Promise<StoreData | null> {
    const dataPath = await this.getDataPath();

    if (!(await exists(dataPath))) {
      log.debug(`数据文件不存在: ${this.filePath}，返回 null`);
      return null;
    }

    // 读取文件内容
    let content: string;
    try {
      content = await readTextFile(dataPath);
    } catch (readError) {
      const errorMsg = toErrorMessage(readError);
      if (errorMsg.includes('Permission') || errorMsg.includes('permission')) {
        throw new StoreError(`读取文件权限不足: ${dataPath}`, 'read', key, readError);
      }
      if (errorMsg.includes('not found') || errorMsg.includes('不存在')) {
        log.debug(`文件不存在: ${dataPath}`);
        return null;
      }
      throw new StoreError(`读取文件失败: ${errorMsg}`, 'read', key, readError);
    }

    if (!content || content.trim().length === 0) {
      log.warn(`警告: 数据文件为空: ${this.filePath}`);
      return null;
    }

    // 解密 / 明文分支
    let decryptedContent = content;
    const trimmedContent = content.trim();

    if (!this.encrypted && isAnyEncryptedData(trimmedContent)) {
      if (this.selfHeal) {
        await this.selfHealReset(dataPath, false);
        return null;
      }
      throw new StoreError(
        `Detected encrypted data in plaintext store ${this.filePath}. Please delete the file manually and retry.`,
        'read', key
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
    } catch (decryptError) {
      // BackupPasswordRequiredError 必须无包装传播
      if (decryptError instanceof BackupPasswordRequiredError) throw decryptError;
      if (decryptError instanceof StoreError) throw decryptError;
      const errorMsg = toErrorMessage(decryptError);
      log.error(`解密失败: ${errorMsg}`);
      throw new StoreError(`加密数据解密失败: ${errorMsg}`, 'read', key);
    }

    // 解析 JSON
    let data: StoreData;
    try {
      data = JSON.parse(decryptedContent);
    } catch (parseError) {
      const errorMsg = toErrorMessage(parseError);
      log.error(`JSON 解析失败 (${this.filePath}):`, errorMsg);
      log.error('文件内容解析失败，已跳过内容预览', { contentLength: content.length });

      // 如果提供了 recovery，尝试用默认值写回恢复。
      // 这里必须先走 loadForWrite（等同原 _performWrite → _loadFromDisk 链路），
      // 再 writeAll。原因：原 store.ts 的恢复路径就是 _performWrite(key, defaultValue)，
      // 若文件仍损坏，_loadFromDisk 会再次解析失败 → 恢复失败 → 继续抛外层 parse error。
      // 跳过 loadForWrite 会破坏原有的"损坏文件恢复总会失败"语义，进而让依赖此行为的测试失败。
      if (recovery !== undefined) {
        log.warn(`文件损坏，尝试使用默认值恢复配置: ${recovery.key}`);
        await this.backupCorrupted(dataPath, content);
        try {
          const existing = await this.loadForWrite(recovery.key);
          existing[recovery.key] = recovery.defaultValue;
          await this.writeAll(existing, recovery.key);
          log.info(`✓ 已使用默认值恢复配置: ${recovery.key}`);
          return existing;
        } catch (recoverError) {
          log.error(`恢复配置失败:`, recoverError);
        }
      }

      throw new StoreError(`数据文件格式错误（可能已损坏）: ${errorMsg}`, 'read', key, parseError);
    }

    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      log.warn(`警告: 数据格式不正确，期望对象，实际: ${typeof data}`);
      return null;
    }

    return data;
  }

  /**
   * 写路径专用：加载现有完整数据（用于读-修改-写流程的 "读" 阶段）
   *
   * 返回值：
   *  - `StoreData` — 成功加载的对象
   *  - `{}` — 文件不存在 / 空 / 自愈模式下遇到的可恢复错误
   *
   * 与 `loadForRead` 的差异：
   *  - 所有抛出的 StoreError 都带 `operation: 'write'`
   *  - 解密失败时会先创建损坏备份，再视 `selfHeal` 决定重置或抛错
   *
   * @throws {StoreError} 非自愈模式下的解密/解析失败
   * @throws {BackupPasswordRequiredError} 需要输入备份密码时，原样传播
   */
  async loadForWrite(key: string): Promise<StoreData> {
    const dataPath = await this.getDataPath();

    if (!(await exists(dataPath))) return {};

    let oldFileContent: string;
    try {
      oldFileContent = await readTextFile(dataPath);
    } catch (readError) {
      const errorMsg = toErrorMessage(readError);
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
        'write', key
      );
    }

    if (this.encrypted && isAnyEncryptedData(trimmedContent)) {
      try {
        log.debug(`检测到加密数据，尝试解密...`);
        oldContent = await secureStorage.decrypt(trimmedContent);
        log.info(`✓ 解密成功`);
      } catch (decryptError) {
        if (decryptError instanceof BackupPasswordRequiredError) throw decryptError;
        const errorMsg = toErrorMessage(decryptError);
        log.error(`解密失败: ${errorMsg}`);
        await this.backupCorrupted(dataPath, oldFileContent);
        if (this.selfHeal) {
          try {
            await remove(dataPath);
          } catch {
            // 删除失败不影响自愈流程，配置已备份，下次写入会覆盖
          }
          log.warn(`⚠ 自愈模式：已备份损坏文件并重置，继续写入新数据 (${this.filePath})`);
          this.onSelfHeal();
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
      } catch (decryptError) {
        log.warn(`旧版解密失败，尝试按明文解析: ${toErrorMessage(decryptError)}`);
        oldContent = oldFileContent;
      }
    }

    try {
      const data = JSON.parse(oldContent);
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        log.warn('警告: 现有数据格式不正确（非对象），创建备份后重置');
        await this.backupCorrupted(dataPath, oldFileContent, 'invalid');
        return {};
      }
      return data;
    } catch (parseError) {
      const errorMsg = toErrorMessage(parseError);
      log.error(`JSON 解析失败 (${this.filePath}):`, errorMsg);
      await this.backupCorrupted(dataPath, oldFileContent);
      throw new StoreError(
        `配置文件已损坏，操作中止以防止数据丢失。已创建备份文件。错误: ${errorMsg}`,
        'write', key, parseError
      );
    }
  }

  /**
   * 把完整数据原子写入磁盘（加密 + writeTextFile 一气呵成）
   * 调用方必须保证 `data` 是"干净"的纯对象（不含 Vue 响应式 Proxy）
   * @param key 当前触发写入的 key（仅用于 StoreError 的 key 字段，便于 UI 层错误分派）
   */
  async writeAll(data: StoreData, key?: string): Promise<void> {
    const { dataPath, appDir } = await this.getPaths();

    try {
      await mkdir(appDir, { recursive: true });
    } catch (dirError) {
      throw this.wrapMkdirError(dirError, appDir, key);
    }

    let jsonContent: string;
    try {
      jsonContent = JSON.stringify(data, null, 2);
    } catch (stringifyError) {
      throw new StoreError(
        `序列化数据失败: ${toErrorMessage(stringifyError)}`,
        'write', key, stringifyError
      );
    }

    let contentToWrite = jsonContent;
    if (this.encrypted) {
      try {
        contentToWrite = await secureStorage.encrypt(jsonContent);
      } catch (encryptError) {
        const errorMsg = toErrorMessage(encryptError);
        log.error(`加密失败: ${errorMsg}`);
        throw new StoreError(`加密数据失败: ${errorMsg}`, 'write', key, encryptError);
      }
    }

    // Tauri 的 writeTextFile 本身是原子的，可以直接覆盖
    try {
      await writeTextFile(dataPath, contentToWrite);
      log.debug(`成功保存数据 (${this.filePath})`);
    } catch (writeError) {
      throw this.wrapWriteError(writeError, dataPath, 'write', key);
    }
  }

  /**
   * 清空数据文件（写入空对象）
   */
  async clearFile(): Promise<void> {
    const dataPath = await this.getDataPath();
    if (!(await exists(dataPath))) {
      log.debug(`数据文件不存在，无需清空: ${this.filePath}`);
      return;
    }

    try {
      const emptyJson = JSON.stringify({}, null, 2);
      const contentToWrite = this.encrypted
        ? await secureStorage.encrypt(emptyJson)
        : emptyJson;
      await writeTextFile(dataPath, contentToWrite);
      log.info(`✓ 成功清空数据文件: ${this.filePath}`);
    } catch (writeError) {
      throw this.wrapWriteError(writeError, dataPath, 'clear');
    }
  }

  /**
   * 读取文件的完整原始对象（用于密钥切换时快照全量数据）
   * 与 loadForRead 的区别：不做恢复、不做 defaultValue 兜底，只负责解密 + 解析。
   */
  async readRawAll(): Promise<StoreData | null> {
    const dataPath = await this.getDataPath();
    if (!(await exists(dataPath))) return null;
    let content: string;
    try {
      content = await readTextFile(dataPath);
    } catch (readError) {
      const errorMsg = toErrorMessage(readError);
      throw new StoreError(`读取文件失败: ${errorMsg}`, 'read', undefined, readError);
    }
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
    return JSON.parse(decoded) as StoreData;
  }
}
