// src/utils/semaphore.ts
// 信号量实现，用于控制并发数

/**
 * 信号量类
 * 用于限制并发操作的数量
 */
export class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  /**
   * 创建信号量
   * @param permits 最大并发数
   */
  constructor(permits: number) {
    this.permits = permits;
  }

  /**
   * 获取许可（如果没有可用许可则等待）
   */
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  /**
   * 释放许可
   */
  release(): void {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift();
      next?.();
    } else {
      this.permits++;
    }
  }

  /**
   * 在许可范围内执行函数
   * 自动获取和释放许可
   * @param fn 要执行的异步函数
   */
  async withPermit<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * 获取当前可用许可数
   */
  get available(): number {
    return this.permits;
  }

  /**
   * 获取当前等待队列长度
   */
  get waitingCount(): number {
    return this.waiting.length;
  }
}

// ========== 图床级并发控制 ==========

/** 全局图床并发控制器（每个图床独立的信号量） */
const serviceSemaphores: Map<string, Semaphore> = new Map();

/**
 * 获取指定图床的信号量
 * @param serviceId 图床服务 ID
 * @param maxConcurrent 最大并发数（默认 2）
 */
export function getServiceSemaphore(serviceId: string, maxConcurrent: number = 2): Semaphore {
  if (!serviceSemaphores.has(serviceId)) {
    serviceSemaphores.set(serviceId, new Semaphore(maxConcurrent));
  }
  return serviceSemaphores.get(serviceId)!;
}

// ========== 工具函数 ==========

/**
 * 将数组分成指定大小的批次
 * @param array 原始数组
 * @param batchSize 每批大小
 */
export function chunkArray<T>(array: T[], batchSize: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += batchSize) {
    result.push(array.slice(i, i + batchSize));
  }
  return result;
}
