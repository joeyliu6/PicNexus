import { describe, it, expect } from 'vitest';
import { Semaphore, getServiceSemaphore, chunkArray } from '../../../utils/semaphore';

describe('Semaphore', () => {
  it('创建时可用许可数等于构造参数', () => {
    const sem = new Semaphore(3);
    expect(sem.available).toBe(3);
    expect(sem.waitingCount).toBe(0);
  });

  it('acquire 消耗许可', async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    expect(sem.available).toBe(1);
    await sem.acquire();
    expect(sem.available).toBe(0);
  });

  it('release 归还许可', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    expect(sem.available).toBe(0);
    sem.release();
    expect(sem.available).toBe(1);
  });

  it('许可耗尽后 acquire 阻塞，release 后恢复', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    let resolved = false;
    const pending = sem.acquire().then(() => { resolved = true; });

    // 此时应该在等待队列中
    expect(sem.waitingCount).toBe(1);
    expect(resolved).toBe(false);

    // 释放一个许可
    sem.release();
    await pending;
    expect(resolved).toBe(true);
    expect(sem.waitingCount).toBe(0);
  });

  it('等待队列 FIFO 顺序', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    const order: number[] = [];
    const p1 = sem.acquire().then(() => { order.push(1); });
    const p2 = sem.acquire().then(() => { order.push(2); });
    const p3 = sem.acquire().then(() => { order.push(3); });

    expect(sem.waitingCount).toBe(3);

    sem.release(); // 唤醒 p1
    await p1;
    sem.release(); // 唤醒 p2
    await p2;
    sem.release(); // 唤醒 p3
    await p3;

    expect(order).toEqual([1, 2, 3]);
  });

  it('withPermit 自动获取和释放许可', async () => {
    const sem = new Semaphore(1);
    const result = await sem.withPermit(async () => {
      expect(sem.available).toBe(0);
      return 42;
    });
    expect(result).toBe(42);
    expect(sem.available).toBe(1);
  });

  it('withPermit 异常时也释放许可', async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.withPermit(async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');
    expect(sem.available).toBe(1);
  });

  it('withPermit 限制并发数', async () => {
    const sem = new Semaphore(2);
    let concurrent = 0;
    let maxConcurrent = 0;

    const task = () => sem.withPermit(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      // 模拟异步操作
      await new Promise(r => setTimeout(r, 10));
      concurrent--;
    });

    await Promise.all([task(), task(), task(), task(), task()]);
    expect(maxConcurrent).toBe(2);
  });
});

describe('getServiceSemaphore', () => {
  it('相同 serviceId 返回同一个实例', () => {
    const s1 = getServiceSemaphore('weibo');
    const s2 = getServiceSemaphore('weibo');
    expect(s1).toBe(s2);
  });

  it('不同 serviceId 返回不同实例', () => {
    const s1 = getServiceSemaphore('r2');
    const s2 = getServiceSemaphore('jd');
    expect(s1).not.toBe(s2);
  });

  it('默认最大并发数为 2', () => {
    const sem = getServiceSemaphore('test-default-concurrency');
    expect(sem.available).toBe(2);
  });

  it('支持自定义最大并发数', () => {
    const sem = getServiceSemaphore('test-custom-concurrency', 5);
    expect(sem.available).toBe(5);
  });
});

describe('chunkArray', () => {
  it('正常分批', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('batchSize 大于数组长度时返回单批', () => {
    expect(chunkArray([1, 2], 10)).toEqual([[1, 2]]);
  });

  it('空数组返回空', () => {
    expect(chunkArray([], 3)).toEqual([]);
  });

  it('batchSize 为 1 时每个元素一批', () => {
    expect(chunkArray(['a', 'b', 'c'], 1)).toEqual([['a'], ['b'], ['c']]);
  });

  it('batchSize 等于数组长度时返回单批', () => {
    expect(chunkArray([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
  });
});
