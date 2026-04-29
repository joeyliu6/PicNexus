import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CopyLinkItem } from '../../../../composables/useCopyLink';
import { processUploadQueue } from '../../../../composables/upload/UploadExecutor';
import { DEFAULT_CONFIG, DEFAULT_LINK_PREFIXES, type UserConfig } from '../../../../config/types';
import { formatLinkWithConfig } from '../../../../composables/useCopyLink';
import { generateThumbnailUrl } from '../../../../composables/useThumbCache';

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
    seed(id: string, fileName: string, enabledServices = ['jd']) {
      items.set(id, {
        id,
        fileName,
        filePath: `C:/tmp/${fileName}`,
        enabledServices,
        serviceProgress: Object.fromEntries(
          enabledServices.map(serviceId => [
            serviceId,
            { serviceId, progress: 0, status: '等待中...' },
          ]),
        ),
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

  it('keeps weibo queue links raw and lets copy/thumb helpers apply the default template once', async () => {
    const queueManager = createQueueManager();
    queueManager.seed('q-weibo', 'weibo.jpg', ['weibo']);
    const rawUrl = 'https://tvax1.sinaimg.cn/large/pid123.jpg';
    const config: UserConfig = {
      ...DEFAULT_CONFIG,
      linkOutput: {
        ...DEFAULT_CONFIG.linkOutput!,
        defaultFormat: 'url',
      },
      linkPrefixConfig: {
        enabled: true,
        selectedIndex: 0,
        prefixList: [DEFAULT_LINK_PREFIXES[0]],
      },
    };

    uploadToMultipleServicesMock.mockImplementationOnce(async (
      _filePath: string,
      _enabledServices: string[],
      _config: unknown,
      _onProgress?: unknown,
      onServiceResult?: (result: unknown) => Promise<void> | void,
    ) => {
      const singleResult = {
        serviceId: 'weibo',
        status: 'success' as const,
        result: {
          serviceId: 'weibo',
          fileKey: 'pid123',
          url: rawUrl,
        },
      };
      await onServiceResult?.(singleResult);
      return {
        primaryService: 'weibo',
        primaryUrl: rawUrl,
        results: [singleResult],
      };
    });

    await processUploadQueue(
      [
        {
          itemId: 'q-weibo',
          filePath: 'C:/tmp/weibo.jpg',
          uploadFilePath: 'C:/tmp/weibo.jpg',
          fileName: 'weibo.jpg',
        },
      ],
      config,
      ['weibo'],
      1,
      {
        queueManager: queueManager as any,
        saveHistoryItemImmediate: vi.fn(async () => undefined),
        addResultToHistoryItem: vi.fn(async () => true),
        saveHistoryItem: vi.fn(async () => undefined),
        toast: { showConfig: vi.fn() } as any,
      },
    );

    const serviceUpdate = queueManager.updateItem.mock.calls
      .map(([, updates]) => updates.serviceProgress?.weibo)
      .find(Boolean);
    expect(serviceUpdate?.link).toBe(rawUrl);
    expect(serviceUpdate?.metadata?.pid).toBe('pid123');
    expect(queueManager.markItemComplete).toHaveBeenCalledWith('q-weibo', rawUrl);

    const copied = formatLinkWithConfig({
      url: serviceUpdate!.link!,
      fileName: 'weibo.jpg',
      serviceId: 'weibo',
    }, config);
    expect(copied).not.toContain('{url_encoded}');
    expect(copied.match(/img01\.sogoucdn\.com/g) ?? []).toHaveLength(1);
    expect(new URL(copied).searchParams.get('url')).toBe(rawUrl);

    const thumb = generateThumbnailUrl('weibo', serviceUpdate!.link!, 'pid123', config);
    expect(thumb).not.toContain('{url_encoded}');
    expect(thumb.match(/img01\.sogoucdn\.com/g) ?? []).toHaveLength(1);
    expect(new URL(thumb).searchParams.get('url')).toBe('https://tvax1.sinaimg.cn/thumb150/pid123.jpg');
  });

  it('skips selected services that do not support the current file format', async () => {
    const queueManager = createQueueManager();
    queueManager.seed('q-svg', 'icon.svg', ['jd', 'github']);
    const githubUrl = 'https://raw.githubusercontent.com/owner/repo/icon.svg';

    uploadToMultipleServicesMock.mockImplementationOnce(async (
      _filePath: string,
      enabledServices: string[],
      _config: unknown,
      _onProgress?: unknown,
      onServiceResult?: (result: unknown) => Promise<void> | void,
    ) => {
      expect(enabledServices).toEqual(['github']);
      const singleResult = {
        serviceId: 'github',
        status: 'success' as const,
        result: {
          serviceId: 'github',
          fileKey: 'icon.svg',
          url: githubUrl,
        },
      };
      await onServiceResult?.(singleResult);
      return {
        primaryService: 'github',
        primaryUrl: githubUrl,
        results: [singleResult],
      };
    });

    await processUploadQueue(
      [
        {
          itemId: 'q-svg',
          filePath: 'C:/tmp/icon.svg',
          uploadFilePath: 'C:/tmp/icon.svg',
          fileName: 'icon.svg',
        },
      ],
      { services: { github: { token: 't', owner: 'o', repo: 'r', branch: 'main', path: '' } } } as any,
      ['jd', 'github'],
      1,
      {
        queueManager: queueManager as any,
        saveHistoryItemImmediate: vi.fn(async () => undefined),
        addResultToHistoryItem: vi.fn(async () => true),
        saveHistoryItem: vi.fn(async () => undefined),
        toast: { showConfig: vi.fn() } as any,
      },
    );

    const skippedJd = queueManager.updateItem.mock.calls
      .map(([, updates]) => updates.serviceProgress?.jd)
      .find((update) => update?.status?.includes('不支持 .svg'));

    expect(skippedJd?.status).toBe('已跳过（不支持 .svg）');
    expect(uploadToMultipleServicesMock).toHaveBeenCalledWith(
      'C:/tmp/icon.svg',
      ['github'],
      expect.anything(),
      expect.any(Function),
      expect.any(Function),
    );
    expect(queueManager.markItemComplete).toHaveBeenCalledWith('q-svg', githubUrl);
  });

  it('fails before upload when no selected service supports the file format', async () => {
    const queueManager = createQueueManager();
    queueManager.seed('q-svg', 'icon.svg', ['jd']);

    await processUploadQueue(
      [
        {
          itemId: 'q-svg',
          filePath: 'C:/tmp/icon.svg',
          uploadFilePath: 'C:/tmp/icon.svg',
          fileName: 'icon.svg',
        },
      ],
      { services: { jd: {} } } as any,
      ['jd'],
      1,
      {
        queueManager: queueManager as any,
        saveHistoryItemImmediate: vi.fn(async () => undefined),
        addResultToHistoryItem: vi.fn(async () => true),
        saveHistoryItem: vi.fn(async () => undefined),
        toast: { showConfig: vi.fn() } as any,
      },
    );

    expect(uploadToMultipleServicesMock).not.toHaveBeenCalled();
    expect(queueManager.markItemFailed).toHaveBeenCalledWith(
      'q-svg',
      expect.stringContaining('不支持 .svg 格式'),
    );
  });
});
