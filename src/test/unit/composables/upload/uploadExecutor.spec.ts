import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CopyLinkItem } from '../../../../composables/useCopyLink';
import { processUploadQueue } from '../../../../composables/upload/UploadExecutor';

const uploadToMultipleServicesMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../core/MultiServiceUploader', () => ({
  MultiServiceUploader: class {
    uploadToMultipleServices = uploadToMultipleServicesMock;
  },
}));

vi.mock('../../../../composables/useServiceHealth', () => ({
  useServiceHealth: () => ({ markUploadError: vi.fn() }),
}));

vi.mock('../../../../composables/useServiceAvailability', () => ({
  useServiceAvailability: () => ({ markServiceAvailable: vi.fn(async () => undefined) }),
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function createQueueManager() {
  const items = new Map<string, any>();

  return {
    seed(id: string, fileName: string) {
      items.set(id, {
        id,
        fileName,
        filePath: `C:/tmp/${fileName}`,
        enabledServices: ['jd'],
        serviceProgress: {
          jd: { serviceId: 'jd', progress: 0, status: '等待中...' },
        },
        status: 'pending',
      });
    },
    getItem: vi.fn((id: string) => items.get(id)),
    updateItem: vi.fn(),
    updateServiceProgress: vi.fn(),
    markItemComplete: vi.fn(),
    markItemFailed: vi.fn(),
  };
}

describe('processUploadQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadToMultipleServicesMock.mockImplementation(
      async (
        filePath: string,
        _enabledServices: string[],
        _config: unknown,
        _onProgress?: unknown,
        onServiceResult?: (result: unknown) => Promise<void> | void,
      ) => {
        if (filePath.endsWith('a.jpg')) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }

        const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
        const singleResult = {
          serviceId: 'jd',
          status: 'success' as const,
          result: {
            serviceId: 'jd',
            fileKey: `${fileName}-key`,
            url: `https://img.example/${fileName}`,
          },
        };

        await onServiceResult?.(singleResult);

        return {
          primaryService: 'jd',
          primaryUrl: singleResult.result.url,
          results: [singleResult],
        };
      },
    );
  });

  it('keeps collected links in queue order even when later files finish first', async () => {
    const queueManager = createQueueManager();
    queueManager.seed('q-a', 'a.jpg');
    queueManager.seed('q-b', 'b.jpg');
    const collectedLinks: CopyLinkItem[] = [];

    await processUploadQueue(
      [
        { itemId: 'q-a', filePath: 'C:/tmp/a.jpg', uploadFilePath: 'C:/tmp/a.jpg', fileName: 'a.jpg' },
        { itemId: 'q-b', filePath: 'C:/tmp/b.jpg', uploadFilePath: 'C:/tmp/b.jpg', fileName: 'b.jpg' },
      ],
      { services: { jd: {} } } as any,
      ['jd'],
      2,
      {
        queueManager: queueManager as any,
        saveHistoryItemImmediate: vi.fn(async () => undefined),
        addResultToHistoryItem: vi.fn(async () => true),
        saveHistoryItem: vi.fn(async () => undefined),
        weiboPrefix: null,
        toast: { showConfig: vi.fn() } as any,
      },
      collectedLinks,
    );

    expect(collectedLinks.map(item => item.fileName)).toEqual(['a.jpg', 'b.jpg']);
    expect(collectedLinks.map(item => item.url)).toEqual([
      'https://img.example/a.jpg',
      'https://img.example/b.jpg',
    ]);
  });
});
