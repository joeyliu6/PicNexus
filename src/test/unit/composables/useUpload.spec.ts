import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_CONFIG } from '../../../config/types';
import { MAX_FILES_PER_UPLOAD } from '../../../composables/upload/FileValidator';

const {
  configStoreGetMock,
  fetchMetadataBatchMock,
  saveHistoryItemMock,
  saveHistoryItemImmediateMock,
  addResultToHistoryItemMock,
  copyLinksMock,
  checkNetworkConnectivityMock,
  uploadToMultipleServicesMock,
  toastSuccessMock,
  toastWarnMock,
  toastErrorMock,
  toastInfoMock,
  toastShowConfigMock,
} = vi.hoisted(() => ({
  configStoreGetMock: vi.fn(),
  fetchMetadataBatchMock: vi.fn(),
  saveHistoryItemMock: vi.fn(),
  saveHistoryItemImmediateMock: vi.fn(),
  addResultToHistoryItemMock: vi.fn(),
  copyLinksMock: vi.fn(),
  checkNetworkConnectivityMock: vi.fn(),
  uploadToMultipleServicesMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastWarnMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
  toastShowConfigMock: vi.fn(),
}));

const selectedServicesRef = ref(['jd', 'upyun']);
const availableServicesRef = ref(['jd', 'upyun']);
const serviceConfigStatusRef = ref({});
const activePrefixRef = ref<string | null>(null);
const invokeMock = vi.mocked(invoke);

vi.mock('../../../store/instances', () => ({
  configStore: {
    get: configStoreGetMock,
  },
}));

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    warn: toastWarnMock,
    error: toastErrorMock,
    info: toastInfoMock,
    showConfig: toastShowConfigMock,
  }),
}));

vi.mock('../../../composables/useCopyLink', () => ({
  useCopyLink: () => ({
    copyLinks: copyLinksMock,
  }),
}));

vi.mock('../../../composables/useServiceSelector', () => ({
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

vi.mock('../../../composables/useServiceHealth', () => ({
  useServiceHealth: () => ({
    markUploadError: vi.fn(),
  }),
}));

vi.mock('../../../composables/useHistorySaver', () => ({
  useHistorySaver: () => ({
    saveHistoryItem: saveHistoryItemMock,
    saveHistoryItemImmediate: saveHistoryItemImmediateMock,
    addResultToHistoryItem: addResultToHistoryItemMock,
  }),
}));

vi.mock('../../../composables/useImageMetadata', () => ({
  fetchMetadataBatch: fetchMetadataBatchMock,
}));

vi.mock('../../../utils/network', () => ({
  checkNetworkConnectivity: checkNetworkConnectivityMock,
}));

vi.mock('../../../core/MultiServiceUploader', () => ({
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
    markItemComplete: vi.fn(),
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
    markItemComplete: vi.fn(),
    markItemFailed: vi.fn(),
  };
}

describe('useUploadManager', () => {
  beforeEach(() => {
    selectedServicesRef.value = ['jd', 'upyun'];
    availableServicesRef.value = ['jd', 'upyun'];
    serviceConfigStatusRef.value = {};
    activePrefixRef.value = null;
    configStoreGetMock.mockReset().mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabledServices: ['jd', 'upyun'],
      linkOutput: {
        ...DEFAULT_CONFIG.linkOutput!,
        autoCopy: false,
      },
    });
    fetchMetadataBatchMock.mockReset().mockResolvedValue(undefined);
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
    const { useUploadManager } = await import('../../../composables/useUpload');
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

  it('切换图床后立刻上传使用当前界面选择快照', async () => {
    selectedServicesRef.value = ['jd'];
    availableServicesRef.value = ['jd', 'upyun'];
    configStoreGetMock.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabledServices: ['upyun'],
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
    const { useUploadManager } = await import('../../../composables/useUpload');
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

  it('超过 200 张时不会对全部路径调用 get_image_metadata', async () => {
    selectedServicesRef.value = ['jd'];
    configStoreGetMock.mockResolvedValue({
      ...DEFAULT_CONFIG,
      enabledServices: ['jd'],
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
    const { useUploadManager } = await import('../../../composables/useUpload');
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
    const { useUploadManager } = await import('../../../composables/useUpload');
    const { handleFilesUpload } = useUploadManager(queueManager as never);

    await handleFilesUpload(['C:/tmp/test.jpg']);

    expect(toastWarnMock).toHaveBeenCalledWith(
      '上传完成，又拍云上传失败',
      '成功的链接已复制。可在队列中对失败项重试。'
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
    const { useUploadManager } = await import('../../../composables/useUpload');
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
});
