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
