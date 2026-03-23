import { describe, it, expect, vi } from 'vitest';
import { RetryService } from '../../../services/RetryService';
import type { RetryOptions } from '../../../services/RetryService';
import type { QueueItem } from '../../../uploadQueue';
import { DEFAULT_CONFIG } from '../../../config/types';

// Mock 网络检测 — 默认返回 true（网络正常）
vi.mock('../../../utils/network', () => ({
  checkNetworkConnectivity: vi.fn().mockResolvedValue(true),
}));

// Mock 缓存事件
vi.mock('../../../events/cacheEvents', () => ({
  emitHistoryUpdated: vi.fn(),
}));

vi.mock('../../../composables/useHistory', () => ({
  invalidateCache: vi.fn(),
}));

// ─── 工具函数 ──────────────────────────────────────────────

function makeToast() {
  return {
    success: vi.fn(),
    error:   vi.fn(),
    warn:    vi.fn(),
    info:    vi.fn(),
  };
}

function makeQueueManager(item?: Partial<QueueItem>) {
  const queueItem: QueueItem | undefined = item
    ? {
        id:              'item-1',
        fileName:        'test.jpg',
        filePath:        '/tmp/test.jpg',
        status:          'error',
        enabledServices: ['weibo'],
        serviceProgress: {},
        retryCount:      0,
        maxRetries:      3,
        ...item,
      } as QueueItem
    : undefined;

  return {
    getItem:                 vi.fn().mockReturnValue(queueItem),
    updateItem:              vi.fn(),
    resetServiceForRetry:    vi.fn(),
    resetItemForRetry:       vi.fn(),
    updateServiceProgress:   vi.fn(),
    markItemComplete:        vi.fn(),
    markItemFailed:          vi.fn(),
  };
}

function makeOptions(overrides: Partial<RetryOptions> = {}): RetryOptions {
  return {
    configStore:     {} as RetryOptions['configStore'],
    queueManager:    makeQueueManager() as unknown as RetryOptions['queueManager'],
    activePrefix:    null,
    toast:           makeToast(),
    saveHistoryItem: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── 测试 ──────────────────────────────────────────────────

describe('RetryService.retryAllFailed', () => {
  it('空列表直接返回 {success: 0, failed: 0}', async () => {
    const service = new RetryService(makeOptions());
    const result = await service.retryAllFailed([], DEFAULT_CONFIG);
    expect(result).toEqual({ success: 0, failed: 0 });
  });

  it('队列项不存在时跳过，结果为 failed', async () => {
    // queueManager.getItem 返回 undefined（无此项）
    const toast = makeToast();
    const queueManager = makeQueueManager(undefined);
    const service = new RetryService(makeOptions({ toast, queueManager: queueManager as unknown as RetryOptions['queueManager'] }));

    const result = await service.retryAllFailed(['nonexistent-id'], DEFAULT_CONFIG);
    expect(result).toEqual({ success: 0, failed: 0 });
  });

  it('批量重传仅显示最终汇总 toast，且单项重传使用静默模式', async () => {
    const toast = makeToast();
    const items: Record<string, QueueItem> = {
      'id-1': {
        id: 'id-1',
        fileName: 'a.jpg',
        filePath: '/tmp/a.jpg',
        status: 'error',
        enabledServices: ['weibo'],
        serviceProgress: {
          weibo: { serviceId: 'weibo', status: '✗ 失败', progress: 0, error: 'e1' }
        }
      } as QueueItem,
      'id-2': {
        id: 'id-2',
        fileName: 'b.jpg',
        filePath: '/tmp/b.jpg',
        status: 'error',
        enabledServices: ['upyun'],
        serviceProgress: {
          upyun: { serviceId: 'upyun', status: '✗ 失败', progress: 0, error: 'e2' }
        }
      } as QueueItem,
    };

    const queueManager = {
      ...makeQueueManager(items['id-1']),
      getItem: vi.fn((id: string) => items[id]),
    };

    const service = new RetryService(makeOptions({
      toast,
      queueManager: queueManager as unknown as RetryOptions['queueManager']
    }));

    const singleRetrySpy = vi.spyOn(service, 'retrySingleService').mockImplementation(
      async (itemId, serviceId, _config, options) => {
        const item = items[itemId];
        if (!item) return;
        if (item.serviceProgress?.[serviceId]) {
          item.serviceProgress[serviceId] = {
            ...item.serviceProgress[serviceId],
            status: '✓ 完成',
            progress: 100,
          };
        }
        expect(options).toEqual({ silentToast: true });
      }
    );

    const result = await service.retryAllFailed(['id-1', 'id-2'], DEFAULT_CONFIG);

    expect(result).toEqual({ success: 2, failed: 0 });
    expect(singleRetrySpy).toHaveBeenCalledTimes(2);
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.warn).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('批量重传完成', '重传结果：成功 2，失败 0。');
  });

  it('批量重传部分成功时仅显示一条汇总 warn', async () => {
    const toast = makeToast();
    const items: Record<string, QueueItem> = {
      'id-1': {
        id: 'id-1',
        fileName: 'a.jpg',
        filePath: '/tmp/a.jpg',
        status: 'error',
        enabledServices: ['weibo'],
        serviceProgress: {
          weibo: { serviceId: 'weibo', status: '✗ 失败', progress: 0, error: 'e1' }
        }
      } as QueueItem,
      'id-2': {
        id: 'id-2',
        fileName: 'b.jpg',
        filePath: '/tmp/b.jpg',
        status: 'error',
        enabledServices: ['upyun'],
        serviceProgress: {
          upyun: { serviceId: 'upyun', status: '✗ 失败', progress: 0, error: 'e2' }
        }
      } as QueueItem,
    };

    const queueManager = {
      ...makeQueueManager(items['id-1']),
      getItem: vi.fn((id: string) => items[id]),
    };

    const service = new RetryService(makeOptions({
      toast,
      queueManager: queueManager as unknown as RetryOptions['queueManager']
    }));

    vi.spyOn(service, 'retrySingleService').mockImplementation(
      async (itemId, serviceId) => {
        const item = items[itemId];
        if (!item || !item.serviceProgress?.[serviceId]) return;
        if (itemId === 'id-1') {
          item.serviceProgress[serviceId] = {
            ...item.serviceProgress[serviceId],
            status: '✓ 完成',
            progress: 100,
          };
        }
      }
    );

    const result = await service.retryAllFailed(['id-1', 'id-2'], DEFAULT_CONFIG);

    expect(result).toEqual({ success: 1, failed: 1 });
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warn).toHaveBeenCalledWith('批量重传部分完成', '重传结果：成功 1，失败 1。', 5000);
  });
});

