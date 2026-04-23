/**
 * Database connection lifecycle manager.
 *
 * It owns:
 * - opening and closing the Tauri SQL connection
 * - a shared in-flight init promise for concurrent callers
 * - a throttled health check for long-lived app sessions
 */

import Database from '@tauri-apps/plugin-sql';
import { createLogger } from '../../utils/logger';

const log = createLogger('DBConnection');

export type DbInitializer = (db: Database) => Promise<void>;

export class ConnectionManager {
  private db: Database | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private lastHealthCheck = 0;

  private static readonly HEALTH_CHECK_INTERVAL = 30_000;

  constructor(
    private readonly dbPath: string,
    private readonly initializer: DbInitializer,
  ) {}

  async open(): Promise<void> {
    if (this.initialized && this.db) {
      return;
    }

    try {
      log.debug('Opening database connection...');
      this.db = await Database.load(this.dbPath);
      await this.initializer(this.db);
      this.initialized = true;
      log.debug('Database connection is ready');
    } catch (error) {
      await this.discardConnection();
      log.error('Database initialization failed:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (!this.db) return;

    const currentDb = this.db;
    this.resetConnection();
    await currentDb.close();
  }

  isInitialized(): boolean {
    return this.initialized && this.db !== null;
  }

  async healthCheck(): Promise<void> {
    if (!this.db) {
      throw new Error('Database connection is not initialized');
    }

    await this.db.select<{ v: number }[]>('SELECT 1 as v');
  }

  async reconnect(): Promise<void> {
    log.warn('Reconnecting database...');
    await this.discardConnection();
    await this.open();
    log.info('Database reconnected successfully');
  }

  async getDb(): Promise<Database> {
    if (this.initialized && this.db) {
      const now = Date.now();

      if (now - this.lastHealthCheck > ConnectionManager.HEALTH_CHECK_INTERVAL) {
        try {
          await this.db.select<{ v: number }[]>('SELECT 1 as v');
          this.lastHealthCheck = now;
        } catch {
          log.warn('Database health check failed, reconnecting...');
          await this.discardConnection();
        }
      }
    }

    if (!this.initialized || !this.db) {
      if (!this.initPromise) {
        const openTask = this.open();
        const trackedTask = openTask.finally(() => {
          if (this.initPromise === trackedTask) {
            this.initPromise = null;
          }
        });
        this.initPromise = trackedTask;
      }

      await this.initPromise;
      this.lastHealthCheck = Date.now();
    }

    return this.db!;
  }

  private async discardConnection(): Promise<void> {
    const currentDb = this.db;
    this.resetConnection();

    if (!currentDb) return;

    try {
      await currentDb.close();
    } catch (error) {
      log.warn('Closing stale database connection failed:', error);
    }
  }

  private resetConnection(): void {
    this.db = null;
    this.initialized = false;
    this.initPromise = null;
  }
}
