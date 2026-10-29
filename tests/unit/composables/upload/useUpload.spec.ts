import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_CONFIG } from '@/config/types';
import { MAX_FILES_PER_UPLOAD } from '@/composables/upload/FileValidator';
import { isUploading } from '@/composables/upload/uploadState';

const {
  configStoreGetMock,
  fetchMetadataBatchMock,
  saveHistoryItemMock,
  saveHistoryItemImmediateMock,
  addResultToHistoryItemMock,
  reconcileHistoryPrimaryMock,
  copyLinksMock,
  checkNetworkConnectivityMock,
  uploadToMultipleServicesMock,
  toastSuccessMock,
  toastWarnMock,
  toastErrorMock,
  toastInfoMock,
  toastShowConfigMock,
  compressImageBatchMock,
  getImageMetadataMock,
} = vi.hoisted(() => ({
  configStoreGetMock: vi.fn(),
  fetchMetadataBatchMock: vi.fn(),
  saveHistoryItemMock: vi.fn(),
  saveHistoryItemImmediateMock: vi.fn(),
  addResultToHistoryItemMock: vi.fn(),
  reconcileHistoryPrimaryMock: vi.fn(),
  copyLinksMock: vi.fn(),
  checkNetworkConnectivityMock: vi.fn(),
  uploadToMultipleServicesMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastWarnMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
  toastShowConfigMock: vi.fn(),
  compressImageBatchMock: vi.fn(),
  getImageMetadataMock: vi.fn(),
}));

const selectedServicesRef = ref(['jd', 'upyun']);
const availableServicesRef = ref(['jd', 'upyun']);
const serviceConfigStatusRef = ref({});
const activePrefixRef = ref<string | null>(null);
const invokeMock = vi.mocked(invoke);

vi.mock('@/store/instances', () => ({
  configStore: {
    get: configStoreGetMock,
  },
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    warn: toastWarnMock,
    error: toastErrorMock,
    info: toastInfoMock,
    showConfig: toastShowConfigMock,
  }),
}));

vi.mock('@/composables/useCopyLink', () => ({
  useCopyLink: () => ({
    copyLinks: copyLinksMock,
  }),
}));

vi.mock('@/composables/service/useServiceSelector', () => ({
  useServiceSelector: () => ({
    selectedServices: selectedServicesRef,
    availableServices: availableServicesRef,
    serviceConfigStatus: serviceConfigStatusRef,
    activePrefix: activePrefixRef,
    isServiceAvailable: () => true,
    isServiceSelected: () => true,
    loadServiceButtonStates: vi.fn(),
    toggleServiceSelection: vi.fn(),
    setupConfigListener: vi.fn(),
  }),
}));

vi.mock('@/composables/service/useServiceHealth', () => ({
  useServiceHealth: () => ({
    markUploadError: vi.fn(),
  }),
}));

vi.mock('@/composables/history/useHistorySaver', () => ({
  useHistorySaver: () => ({
    saveHistoryItem: saveHistoryItemMock,
    saveHistoryItemImmediate: saveHistoryItemImmediateMock,
    addResultToHistoryItem: addResultToHistoryItemMock,
    reconcileHistoryPrimary: reconcileHistoryPrimaryMock,
  }),
}));

vi.mock('@/composables/image/useImageMetadata', () => ({
  fetchMetadataBatch: fetchMetadataBatchMock,
  getImageMetadata: getImageMetadataMock,
}));