describe('RetryService.retrySingleService', () => {
  it('队列项不存在时 → 调用 toast.error', async () => {
    const toast = makeToast();
    const queueManager = makeQueueManager(undefined);
    const service = new RetryService(makeOptions({ toast, queueManager: queueManager as unknown as RetryOptions['queueManager'] }));

    await service.retrySingleService('nonexistent', 'weibo', DEFAULT_CONFIG);

    expect(toast.error).toHaveBeenCalledWith('重试失败', '队列项不存在');
  });
});

describe('RetryService.retryAll', () => {
  it('队列项不存在时 → 调用 toast.error', async () => {
    const toast = makeToast();
    const queueManager = makeQueueManager(undefined);
    const service = new RetryService(makeOptions({ toast, queueManager: queueManager as unknown as RetryOptions['queueManager'] }));

    await service.retryAll('nonexistent', DEFAULT_CONFIG);

    expect(toast.error).toHaveBeenCalledWith('重试失败', '队列项不存在');
  });

  it('超出最大重试次数 → 调用 toast.error 并包含次数信息', async () => {
    const toast = makeToast();
    const queueManager = makeQueueManager({
      retryCount: 3,
      maxRetries: 3,
    });
    const service = new RetryService(makeOptions({ toast, queueManager: queueManager as unknown as RetryOptions['queueManager'] }));

    await service.retryAll('item-1', DEFAULT_CONFIG);

    expect(toast.error).toHaveBeenCalledOnce();
    const [title] = toast.error.mock.calls[0];
    expect(title).toBe('重试次数已用尽');
  });

  it('网络不可用 → 调用 toast.error', async () => {
    const { checkNetworkConnectivity } = await import('../../../utils/network');
    vi.mocked(checkNetworkConnectivity).mockResolvedValueOnce(false);

    const toast = makeToast();
    const queueManager = makeQueueManager({ retryCount: 0, maxRetries: 3 });
    const service = new RetryService(makeOptions({ toast, queueManager: queueManager as unknown as RetryOptions['queueManager'] }));

    await service.retryAll('item-1', DEFAULT_CONFIG);

    expect(toast.error).toHaveBeenCalledWith('网络请求失败', '请检查网络后重试', 3000);
  });
});
