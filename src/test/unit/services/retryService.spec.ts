import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueItem } from '../../../uploadQueue';
import type { RetryOptions } from '../../../services/RetryService';
import type { UploadResult } from '../../../uploaders/base/types';
import { DEFAULT_CONFIG } from '../../../config/types';

const {
  checkNetworkConnectivityMock,
  retryUploadMock,
  uploadToMultipleServicesMock,
  historyGetByIdMock,
  historyGetByFilePathMock,
  historyUpdateMock,
  invalidateCacheMock,
  emitHistoryUpdatedMock,
  getServiceDisplayNameMock,
  invokeMock,
} = vi.hoisted(() => ({
  checkNetworkConnectivityMock: vi.fn(),
  retryUploadMock: vi.fn(),
  uploadToMultipleServicesMock: vi.fn(),
  historyGetByIdMock: vi.fn(),
  historyGetByFilePathMock: vi.fn(),
  historyUpdateMock: vi.fn(),
  invalidateCacheMock: vi.fn(),
  emitHistoryUpdatedMock: vi.fn(),
  getServiceDisplayNameMock: vi.fn((serviceId: string) => `name:${serviceId}`),
  invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('../../../utils/network', () => ({
  checkNetworkConnectivity: checkNetworkConnectivityMock,
}));

vi.mock('../../../core/MultiServiceUploader', () => ({
  MultiServiceUploader: class {
    retryUpload = retryUploadMock;
    uploadToMultipleServices = uploadToMultipleServicesMock;
  },
}));

vi.mock('../../../services/HistoryDatabase', () => ({
  historyDB: {
    getById: historyGetByIdMock,
    getByFilePath: historyGetByFilePathMock,
    update: historyUpdateMock,
  },
}));

vi.mock('../../../composables/useHistory', () => ({
  invalidateCache: invalidateCacheMock,
}));

vi.mock('../../../events/cacheEvents', () => ({
  emitHistoryUpdated: emitHistoryUpdatedMock,
}));

vi.mock('../../../constants/serviceNames', () => ({
  getServiceDisplayName: getServiceDisplayNameMock,
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { RetryService } = await import('../../../services/RetryService');

type MutableQueueManager = RetryOptions['queueManager'] & {
  items: Map<string, QueueItem>;
  updateItem: ReturnType<typeof vi.fn>;
  resetItemForRetry: ReturnType<typeof vi.fn>;
  resetServiceForRetry: ReturnType<typeof vi.fn>;
  updateServiceProgress: ReturnType<typeof vi.fn>;
  markItemComplete: ReturnType<typeof vi.fn>;
  markItemFailed: ReturnType<typeof vi.fn>;
};

function makeToast() {
  return {
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'item-1',
    fileName: 'demo.png',
    filePath: '/tmp/demo.png',
    status: 'error',
    enabledServices: ['weibo'],
    serviceProgress: {
      weibo: {
        serviceId: 'weibo',
        progress: 0,
        status: '\u5931\u8d25',
        error: 'old error',
      },
    },
    retryCount: 0,
    maxRetries: 3,
    ...overrides,
  };
}

function createQueueManager(items: QueueItem[] = [createItem()]): MutableQueueManager {
  const itemMap = new Map(items.map(item => [item.id, structuredClone(item)]));

  const updateItem = vi.fn((itemId: string, updates: Partial<QueueItem>) => {
    const current = itemMap.get(itemId);
    if (!current) return;

    const next: QueueItem = {
      ...current,
      ...updates,
      serviceProgress: {
        ...current.serviceProgress,
        ...(updates.serviceProgress ?? {}),
      },
    };

    itemMap.set(itemId, next);
  });

  const resetServiceForRetry = vi.fn((itemId: string, serviceId: string) => {
    const current = itemMap.get(itemId);
    if (!current) return;
    updateItem(itemId, {
      status: current.status === 'error' ? 'uploading' : current.status,
      serviceProgress: {
        [serviceId]: {
          ...current.serviceProgress[serviceId],
          serviceId,
          progress: 0,
          status: '\u7b49\u5f85',
          error: undefined,
          isRetrying: true,
        },
      },
    });
  });

  const resetItemForRetry = vi.fn((itemId: string) => {
    const current = itemMap.get(itemId);
    if (!current) return;
    const serviceProgress = Object.fromEntries(
      current.enabledServices.map(serviceId => [
        serviceId,
        {
          ...current.serviceProgress[serviceId],
          serviceId,
          progress: 0,
          status: '\u7b49\u5f85',
          error: undefined,
          isRetrying: false,
        },
      ]),
    );
    updateItem(itemId, {
      status: 'pending',
      serviceProgress,
      primaryUrl: undefined,
      thumbUrl: undefined,
      errorMessage: undefined,
    });
  });

  const updateServiceProgress = vi.fn((itemId: string, serviceId: string, percent: number, step?: string) => {
    updateItem(itemId, {
      status: 'uploading',
      serviceProgress: {
        [serviceId]: {
          ...itemMap.get(itemId)?.serviceProgress[serviceId],
          serviceId,
          progress: percent,
          status: step ?? `${percent}%`,
        },
      },
    });
  });

  const markItemComplete = vi.fn((itemId: string, primaryUrl: string) => {
    updateItem(itemId, { status: 'success', primaryUrl, thumbUrl: primaryUrl });
  });

  const markItemFailed = vi.fn((itemId: string, errorMessage: string) => {
    updateItem(itemId, { status: 'error', errorMessage });
  });

  return {
    items: itemMap,
    getItem: vi.fn((itemId: string) => itemMap.get(itemId)),
    updateItem,
    resetItemForRetry,
    resetServiceForRetry,
    updateServiceProgress,
    markItemComplete,
    markItemFailed,
  } as unknown as MutableQueueManager;
}

function makeOptions(overrides: Partial<RetryOptions> = {}): RetryOptions {
  return {
    configStore: {} as RetryOptions['configStore'],
    queueManager: createQueueManager(),
    toast: makeToast(),
    saveHistoryItem: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeUploadResult(url = 'https://img.example.com/demo.png'): UploadResult {
  return {
    serviceId: 'weibo',
    fileKey: 'key-1',
    url,
    width: 100,
    height: 80,
    size: 12,
  };
}

describe('RetryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    checkNetworkConnectivityMock.mockResolvedValue(true);
    retryUploadMock.mockResolvedValue(makeUploadResult());
    uploadToMultipleServicesMock.mockResolvedValue({
      primaryService: 'weibo',
      primaryUrl: 'https://img.example.com/demo.png',
      results: [
        {
          serviceId: 'weibo',
          status: 'success',
          result: makeUploadResult(),
        },
      ],
      isPartialSuccess: false,
    });
    historyGetByFilePathMock.mockResolvedValue({
      id: 'history-1',
      results: [],
    });
    historyGetByIdMock.mockResolvedValue(null);
    historyUpdateMock.mockResolvedValue(undefined);
    emitHistoryUpdatedMock.mockResolvedValue(undefined);
    invokeMock.mockResolvedValue(true);
  });

  it('shows an error when retrySingleService cannot find the queue item', async () => {
    const toast = makeToast();
    const queueManager = createQueueManager([]);
    const service = new RetryService(makeOptions({ toast, queueManager }));

    await service.retrySingleService('missing', 'weibo', DEFAULT_CONFIG);

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(retryUploadMock).not.toHaveBeenCalled();
  });

  it('does not run the same single-service retry twice at the same time', async () => {
    const deferred = createDeferred<UploadResult>();
    retryUploadMock.mockReturnValueOnce(deferred.promise);

    const queueManager = createQueueManager([
      createItem({
        status: 'uploading',
      }),
    ]);
    const service = new RetryService(makeOptions({ queueManager }));

    const first = service.retrySingleService('item-1', 'weibo', DEFAULT_CONFIG);
    await Promise.resolve();
    const second = service.retrySingleService('item-1', 'weibo', DEFAULT_CONFIG);

    deferred.resolve(makeUploadResult());
    await Promise.all([first, second]);

    expect(retryUploadMock).toHaveBeenCalledTimes(1);
  });

  it('updates the queue and history after a successful single-service retry', async () => {
    const toast = makeToast();
    const queueManager = createQueueManager([
      createItem({
        enabledServices: ['weibo', 'r2'],
        serviceProgress: {
          weibo: {
            serviceId: 'weibo',
            progress: 0,
            status: '\u5931\u8d25',
          },
          r2: {
            serviceId: 'r2',
            progress: 100,
            status: '\u5b8c\u6210',
            link: 'https://img.example.com/r2.png',
          },
        },
      }),
    ]);

    const service = new RetryService(makeOptions({
      toast,
      queueManager,
    }));

    await service.retrySingleService('item-1', 'weibo', DEFAULT_CONFIG);

    const item = queueManager.items.get('item-1')!;
    expect(item.status).toBe('success');
    expect(item.primaryUrl).toBe('https://img.example.com/demo.png');
    expect(item.thumbUrl).toBe('https://img.example.com/demo.png');
    expect(item.serviceProgress.weibo?.link).toBe('https://img.example.com/demo.png');
    expect(historyGetByFilePathMock).toHaveBeenCalledWith('/tmp/demo.png');
    expect(historyUpdateMock).toHaveBeenCalledWith('history-1', expect.objectContaining({
      results: [
        expect.objectContaining({
          serviceId: 'weibo',
          status: 'success',
        }),
      ],
    }));
    expect(invalidateCacheMock).toHaveBeenCalled();
    expect(emitHistoryUpdatedMock).toHaveBeenCalledWith(['history-1']);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('syncs history primary fields when a single-service retry promotes the queue primary link', async () => {
    const queueManager = createQueueManager([
      createItem({
        historyId: 'history-promote',
        primaryUrl: 'https://img.example.com/r2-old.png',
        enabledServices: ['weibo', 'r2'],
        serviceProgress: {
          weibo: {
            serviceId: 'weibo',
            progress: 0,
            status: '\u5931\u8d25',
          },
          r2: {
            serviceId: 'r2',
            progress: 100,
            status: '\u5b8c\u6210',
            link: 'https://img.example.com/r2-old.png',
          },
        },
      }),
    ]);
    historyGetByIdMock.mockResolvedValueOnce({
      id: 'history-promote',
      primaryService: 'r2',
      generatedLink: 'https://img.example.com/r2-old.png',
      results: [],
    });

    const service = new RetryService(makeOptions({ queueManager }));

    await service.retrySingleService('item-1', 'weibo', DEFAULT_CONFIG);

    expect(queueManager.items.get('item-1')?.primaryUrl).toBe('https://img.example.com/demo.png');
    expect(historyUpdateMock).toHaveBeenCalledWith('history-promote', expect.objectContaining({
      primaryService: 'weibo',
      generatedLink: 'https://img.example.com/demo.png',
      results: expect.any(Array),
    }));
  });

  it('does not change history primary fields when a single-service retry only adds a mirror', async () => {
    const queueManager = createQueueManager([
      createItem({
        historyId: 'history-mirror',
        primaryUrl: 'https://img.example.com/weibo.png',
        enabledServices: ['weibo', 'r2'],
        serviceProgress: {
          weibo: {
            serviceId: 'weibo',
            progress: 100,
            status: '\u5b8c\u6210',
            link: 'https://img.example.com/weibo.png',
          },
          r2: {
            serviceId: 'r2',
            progress: 0,
            status: '\u5931\u8d25',
          },
        },
      }),
    ]);
    historyGetByIdMock.mockResolvedValueOnce({
      id: 'history-mirror',
      primaryService: 'weibo',
      generatedLink: 'https://img.example.com/weibo.png',
      results: [],
    });
    retryUploadMock.mockResolvedValueOnce({
      ...makeUploadResult('https://img.example.com/r2.png'),
      serviceId: 'r2',
      fileKey: 'r2-key',
    });

    const service = new RetryService(makeOptions({ queueManager }));

    await service.retrySingleService('item-1', 'r2', DEFAULT_CONFIG);

    expect(queueManager.items.get('item-1')?.primaryUrl).toBe('https://img.example.com/weibo.png');
    expect(historyUpdateMock).toHaveBeenCalledWith('history-mirror', expect.not.objectContaining({
      primaryService: expect.anything(),
      generatedLink: expect.anything(),
    }));
    expect(historyUpdateMock).toHaveBeenCalledWith('history-mirror', expect.objectContaining({
      results: [
        expect.objectContaining({
          serviceId: 'r2',
          status: 'success',
        }),
      ],
    }));
  });

  it('updates history by queue historyId instead of ambiguous filePath', async () => {
    const queueManager = createQueueManager([
      createItem({
        historyId: 'history-current',
      }),
    ]);
    historyGetByIdMock.mockResolvedValueOnce({
      id: 'history-current',
      results: [],
    });

    const service = new RetryService(makeOptions({ queueManager }));

    await service.retrySingleService('item-1', 'weibo', DEFAULT_CONFIG);

    expect(historyGetByIdMock).toHaveBeenCalledWith('history-current');
    expect(historyGetByFilePathMock).not.toHaveBeenCalled();
    expect(historyUpdateMock).toHaveBeenCalledWith('history-current', expect.objectContaining({
      results: [
        expect.objectContaining({
          serviceId: 'weibo',
          status: 'success',
        }),
      ],
    }));
  });

  it('falls back to filePath lookup when a legacy queue item has no usable historyId', async () => {
    const queueManager = createQueueManager([
      createItem({
        historyId: 'missing-history',
      }),
    ]);
    historyGetByIdMock.mockResolvedValueOnce(null);
    historyGetByFilePathMock.mockResolvedValueOnce({
      id: 'history-latest',
      results: [],
    });

    const service = new RetryService(makeOptions({ queueManager }));

    await service.retrySingleService('item-1', 'weibo', DEFAULT_CONFIG);

    expect(historyGetByIdMock).toHaveBeenCalledWith('missing-history');
    expect(historyGetByFilePathMock).toHaveBeenCalledWith('/tmp/demo.png');
    expect(historyUpdateMock).toHaveBeenCalledWith('history-latest', expect.objectContaining({
      results: expect.any(Array),
    }));
  });

  it('keeps the whole item in error after one failed service is fixed but another failed service remains', async () => {
    const toast = makeToast();
    const filePath = 'C:/Temp/clipboard_image_retry_pending.png';
    const queueManager = createQueueManager([
      createItem({
        filePath,
        status: 'error',
        enabledServices: ['weibo', 'r2', 'github'],
        serviceProgress: {
          weibo: {
            serviceId: 'weibo',
            progress: 100,
            status: '\u5b8c\u6210',
            link: 'https://img.example.com/weibo.png',
          },
          r2: {
            serviceId: 'r2',
            progress: 0,
            status: '\u5931\u8d25',
            error: 'old r2 error',
          },
          github: {
            serviceId: 'github',
            progress: 0,
            status: '\u5931\u8d25',
            error: 'old github error',
          },
        },
        primaryUrl: 'https://img.example.com/weibo.png',
      }),
    ]);
    const service = new RetryService(makeOptions({ toast, queueManager }));

    await service.retrySingleService('item-1', 'r2', DEFAULT_CONFIG);

    const item = queueManager.items.get('item-1')!;
    expect(item.status).toBe('error');
    expect(item.serviceProgress.r2?.status).toContain('\u5b8c\u6210');
    expect(item.serviceProgress.github?.status).toContain('\u5931\u8d25');
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalledWith('cleanup_clipboard_temp_file', { path: filePath });
  });

  it('cleans a retained clipboard temp file after the last failed service is fixed', async () => {
    const filePath = 'C:/Temp/clipboard_image_retry_done.png';
    const queueManager = createQueueManager([
      createItem({
        filePath,
        status: 'error',
        enabledServices: ['weibo', 'r2'],
        serviceProgress: {
          weibo: {
            serviceId: 'weibo',
            progress: 100,
            status: '\u5b8c\u6210',
            link: 'https://img.example.com/weibo.png',
          },
          r2: {
            serviceId: 'r2',
            progress: 0,
            status: '\u5931\u8d25',
            error: 'old r2 error',
          },
        },
      }),
    ]);
    const service = new RetryService(makeOptions({ queueManager }));

    await service.retrySingleService('item-1', 'r2', DEFAULT_CONFIG);

    expect(queueManager.items.get('item-1')?.status).toBe('success');
    expect(invokeMock).toHaveBeenCalledWith('cleanup_clipboard_temp_file', { path: filePath });
  });

  it('treats skipped unconfigured services as complete when the remaining failed service is fixed', async () => {
    const filePath = 'C:/Temp/clipboard_image_retry_done_with_skip.png';
    const queueManager = createQueueManager([
      createItem({
        filePath,
        status: 'error',
        enabledServices: ['weibo', 'r2', 'github'],
        serviceProgress: {
          weibo: {
            serviceId: 'weibo',
            progress: 100,
            status: '\u5b8c\u6210',
            link: 'https://img.example.com/weibo.png',
          },
          r2: {
            serviceId: 'r2',
            progress: 0,
            status: '\u5931\u8d25',
            error: 'old r2 error',
          },
          github: {
            serviceId: 'github',
            progress: 0,
            status: '\u5df2\u8df3\u8fc7\uff08\u672a\u914d\u7f6e\uff09',
          },
        },
      }),
    ]);
    const service = new RetryService(makeOptions({ queueManager }));

    await service.retrySingleService('item-1', 'r2', DEFAULT_CONFIG);

    expect(queueManager.items.get('item-1')?.status).toBe('success');
    expect(invokeMock).toHaveBeenCalledWith('cleanup_clipboard_temp_file', { path: filePath });
  });

  it('marks the whole item as error when a single-service retry fails and nothing else is active', async () => {
    retryUploadMock.mockRejectedValueOnce(new Error('boom'));

    const toast = makeToast();
    const queueManager = createQueueManager([
      createItem({
        status: 'uploading',
        enabledServices: ['weibo'],
      }),
    ]);
    const service = new RetryService(makeOptions({ toast, queueManager }));

    await service.retrySingleService('item-1', 'weibo', DEFAULT_CONFIG);

    const item = queueManager.items.get('item-1')!;
    expect(item.status).toBe('error');
    expect(item.serviceProgress.weibo?.error).toBe('boom');
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('stops retryAll when the max retry count has already been reached', async () => {
    const toast = makeToast();
    const queueManager = createQueueManager([
      createItem({
        retryCount: 3,
        maxRetries: 3,
      }),
    ]);
    const service = new RetryService(makeOptions({ toast, queueManager }));

    await service.retryAll('item-1', DEFAULT_CONFIG);

    expect(uploadToMultipleServicesMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('uses exponential backoff, then saves the full retry result and warns on partial failures', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const toast = makeToast();
    const queueManager = createQueueManager([
      createItem({
        retryCount: 1,
        maxRetries: 3,
        enabledServices: ['weibo', 'r2'],
        serviceProgress: {
          weibo: {
            serviceId: 'weibo',
            progress: 0,
            status: '\u5931\u8d25',
          },
          r2: {
            serviceId: 'r2',
            progress: 0,
            status: '\u5931\u8d25',
          },
        },
      }),
    ]);
    uploadToMultipleServicesMock.mockResolvedValueOnce({
      primaryService: 'weibo',
      primaryUrl: 'https://img.example.com/demo.png',
      results: [
        {
          serviceId: 'weibo',
          status: 'success',
          result: makeUploadResult(),
        },
        {
          serviceId: 'r2',
          status: 'failed',
          error: 'r2 failed',
        },
      ],
      isPartialSuccess: true,
      partialFailures: [
        {
          serviceId: 'r2',
          error: 'r2 failed',
        },
      ],
    });

    const saveHistoryItem = vi.fn().mockResolvedValue(undefined);
    const service = new RetryService(makeOptions({
      toast,
      queueManager,
      saveHistoryItem,
    }));

    const promise = service.retryAll('item-1', DEFAULT_CONFIG);
    await Promise.resolve();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2500);
    await vi.advanceTimersByTimeAsync(2500);
    await promise;

    const item = queueManager.items.get('item-1')!;
    expect(item.retryCount).toBe(2);
    expect(item.isRetrying).toBe(false);
    expect(queueManager.markItemComplete).toHaveBeenCalledWith('item-1', 'https://img.example.com/demo.png');
    expect(saveHistoryItem).toHaveBeenCalledWith('/tmp/demo.png', expect.objectContaining({
      isPartialSuccess: true,
    }));
    expect(toast.warn).toHaveBeenCalledTimes(1);
  });

  it('cleans a retained clipboard temp file after full retry succeeds completely', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const filePath = 'C:/Temp/clipboard_image_full_retry_done.png';
    const queueManager = createQueueManager([
      createItem({
        filePath,
        retryCount: 0,
        maxRetries: 3,
        enabledServices: ['weibo'],
      }),
    ]);
    const service = new RetryService(makeOptions({ queueManager }));

    const promise = service.retryAll('item-1', DEFAULT_CONFIG);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(queueManager.items.get('item-1')?.status).toBe('success');
    expect(invokeMock).toHaveBeenCalledWith('cleanup_clipboard_temp_file', { path: filePath });
  });

  it('aggregates mixed retryAllFailed outcomes across multiple failed services', async () => {
    const toast = makeToast();
    const queueManager = createQueueManager([
      createItem({
        id: 'item-a',
        filePath: '/tmp/a.png',
        fileName: 'a.png',
      }),
      createItem({
        id: 'item-b',
        filePath: '/tmp/b.png',
        fileName: 'b.png',
      }),
    ]);
    const service = new RetryService(makeOptions({ toast, queueManager }));

    vi.spyOn(service, 'retrySingleService').mockImplementation(async (itemId, serviceId) => {
      if (itemId === 'item-a') {
        queueManager.updateItem(itemId, {
          serviceProgress: {
            [serviceId]: {
              serviceId,
              progress: 100,
              status: '\u5b8c\u6210',
            },
          },
        });
      }
    });

    const result = await service.retryAllFailed(['item-a', 'item-b'], DEFAULT_CONFIG);

    expect(result).toEqual({ success: 1, failed: 1 });
    expect(toast.warn).toHaveBeenCalledTimes(1);
  });

  it('同一队列项两个失败服务批量重传并发成功后都保持完成', async () => {
    const weiboRetry = createDeferred<UploadResult>();
    const r2Retry = createDeferred<UploadResult>();
    retryUploadMock.mockImplementation((_filePath: string, serviceId: string) => {
      if (serviceId === 'r2') return r2Retry.promise;
      return weiboRetry.promise;
    });

    const toast = makeToast();
    const queueManager = createQueueManager([
      createItem({
        enabledServices: ['weibo', 'r2'],
        serviceProgress: {
          weibo: {
            serviceId: 'weibo',
            progress: 0,
            status: '\u5931\u8d25',
          },
          r2: {
            serviceId: 'r2',
            progress: 0,
            status: '\u5931\u8d25',
          },
        },
      }),
    ]);
    const service = new RetryService(makeOptions({ toast, queueManager }));

    const retryPromise = service.retryAllFailed(['item-1'], DEFAULT_CONFIG);
    await Promise.resolve();
    await Promise.resolve();

    r2Retry.resolve({
      ...makeUploadResult('https://img.example.com/r2.png'),
      serviceId: 'r2',
      fileKey: 'r2-key',
    });
    await Promise.resolve();
    weiboRetry.resolve(makeUploadResult('https://img.example.com/weibo.png'));

    const result = await retryPromise;

    const item = queueManager.items.get('item-1')!;
    expect(result).toEqual({ success: 2, failed: 0 });
    expect(item.status).toBe('success');
    expect(item.serviceProgress.weibo?.status).toContain('完成');
    expect(item.serviceProgress.r2?.status).toContain('完成');
    expect(item.serviceProgress.weibo?.link).toBe('https://img.example.com/weibo.png');
    expect(item.serviceProgress.r2?.link).toBe('https://img.example.com/r2.png');
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('counts every pending failed service as failed when retryAllFailed cannot start because the network is down', async () => {
    checkNetworkConnectivityMock.mockResolvedValueOnce(false);
    const toast = makeToast();
    const queueManager = createQueueManager([
      createItem({
        id: 'item-a',
        enabledServices: ['weibo', 'r2'],
        serviceProgress: {
          weibo: {
            serviceId: 'weibo',
            progress: 0,
            status: '\u5931\u8d25',
          },
          r2: {
            serviceId: 'r2',
            progress: 0,
            status: '\u5931\u8d25',
          },
        },
      }),
    ]);
    const service = new RetryService(makeOptions({ toast, queueManager }));

    const result = await service.retryAllFailed(['item-a'], DEFAULT_CONFIG);

    expect(result).toEqual({ success: 0, failed: 2 });
    expect(retryUploadMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