vi.mock('@/composables/image/useImageCompress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/composables/image/useImageCompress')>()),
  useImageCompress: () => ({ compressImageBatch: compressImageBatchMock, cleanupTempFiles: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('@/utils/network', () => ({
  checkNetworkConnectivity: checkNetworkConnectivityMock,
}));

vi.mock('@/core/MultiServiceUploader', () => ({
  MultiServiceUploader: class {
    uploadToMultipleServices = uploadToMultipleServicesMock;
  },
}));

function createQueueManager() {
  const item = {
    id: 'queue-1',
    fileName: 'test.jpg',
    filePath: 'C:/tmp/test.jpg',
    enabledServices: ['jd', 'upyun'],
    serviceProgress: {
      jd: { serviceId: 'jd', progress: 0, status: '等待中...' },
      upyun: { serviceId: 'upyun', progress: 0, status: '等待中...' },
    },
    status: 'pending',
  };

  return {
    addFile: vi.fn().mockReturnValue(item.id),
    getItem: vi.fn().mockImplementation(() => item),
    updateItem: vi.fn().mockImplementation((_itemId: string, updates: Record<string, unknown>) => {
      if (updates.serviceProgress) {
        item.serviceProgress = {
          ...item.serviceProgress,
          ...(updates.serviceProgress as Record<string, unknown>),
        };
      }
      Object.assign(item, updates);
    }),
    updateServiceProgress: vi.fn(),
    // 同真队列：传完 / 失败就不再是「等待中」（上传收尾按这个找没开始传的）
    markItemComplete: vi.fn(() => { item.status = 'success'; }),
    markItemFailed: vi.fn(() => { item.status = 'error'; }),
  };
}

function createMultiQueueManager() {
  const items = new Map<string, any>();
  let nextId = 0;

  return {
    addFile: vi.fn((filePath: string, fileName: string, enabledServices: string[]) => {
      const id = `queue-${nextId++}`;
      items.set(id, {
        id,
        fileName,
        filePath,
        enabledServices,
        serviceProgress: Object.fromEntries(
          enabledServices.map(serviceId => [
            serviceId,
            { serviceId, progress: 0, status: '等待中...' },
          ]),
        ),
        status: 'pending',
      });
      return id;
    }),
    getItem: vi.fn((itemId: string) => items.get(itemId)),
    updateItem: vi.fn((itemId: string, updates: Record<string, unknown>) => {
      const item = items.get(itemId);
      if (!item) return;
      if (updates.serviceProgress) {
        item.serviceProgress = {
          ...item.serviceProgress,
          ...(updates.serviceProgress as Record<string, unknown>),
        };
      }
      Object.assign(item, updates);
    }),
    updateServiceProgress: vi.fn(),
    markItemComplete: vi.fn((itemId: string) => { items.get(itemId).status = 'success'; }),
    markItemFailed: vi.fn((itemId: string) => { items.get(itemId).status = 'error'; }),
  };
}

describe('useUploadManager', () => {
  beforeEach(() => {
    // 上传锁是模块级的：某条用例中途失败留下的锁不能拖垮后面的用例
    isUploading.value = false;
    selectedServicesRef.value = ['jd', 'upyun'];
    availableServicesRef.value = ['jd', 'upyun'];
    serviceConfigStatusRef.value = {};
    activePrefixRef.value = null;
    configStoreGetMock.mockReset().mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabledServices: ['jd', 'upyun'],
      publicServiceRiskAccepted: true,
      linkOutput: {
        ...DEFAULT_CONFIG.linkOutput!,
        autoCopy: false,
      },
    });
    fetchMetadataBatchMock.mockReset().mockResolvedValue(undefined);
    compressImageBatchMock.mockReset().mockResolvedValue(new Map());
    getImageMetadataMock.mockReset().mockResolvedValue({ file_size: 1_200_000 });
    saveHistoryItemMock.mockReset().mockResolvedValue(undefined);
    saveHistoryItemImmediateMock.mockReset().mockResolvedValue(undefined);
    addResultToHistoryItemMock.mockReset().mockResolvedValue(true);
    copyLinksMock.mockReset().mockResolvedValue({ ok: true, copiedCount: 0, format: 'url' });
    checkNetworkConnectivityMock.mockReset().mockResolvedValue(true);
    invokeMock.mockReset().mockResolvedValue({ width: 100, height: 80 });
    toastSuccessMock.mockReset();
    toastWarnMock.mockReset();
    toastErrorMock.mockReset();
    toastInfoMock.mockReset();
    toastShowConfigMock.mockReset();
    uploadToMultipleServicesMock.mockReset().mockImplementation(
      async (
        _filePath: string,
        _enabledServices: string[],
        _config: unknown,
        _onProgress?: unknown,
        onServiceResult?: (result: any) => void | Promise<void>
      ) => {
        const failed = {
          serviceId: 'upyun',
          status: 'failed' as const,
          error: '又拍云上传失败: 上传失败: service error',
        };
        const success = {
          serviceId: 'jd',
          status: 'success' as const,
          result: {
            serviceId: 'jd',
            fileKey: 'jd-key',
            url: 'https://example.com/jd.jpg',
          },
        };

        await onServiceResult?.(failed);
        await onServiceResult?.(success);

        return {
          primaryService: 'jd',
          primaryUrl: 'https://example.com/jd.jpg',
          results: [failed, success],
          partialFailures: [{ serviceId: 'upyun', error: failed.error }],
          isPartialSuccess: true,
        };
      }
    );
  });

  it('only persists success results, skips failures', async () => {
    const queueManager = createQueueManager();
    const { useUploadManager } = await import('@/composables/upload/useUpload');
    const { handleFilesUpload } = useUploadManager(queueManager as never);

    await handleFilesUpload(['C:/tmp/test.jpg']);

    expect(saveHistoryItemImmediateMock).toHaveBeenCalledTimes(1);
    expect(saveHistoryItemImmediateMock.mock.calls[0][1]).toMatchObject({
      serviceId: 'jd',
      status: 'success',
    });
    // 失败结果不应被持久化到历史记录
    expect(addResultToHistoryItemMock).not.toHaveBeenCalled();
  });

  it('copies a single upload as soon as the first host finishes, while the others keep going', async () => {
    configStoreGetMock.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabledServices: ['jd', 'upyun'],
      publicServiceRiskAccepted: true,
      linkOutput: { ...DEFAULT_CONFIG.linkOutput!, autoCopy: true },
    });
    let copiesBeforeSecondHost = -1;
    uploadToMultipleServicesMock.mockImplementationOnce(async (
      _filePath: string,
      _services: string[],
      _config: unknown,
      _onProgress?: unknown,
      onServiceResult?: (result: any) => void | Promise<void>,
    ) => {
      await onServiceResult?.({ serviceId: 'jd', status: 'success', result: { serviceId: 'jd', fileKey: 'k', url: 'https://example.com/jd.jpg' } });
      copiesBeforeSecondHost = copyLinksMock.mock.calls.length;
      await onServiceResult?.({ serviceId: 'upyun', status: 'success', result: { serviceId: 'upyun', fileKey: 'k2', url: 'https://example.com/upyun.jpg' } });
      return { primaryService: 'jd', primaryUrl: 'https://example.com/jd.jpg', results: [] };
    });
    const queueManager = createQueueManager();
    const { useUploadManager } = await import('@/composables/upload/useUpload');
    const { handleFilesUpload } = useUploadManager(queueManager as never);

    await handleFilesUpload(['C:/tmp/test.jpg']);

    expect(copiesBeforeSecondHost).toBe(1);
    expect(copyLinksMock).toHaveBeenCalledTimes(1);
    expect(copyLinksMock.mock.calls[0][0]).toEqual([expect.objectContaining({ url: 'https://example.com/jd.jpg', serviceId: 'jd' })]);
  });

  it('切换图床后立刻上传使用当前界面选择快照', async () => {
    selectedServicesRef.value = ['jd'];
    availableServicesRef.value = ['jd', 'upyun'];
    configStoreGetMock.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabledServices: ['upyun'],
      publicServiceRiskAccepted: true,
      linkOutput: {
        ...DEFAULT_CONFIG.linkOutput!,
        autoCopy: false,
      },
    });
    uploadToMultipleServicesMock.mockImplementationOnce(
      async (
        _filePath: string,
        enabledServices: string[],
        _config: unknown,
        _onProgress?: unknown,
        onServiceResult?: (result: any) => void | Promise<void>
      ) => {
        const serviceId = enabledServices[0];
        const success = {
          serviceId,
          status: 'success' as const,
          result: {
            serviceId,
            fileKey: `${serviceId}-key`,
            url: `https://example.com/${serviceId}.jpg`,
          },
        };
        await onServiceResult?.(success);
        return {
          primaryService: serviceId,
          primaryUrl: success.result.url,
          results: [success],
        };
      }
    );

    const queueManager = createMultiQueueManager();
    const { useUploadManager } = await import('@/composables/upload/useUpload');
    const { handleFilesUpload } = useUploadManager(queueManager as never);

    await handleFilesUpload(['C:/tmp/test.jpg']);

    expect(queueManager.addFile).toHaveBeenCalledWith('C:/tmp/test.jpg', 'test.jpg', ['jd']);
    expect(uploadToMultipleServicesMock).toHaveBeenCalledWith(
      'C:/tmp/test.jpg',
      ['jd'],
      expect.objectContaining({ enabledServices: ['jd'] }),
      expect.any(Function),
      expect.any(Function),
    );
    expect(selectedServicesRef.value).toEqual(['jd']);
  });

  it('blocks default public-risk services until the risk acknowledgement is saved', async () => {
    selectedServicesRef.value = ['jd', 'qiyu'];
    availableServicesRef.value = ['jd', 'qiyu'];
    configStoreGetMock.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabledServices: ['jd', 'qiyu'],
      publicServiceRiskAccepted: false,
      linkOutput: {
        ...DEFAULT_CONFIG.linkOutput!,
        autoCopy: false,
      },
    });

    const queueManager = createMultiQueueManager();
    const { useUploadManager } = await import('@/composables/upload/useUpload');
    const { handleFilesUpload } = useUploadManager(queueManager as never);

    await handleFilesUpload(['C:/tmp/test.jpg']);

    expect(queueManager.addFile).not.toHaveBeenCalled();
    expect(uploadToMultipleServicesMock).not.toHaveBeenCalled();
    expect(toastShowConfigMock).toHaveBeenCalledWith('warn', expect.objectContaining({
      summary: '需要确认公共图床风险',
    }));
  });

  it('skips unacknowledged public-risk services but uploads to remaining selected services', async () => {
    selectedServicesRef.value = ['jd', 'upyun'];
    availableServicesRef.value = ['jd', 'upyun'];
    configStoreGetMock.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabledServices: ['jd', 'upyun'],
      publicServiceRiskAccepted: false,
      linkOutput: {
        ...DEFAULT_CONFIG.linkOutput!,
        autoCopy: false,
      },
    });
    uploadToMultipleServicesMock.mockImplementationOnce(
      async (
        _filePath: string,
        enabledServices: string[],
        _config: unknown,
        _onProgress?: unknown,
        onServiceResult?: (result: any) => void | Promise<void>
      ) => {
        const serviceId = enabledServices[0];
        const success = {
          serviceId,
          status: 'success' as const,
          result: {
            serviceId,
            fileKey: `${serviceId}-key`,
            url: `https://example.com/${serviceId}.jpg`,
          },
        };
        await onServiceResult?.(success);
        return {
          primaryService: serviceId,
          primaryUrl: success.result.url,
          results: [success],
        };
      }
    );

    const queueManager = createMultiQueueManager();
    const { useUploadManager } = await import('@/composables/upload/useUpload');
    const { handleFilesUpload } = useUploadManager(queueManager as never);

    await handleFilesUpload(['C:/tmp/test.jpg']);

    expect(queueManager.addFile).toHaveBeenCalledWith('C:/tmp/test.jpg', 'test.jpg', ['upyun']);
    expect(uploadToMultipleServicesMock).toHaveBeenCalledWith(
      'C:/tmp/test.jpg',
      ['upyun'],
      expect.objectContaining({ enabledServices: ['upyun'] }),
      expect.any(Function),
      expect.any(Function),
    );
    expect(toastShowConfigMock).toHaveBeenCalledWith('warn', expect.objectContaining({
      summary: '已跳过未确认风险的图床',
    }));
  });

  it('超过 200 张时不会对全部路径调用 get_image_metadata', async () => {
    selectedServicesRef.value = ['jd'];
    configStoreGetMock.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabledServices: ['jd'],
      publicServiceRiskAccepted: true,
      linkOutput: {
        ...DEFAULT_CONFIG.linkOutput!,
        autoCopy: false,
      },
    });
    uploadToMultipleServicesMock.mockImplementation(
      async (
        filePath: string,
        enabledServices: string[],
        _config: unknown,
        _onProgress?: unknown,
        onServiceResult?: (result: any) => void | Promise<void>
      ) => {
        const serviceId = enabledServices[0];
        const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
        const success = {
          serviceId,
          status: 'success' as const,
          result: {
            serviceId,
            fileKey: `${fileName}-key`,
            url: `https://example.com/${fileName}`,
          },
        };
        await onServiceResult?.(success);
        return {
          primaryService: serviceId,
          primaryUrl: success.result.url,
          results: [success],
        };
      }
    );

    const queueManager = createMultiQueueManager();
    const { useUploadManager } = await import('@/composables/upload/useUpload');
    const { handleFilesUpload } = useUploadManager(queueManager as never);
    const filePaths = Array.from(
      { length: MAX_FILES_PER_UPLOAD + 25 },
      (_, index) => `C:/tmp/overflow-${index + 1}.jpg`
    );

    await handleFilesUpload(filePaths);

    expect(invokeMock).toHaveBeenCalledTimes(MAX_FILES_PER_UPLOAD);
    expect(queueManager.addFile).toHaveBeenCalledTimes(MAX_FILES_PER_UPLOAD);
    expect(toastShowConfigMock).toHaveBeenCalledWith('warn', expect.objectContaining({
      summary: '文件数量超限',
      detail: expect.stringContaining('25'),
    }));
  });

  it('shows a partial-success toast when uploads succeed but some services fail', async () => {
    configStoreGetMock.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabledServices: ['jd', 'upyun'],
      linkOutput: {
        ...DEFAULT_CONFIG.linkOutput!,
        autoCopy: true,
      },
    });
    copyLinksMock.mockResolvedValue({ ok: true, copiedCount: 1, format: 'url' });

    const queueManager = createQueueManager();
    const { useUploadManager } = await import('@/composables/upload/useUpload');
    const { handleFilesUpload } = useUploadManager(queueManager as never);

    await handleFilesUpload(['C:/tmp/test.jpg']);

    expect(toastWarnMock).toHaveBeenCalledWith(
      '上传完成，又拍云上传失败',
      '成功的链接已复制。可在首页重试失败的图片。'
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('copies uploaded links in input order even when the second batch finishes first', async () => {
    configStoreGetMock.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabledServices: ['jd'],
      linkOutput: {
        ...DEFAULT_CONFIG.linkOutput!,
        autoCopy: true,
      },
    });
    copyLinksMock.mockResolvedValue({ ok: true, copiedCount: 51, format: 'url' });
    uploadToMultipleServicesMock.mockImplementation(
      async (
        filePath: string,
        _enabledServices: string[],
        _config: unknown,
        _onProgress?: unknown,
        onServiceResult?: (result: any) => void | Promise<void>
      ) => {
        const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
        if (fileName !== 'file-51.jpg') {
          await new Promise(resolve => setTimeout(resolve, 20));
        }

        const success = {
          serviceId: 'jd',
          status: 'success' as const,
          result: {
            serviceId: 'jd',
            fileKey: `${fileName}-key`,
            url: `https://example.com/${fileName}`,
          },
        };

        await onServiceResult?.(success);

        return {
          primaryService: 'jd',
          primaryUrl: success.result.url,
          results: [success],
        };
      }
    );

    const queueManager = createMultiQueueManager();
    const { useUploadManager } = await import('@/composables/upload/useUpload');
    const { handleFilesUpload } = useUploadManager(queueManager as never);
    const filePaths = Array.from(
      { length: 51 },
      (_, index) => `C:/tmp/file-${String(index + 1).padStart(2, '0')}.jpg`
    );

    await handleFilesUpload(filePaths);

    expect(copyLinksMock).toHaveBeenCalledTimes(1);
    const copiedItems = copyLinksMock.mock.calls[0][0];
    expect(copiedItems.map((item: { fileName: string }) => item.fileName)).toEqual(
      filePaths.map(filePath => filePath.split(/[\\/]/).pop())
    );
  });

  it('uploads at most three images at a time', async () => {
    let inFlight = 0;
    let peak = 0;
    uploadToMultipleServicesMock.mockImplementation(async (filePath: string, _s: string[], _c: unknown, _p: unknown, onServiceResult?: (r: any) => void | Promise<void>) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      const success = { serviceId: 'jd', status: 'success' as const, result: { serviceId: 'jd', fileKey: 'k', url: `https://example.com/${filePath}` } };
      await onServiceResult?.(success);
      inFlight -= 1;
      return { primaryService: 'jd', primaryUrl: success.result.url, results: [success] };
    });

    const queueManager = createMultiQueueManager();
    const { useUploadManager } = await import('@/composables/upload/useUpload');
    const { handleFilesUpload } = useUploadManager(queueManager as never);

    await handleFilesUpload(Array.from({ length: 8 }, (_, index) => `C:/tmp/batch-${index}.jpg`));

    expect(peak).toBe(3);
  });

  it('uploads one file to other hosts without touching the 上传到 selection', async () => {
    const queueManager = createMultiQueueManager();
    const { useUploadManager } = await import('@/composables/upload/useUpload');
    const { handleFilesUpload } = useUploadManager(queueManager as never);

    await handleFilesUpload(['C:/tmp/again.jpg'], { services: ['jd'] });

    expect(queueManager.addFile).toHaveBeenCalledWith('C:/tmp/again.jpg', 'again.jpg', ['jd']);
    expect(selectedServicesRef.value).toEqual(['jd', 'upyun']);
  });

  it('reports the copy and stays quiet when the caller shows the result itself', async () => {
    configStoreGetMock.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabledServices: ['jd', 'upyun'],
      publicServiceRiskAccepted: true,
      linkOutput: { ...DEFAULT_CONFIG.linkOutput!, autoCopy: true },
    });
    copyLinksMock.mockResolvedValue({ ok: true, copiedCount: 1, format: 'markdown' });
    const onCopied = vi.fn();
    const queueManager = createQueueManager();
    const { useUploadManager } = await import('@/composables/upload/useUpload');
    const { handleFilesUpload } = useUploadManager(queueManager as never, { onCopied, resultsOnScreen: () => true });

    await handleFilesUpload(['C:/tmp/test.jpg']);

    expect(onCopied).toHaveBeenCalledWith({ ok: true, copiedCount: 1, format: 'markdown' });
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastWarnMock).not.toHaveBeenCalled();
  });

  // HomeScreen H03 / H05：压缩过的图写「1.2 MB → 410 KB」，所以队列项要记下压缩后的大小
  it('records the compressed size on the queue item and uploads the compressed file', async () => {
    configStoreGetMock.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabledServices: ['jd', 'upyun'],
      publicServiceRiskAccepted: true,
      linkOutput: { ...DEFAULT_CONFIG.linkOutput!, autoCopy: false },
      imageCompression: { ...DEFAULT_CONFIG.imageCompression!, enabled: true },
    });
    compressImageBatchMock.mockResolvedValue(new Map([['C:/tmp/big.png', { path: 'C:/tmp/big.compressed.webp', size: 410_000 }]]));
    const queueManager = createMultiQueueManager();
    const { useUploadManager } = await import('@/composables/upload/useUpload');
    const { handleFilesUpload } = useUploadManager(queueManager as never);

    await handleFilesUpload(['C:/tmp/big.png']);

    expect(uploadToMultipleServicesMock.mock.calls[0][0]).toBe('C:/tmp/big.compressed.webp');
    expect(queueManager.getItem('queue-0')).toMatchObject({ filePath: 'C:/tmp/big.png', compressedSize: 410_000 });
  });

  // HomeScreen H06：没网时这几张照样出现在首页、标成失败并写清原因，卡片上能点「重试」；首页不在屏时才弹通知
  it('lists the images as failed with the network reason when the network is down', async () => {
    checkNetworkConnectivityMock.mockResolvedValue(false);
    const queueManager = createMultiQueueManager();
    const { useUploadManager } = await import('@/composables/upload/useUpload');
    let shown = true;
    const { handleFilesUpload } = useUploadManager(queueManager as never, { resultsOnScreen: () => shown });

    await handleFilesUpload(['C:/tmp/a.jpg']);
    const item = queueManager.getItem('queue-0');
    expect(queueManager.addFile).toHaveBeenCalledTimes(1);
    expect(item.serviceProgress.jd).toMatchObject({ status: '✗ 失败', error: '网络连接中断' });
    expect(item.serviceProgress.upyun).toMatchObject({ status: '✗ 失败', error: '网络连接中断' });
    expect(queueManager.markItemFailed).toHaveBeenCalledWith('queue-0', '网络连接中断');
    expect(item.historyId).toEqual(expect.any(String));
    expect(uploadToMultipleServicesMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();

    shown = false;
    await handleFilesUpload(['C:/tmp/b.jpg', 'C:/tmp/c.jpg']);
    expect(toastErrorMock).toHaveBeenCalledWith('2 张上传失败', '网络连接中断，请检查网络后重试', 5000);
  });

  // 一动手图就进队列：联网检测、读尺寸、压缩都算「上传中」，首页焦点卡 / 批量卡当场换成这几张，
  // 不然开着压缩传大照片要干等好几秒（实测 1200 万像素约 2.4 秒、10 张约 10.5 秒）
  it('queues the images before checking the network, reading sizes or compressing', async () => {
    configStoreGetMock.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabledServices: ['jd', 'upyun'],
      publicServiceRiskAccepted: true,
      linkOutput: { ...DEFAULT_CONFIG.linkOutput!, autoCopy: false },
      imageCompression: { ...DEFAULT_CONFIG.imageCompression!, enabled: true },
    });
    let networkUp!: (up: boolean) => void;
    checkNetworkConnectivityMock.mockReturnValue(new Promise<boolean>((resolve) => { networkUp = resolve; }));
    let compressed!: (files: Map<string, { path: string; size: number }>) => void;
    compressImageBatchMock.mockReturnValue(new Promise((resolve) => { compressed = resolve; }));
    const queueManager = createMultiQueueManager();
    const { useUploadManager } = await import('@/composables/upload/useUpload');
    const { handleFilesUpload } = useUploadManager(queueManager as never);

    const done = handleFilesUpload(['C:/tmp/a.jpg', 'C:/tmp/b.jpg']);
    await vi.waitFor(() => expect(queueManager.addFile).toHaveBeenCalledTimes(2));
    expect(fetchMetadataBatchMock).not.toHaveBeenCalled();
    expect(uploadToMultipleServicesMock).not.toHaveBeenCalled();

    networkUp(true);
    await vi.waitFor(() => expect(compressImageBatchMock).toHaveBeenCalled());
    expect(uploadToMultipleServicesMock).not.toHaveBeenCalled();
    compressed(new Map([['C:/tmp/a.jpg', { path: 'C:/tmp/a.compressed.jpg', size: 1_000 }]]));
    await done;

    expect(queueManager.addFile).toHaveBeenCalledTimes(2);
    expect(uploadToMultipleServicesMock.mock.calls.map((call) => call[0])).toEqual(['C:/tmp/a.compressed.jpg', 'C:/tmp/b.jpg']);
    expect(queueManager.getItem('queue-0')).toMatchObject({ filePath: 'C:/tmp/a.jpg', compressedSize: 1_000 });
  });

  // 进了队列却因为准备时出了意外一直没开始传：标成失败、能重试，别让焦点卡一直「上传中」
  it('fails the queued images that never started when preparing them goes wrong', async () => {
    configStoreGetMock.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabledServices: ['jd', 'upyun'],
      publicServiceRiskAccepted: true,
      linkOutput: { ...DEFAULT_CONFIG.linkOutput!, autoCopy: false },
      imageCompression: { ...DEFAULT_CONFIG.imageCompression!, enabled: true },
    });
    compressImageBatchMock.mockResolvedValue(null);
    const queueManager = createMultiQueueManager();
    const { useUploadManager } = await import('@/composables/upload/useUpload');
    const { handleFilesUpload } = useUploadManager(queueManager as never, { resultsOnScreen: () => false });

    await handleFilesUpload(['C:/tmp/a.jpg']);

    const item = queueManager.getItem('queue-0');
    expect(queueManager.markItemFailed).toHaveBeenCalledWith('queue-0', '准备上传时出错，请重试');
    expect(item.serviceProgress.jd).toMatchObject({ status: '✗ 失败', error: '准备上传时出错，请重试' });
    expect(item.historyId).toEqual(expect.any(String));
    expect(toastErrorMock).toHaveBeenCalledWith('a.jpg 上传失败', '准备上传时出错，请重试', 5000);
  });

  // 一张图失败只报一次：首页在屏时不报（卡片上画着），不在屏时只有整次上传的那条汇总，写原因 + 处理办法
  it('reports a failed image once, with its reason, only while the caller does not show it', async () => {
    const allFailed = new Error('所有图床上传均失败：\n  - jd: 京东上传失败: 请求超时\n\n请检查网络连接和服务配置');
    const { useUploadManager } = await import('@/composables/upload/useUpload');
    let shown = true;
    const { handleFilesUpload } = useUploadManager(createQueueManager() as never, { resultsOnScreen: () => shown });

    uploadToMultipleServicesMock.mockRejectedValueOnce(allFailed);
    await handleFilesUpload(['C:/tmp/test.jpg']);
    expect(toastShowConfigMock).not.toHaveBeenCalledWith('error', expect.anything());
    expect(toastErrorMock).not.toHaveBeenCalled();

    shown = false;
    uploadToMultipleServicesMock.mockRejectedValueOnce(allFailed);
    await handleFilesUpload(['C:/tmp/test.jpg']);
    expect(toastShowConfigMock).not.toHaveBeenCalledWith('error', expect.anything());
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith('test.jpg 上传失败', '网络超时，请检查网络后重试');
  });
});
