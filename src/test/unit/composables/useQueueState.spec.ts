import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useQueueState } from '../../../composables/useQueueState';
import type { QueueItem } from '../../../uploadQueue';

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'item-1',
    fileName: 'a.png',
    fileSize: 1024,
    status: 'pending',
    services: ['weibo'],
    serviceProgress: {},
    results: [],
    createdAt: 1000,
    ...overrides,
  } as QueueItem;
}

describe('useQueueState - CRUD', () => {
  beforeEach(() => {
    const { clearQueue } = useQueueState();
    clearQueue();
  });

  it('addItem 从头部插入', () => {
    const { addItem, queueItems } = useQueueState();
    addItem(makeItem({ id: 'a' }));
    addItem(makeItem({ id: 'b' }));
    expect(queueItems.value.map(i => i.id)).toEqual(['b', 'a']);
  });

  it('getItem 按 id 查找', () => {
    const { addItem, getItem } = useQueueState();
    addItem(makeItem({ id: 'x' }));
    expect(getItem('x')?.id).toBe('x');
    expect(getItem('ghost')).toBeUndefined();
  });

  it('updateItem 更新存在的 item', () => {
    const { addItem, updateItem, getItem } = useQueueState();
    addItem(makeItem({ id: 'x', status: 'pending' }));
    updateItem('x', { status: 'uploading' });
    expect(getItem('x')?.status).toBe('uploading');
  });

  it('updateItem 对不存在的 id 安全无副作用', () => {
    const { updateItem, queueItems } = useQueueState();
    updateItem('ghost', { status: 'success' });
    expect(queueItems.value).toEqual([]);
  });

  it('updateItem 合并 serviceProgress', () => {
    const { addItem, updateItem, getItem } = useQueueState();
    addItem(makeItem({
      id: 'x',
      serviceProgress: {
        weibo: { serviceId: 'weibo', progress: 20, status: 'uploading' } as any,
      },
    }));
    updateItem('x', {
      serviceProgress: {
        weibo: { progress: 50 } as any,
        r2: { progress: 10, status: 'uploading' } as any,
      },
    });
    const sp = getItem('x')!.serviceProgress! as any;
    expect(sp.weibo.progress).toBe(50);
    expect(sp.weibo.status).toBe('uploading');
    expect(sp.r2.progress).toBe(10);
  });

  it('updateItem 合并 serviceProgress.metadata', () => {
    const { addItem, updateItem, getItem } = useQueueState();
    addItem(makeItem({
      id: 'x',
      serviceProgress: {
        weibo: { serviceId: 'weibo', progress: 0, status: '', metadata: { a: 1 } } as any,
      },
    }));
    updateItem('x', {
      serviceProgress: { weibo: { metadata: { b: 2 } } as any },
    });
    const sp = getItem('x')!.serviceProgress! as any;
    expect(sp.weibo.metadata).toEqual({ a: 1, b: 2 });
  });

  it('removeItem 删除存在的 item', () => {
    const { addItem, removeItem, queueItems } = useQueueState();
    addItem(makeItem({ id: 'a' }));
    addItem(makeItem({ id: 'b' }));
    removeItem('a');
    expect(queueItems.value.map(i => i.id)).toEqual(['b']);
  });

  it('removeItem 对不存在的 id 安全', () => {
    const { removeItem, queueItems } = useQueueState();
    removeItem('ghost');
    expect(queueItems.value).toEqual([]);
  });

  it('clearQueue 清空队列', () => {
    const { addItem, clearQueue, queueItems } = useQueueState();
    addItem(makeItem({ id: 'a' }));
    addItem(makeItem({ id: 'b' }));
    clearQueue();
    expect(queueItems.value).toEqual([]);
  });

  it('clearCompletedItems 保留 pending / uploading', () => {
    const { addItem, clearCompletedItems, queueItems } = useQueueState();
    addItem(makeItem({ id: 'a', status: 'success' }));
    addItem(makeItem({ id: 'b', status: 'pending' }));
    addItem(makeItem({ id: 'c', status: 'error' }));
    addItem(makeItem({ id: 'd', status: 'uploading' }));
    clearCompletedItems();
    expect(queueItems.value.map(i => i.id).sort()).toEqual(['b', 'd']);
  });

  it('hasCompletedItems 检测 success/error', () => {
    const { addItem, hasCompletedItems } = useQueueState();
    expect(hasCompletedItems.value).toBe(false);
    addItem(makeItem({ id: 'a', status: 'uploading' }));
    expect(hasCompletedItems.value).toBe(false);
    addItem(makeItem({ id: 'b', status: 'success' }));
    expect(hasCompletedItems.value).toBe(true);
  });
});

describe('useQueueState - updateItemThrottled', () => {
  beforeEach(() => {
    const { clearQueue } = useQueueState();
    clearQueue();
  });

  it('在 RAF 回调中批量合并更新', async () => {
    vi.useFakeTimers();
    // happy-dom 的 requestAnimationFrame 走 timer
    const { addItem, updateItemThrottled, getItem } = useQueueState();
    addItem(makeItem({ id: 'x', status: 'pending' }));
    updateItemThrottled('x', { status: 'uploading' });
    updateItemThrottled('x', { serviceProgress: { weibo: { progress: 30 } as any } });
    updateItemThrottled('x', { serviceProgress: { weibo: { progress: 60 } as any } });
    // 触发 RAF
    vi.advanceTimersByTime(50);
    await Promise.resolve();
    const item = getItem('x')!;
    expect(item.status).toBe('uploading');
    vi.useRealTimers();
  });

  it('状态已为 error/success 时跳过节流更新', async () => {
    const { addItem, updateItemThrottled, getItem } = useQueueState();
    addItem(makeItem({ id: 'x', status: 'error' }));
    updateItemThrottled('x', { status: 'uploading' });
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    expect(getItem('x')!.status).toBe('error');
  });

  it('clearPendingUpdatesForItem 丢弃 pending 更新', async () => {
    const { addItem, updateItemThrottled, clearPendingUpdatesForItem, getItem } = useQueueState();
    addItem(makeItem({ id: 'x', status: 'pending' }));
    updateItemThrottled('x', { status: 'uploading' });
    clearPendingUpdatesForItem('x');
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    // pending 状态保留，因为节流更新被清掉
    expect(getItem('x')!.status).toBe('pending');
  });
});
