import { describe, it, expect } from 'vitest';
import { Mutex } from '@/utils/mutex';

describe('Mutex', () => {
  it('初始状态未锁定，acquire 立即返回', async () => {
    const mutex = new Mutex();
    let acquired = false;
    await mutex.acquire();
    acquired = true;
    expect(acquired).toBe(true);
    mutex.release();
  });

  it('release 后可再次 acquire', async () => {
    const mutex = new Mutex();
    await mutex.acquire();
    mutex.release();
    let acquired = false;
    await mutex.acquire();
    acquired = true;
    expect(acquired).toBe(true);
    mutex.release();
  });

  it('锁已持有时 acquire 阻塞，release 后恢复', async () => {
    const mutex = new Mutex();
    await mutex.acquire();

    let resolved = false;
    const pending = mutex.acquire().then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);
    mutex.release();
    await pending;
    expect(resolved).toBe(true);
    mutex.release();
  });

  it('等待队列按 FIFO 顺序唤醒', async () => {
    const mutex = new Mutex();
    await mutex.acquire();

    const order: number[] = [];
    const p1 = mutex.acquire().then(() => { order.push(1); });
    const p2 = mutex.acquire().then(() => { order.push(2); });
    const p3 = mutex.acquire().then(() => { order.push(3); });

    mutex.release(); // 唤醒 p1
    await p1;
    mutex.release(); // 唤醒 p2
    await p2;
    mutex.release(); // 唤醒 p3
    await p3;

    expect(order).toEqual([1, 2, 3]);
  });

  it('withLock 自动 acquire 和 release，返回 fn 的值', async () => {
    const mutex = new Mutex();
    const result = await mutex.withLock(async () => 'hello');
    expect(result).toBe('hello');
    // 锁应已释放，再次 withLock 不会死锁
    const result2 = await mutex.withLock(async () => 42);
    expect(result2).toBe(42);
  });

  it('withLock fn 抛出异常时锁仍被释放', async () => {
    const mutex = new Mutex();
    await expect(
      mutex.withLock(async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');

    // 锁已释放，后续操作正常
    const result = await mutex.withLock(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('withLock 限制并发（同一时刻只有一个任务在执行）', async () => {
    const mutex = new Mutex();
    let concurrent = 0;
    let maxConcurrent = 0;

    const task = () =>
      mutex.withLock(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 5));
        concurrent--;
      });

    await Promise.all([task(), task(), task()]);
    expect(maxConcurrent).toBe(1);
  });
});
