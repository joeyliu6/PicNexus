/**
 * 简单的 Promise-based 互斥锁
 * 用于防止并发文件操作导致的竞态条件
 */
export class Mutex {
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
