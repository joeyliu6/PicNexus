/**
 * 数据库连接生命周期管理器
 *
 * 从 HistoryDatabase 提取的连接相关逻辑：
 * - open / close / reconnect / healthCheck：公开生命周期
 * - getDb：确保已初始化，带 30 秒节流的连接健康检查（休眠恢复后自动重连）
 * - initPromise：避免并发 open() 时的重复初始化
 *
 * 设计约束：与原 HistoryDatabase 的私有实现行为完全一致，SQL 和节流参数 0 改动。
 */

import Database from '@tauri-apps/plugin-sql';
import { createLogger } from '../../utils/logger';

const log = createLogger('DBConnection');

/** 数据库初始化回调：在 Database.load 之后、open 返回之前执行（例如建表 + 迁移） */
export type DbInitializer = (db: Database) => Promise<void>;

/**
 * 数据库连接生命周期管理器
 */
export class ConnectionManager {
  private db: Database | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private lastHealthCheck = 0;

  /** 健康检查最小间隔（30 秒） */
  private static readonly HEALTH_CHECK_INTERVAL = 30_000;

  constructor(
    private readonly dbPath: string,
    private readonly initializer: DbInitializer,
  ) {}

  /**
   * 打开数据库连接并执行初始化回调
   */
  async open(): Promise<void> {
    if (this.initialized && this.db) {
      return;
    }

    try {
      log.debug('正在打开数据库...');
      this.db = await Database.load(this.dbPath);
      await this.initializer(this.db);
      this.initialized = true;
      log.debug('数据库初始化完成');
    } catch (error) {
      log.error('数据库初始化失败:', error);
      throw error;
    }
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.resetConnection();
    }
  }

  /**
   * 连接是否已经成功打开过（用于区分"还没首次 open"和"连接失效"两种状态）
   */
  isInitialized(): boolean {
    return this.initialized && this.db !== null;
  }

  /**
   * 验证数据库连接有效性（轻量查询）
   * 供外部调用（如休眠恢复时）
   */
  async healthCheck(): Promise<void> {
    if (!this.db) {
      throw new Error('数据库未初始化');
    }
    await this.db.select<{ v: number }[]>('SELECT 1 as v');
  }

  /**
   * 强制关闭并重新打开数据库连接
   * 用于休眠恢复后连接失效的场景
   */
  async reconnect(): Promise<void> {
    log.warn('强制重连数据库...');
    this.resetConnection();
    await this.open();
    log.info('数据库重连成功');
  }

  /**
   * 确保数据库已初始化，返回可用的 db 实例
   * 带 30 秒节流的连接健康检查，休眠恢复后自动重连
   */
  async getDb(): Promise<Database> {
    if (this.initialized && this.db) {
      const now = Date.now();
      if (now - this.lastHealthCheck > ConnectionManager.HEALTH_CHECK_INTERVAL) {
        try {
          await this.db.select<{ v: number }[]>('SELECT 1 as v');
          this.lastHealthCheck = now;
        } catch {
          log.warn('数据库连接已断开，正在重连...');
          this.resetConnection();
        }
      }
    }
    if (!this.initialized || !this.db) {
      if (!this.initPromise) {
        this.initPromise = this.open();
      }
      await this.initPromise;
      this.lastHealthCheck = Date.now();
    }
    return this.db!;
  }

  /**
   * 重置连接状态（关闭前 / 重连前 / 健康检查失败时统一调用）
   */
  private resetConnection(): void {
    this.db = null;
    this.initialized = false;
    this.initPromise = null;
  }
}
