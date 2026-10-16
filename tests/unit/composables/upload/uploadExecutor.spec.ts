import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CopyLinkItem } from '@/composables/useCopyLink';
import { processUploadQueue } from '@/composables/upload/UploadExecutor';
import { DEFAULT_CONFIG, DEFAULT_LINK_PREFIXES, type UserConfig } from '@/config/types';
import { formatLinkWithConfig } from '@/composables/useCopyLink';
import { generateThumbnailUrl } from '@/composables/image/useThumbCache';

const uploadToMultipleServicesMock = vi.hoisted(() => vi.fn());

vi.mock('@/core/MultiServiceUploader', () => ({
  MultiServiceUploader: class {
    uploadToMultipleServices = uploadToMultipleServicesMock;
  },
}));

vi.mock('@/composables/service/useServiceHealth', () => ({
  useServiceHealth: () => ({ markUploadError: vi.fn() }),
}));

vi.mock('@/composables/service/useServiceAvailability', () => ({
  useServiceAvailability: () => ({ markServiceAvailable: vi.fn(async () => undefined) }),
}));

vi.mock('@/utils/logger', () => ({
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
        reconcileHistoryPrimary: vi.fn(async () => true),
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

  it('stores the generated historyId on the queue item and reuses it for history saves', async () => {
    const queueManager = createQueueManager();
    queueManager.seed('q-history', 'history.jpg');
    const saveHistoryItemImmediate = vi.fn<(
      filePath: string,
      firstResult: unknown,
      historyId: string
    ) => Promise<void>>(async (
      _filePath: string,
      _firstResult: unknown,
      _historyId: string
    ) => undefined);

    await processUploadQueue(
      [
        {
          itemId: 'q-history',
          filePath: 'C:/tmp/history.jpg',
          uploadFilePath: 'C:/tmp/history.jpg',
          fileName: 'history.jpg',
        },
      ],
      { services: { jd: {} } } as any,
      ['jd'],
      1,
      {
        queueManager: queueManager as any,
        saveHistoryItemImmediate,
        addResultToHistoryItem: vi.fn(async () => true),
        reconcileHistoryPrimary: vi.fn(async () => true),
        saveHistoryItem: vi.fn(async () => undefined),
        toast: { showConfig: vi.fn() } as any,
      },
    );

    const historyId = saveHistoryItemImmediate.mock.calls[0]?.[2];
    expect(historyId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(queueManager.updateItem).toHaveBeenCalledWith('q-history', { historyId });
  });

  it('reconciles history before completing the queue when a later callback created the live record', async () => {
    const queueManager = createQueueManager();
    queueManager.seed('q-primary', 'primary.jpg', ['jd', 'upyun']);
    const reconcileHistoryPrimary = vi.fn(async () => true);

    uploadToMultipleServicesMock.mockImplementationOnce(async (
      _filePath: string,
      _services: string[],
      _config: unknown,
      _onProgress?: unknown,
      onServiceResult?: (result: unknown) => Promise<void> | void,
    ) => {
      await onServiceResult?.({
        serviceId: 'upyun',
        status: 'success',
        result: { serviceId: 'upyun', fileKey: 'upyun-key', url: 'https://img.example/upyun.jpg' },
      });
      await onServiceResult?.({
        serviceId: 'jd',
        status: 'success',
        result: { serviceId: 'jd', fileKey: 'jd-key', url: 'https://img.example/jd.jpg' },
      });
      return {
        primaryService: 'jd',
        primaryUrl: 'https://img.example/jd.jpg',
        results: [],
      };
    });

    await processUploadQueue(
      [{ itemId: 'q-primary', filePath: 'C:/tmp/primary.jpg', uploadFilePath: 'C:/tmp/primary.jpg', fileName: 'primary.jpg' }],
      { services: { jd: {}, upyun: {} } } as any,
      ['jd', 'upyun'],
      1,
      {
        queueManager: queueManager as any,
        saveHistoryItemImmediate: vi.fn(async () => undefined),
        addResultToHistoryItem: vi.fn(async () => true),
        reconcileHistoryPrimary,
        saveHistoryItem: vi.fn(async () => undefined),
        toast: { showConfig: vi.fn() } as any,
      },
    );

    const historyId = queueManager.updateItem.mock.calls.find(([, update]) => update.historyId)?.[1].historyId;
    expect(reconcileHistoryPrimary).toHaveBeenCalledWith(historyId, 'jd', 'https://img.example/jd.jpg');
    const reconcileOrder = reconcileHistoryPrimary.mock.invocationCallOrder[0];
    const completeOrder = queueManager.markItemComplete.mock.invocationCallOrder[0];
    expect(reconcileOrder).toBeLessThan(completeOrder);
    expect(queueManager.markItemComplete).toHaveBeenCalledWith('q-primary', 'https://img.example/jd.jpg');
  });

  it('copies the link of the first host to finish, not the first one in config order', async () => {
    // 有状态的队列：updateItem 真的写进去，pickPrimaryFromQueue 才看得到各图床的完成情况
    const queueManager = createQueueManager();
    queueManager.seed('q-first', 'first.jpg', ['jd', 'upyun']);
    queueManager.updateItem.mockImplementation((id: string, update: any) => {
      const item = queueManager.getItem(id);
      Object.assign(item, { ...update, serviceProgress: { ...item.serviceProgress, ...(update.serviceProgress ?? {}) } });
    });

    uploadToMultipleServicesMock.mockImplementationOnce(async (
      _filePath: string,
      _services: string[],
      _config: unknown,
      _onProgress?: unknown,
      onServiceResult?: (result: unknown) => Promise<void> | void,
    ) => {
      await onServiceResult?.({
        serviceId: 'upyun',
        status: 'success',
        result: { serviceId: 'upyun', fileKey: 'upyun-key', url: 'https://img.example/upyun.jpg' },
      });
      await new Promise(resolve => setTimeout(resolve, 5));
      await onServiceResult?.({
        serviceId: 'jd',
        status: 'success',
        result: { serviceId: 'jd', fileKey: 'jd-key', url: 'https://img.example/jd.jpg' },
      });
      return { primaryService: 'upyun', primaryUrl: 'https://img.example/upyun.jpg', results: [] };
    });

    const links = await processUploadQueue(
      [{ itemId: 'q-first', filePath: 'C:/tmp/first.jpg', uploadFilePath: 'C:/tmp/first.jpg', fileName: 'first.jpg' }],
      { services: { jd: {}, upyun: {} } } as any,
      ['jd', 'upyun'],
      1,
      {
        queueManager: queueManager as any,
        saveHistoryItemImmediate: vi.fn(async () => undefined),
        addResultToHistoryItem: vi.fn(async () => true),
        reconcileHistoryPrimary: vi.fn(async () => true),
        saveHistoryItem: vi.fn(async () => undefined),
        toast: { showConfig: vi.fn() } as any,
      },
    );

    expect(links[0]).toMatchObject({ serviceId: 'upyun', url: 'https://img.example/upyun.jpg' });
    expect(queueManager.markItemComplete).toHaveBeenCalledWith('q-first', 'https://img.example/upyun.jpg');
  });

  describe('onPrimaryReady', () => {
    function statefulQueue(id: string, services: string[]) {
      const queueManager = createQueueManager();
      queueManager.seed(id, `${id}.jpg`, services);
      queueManager.updateItem.mockImplementation((itemId: string, update: any) => {
        const item = queueManager.getItem(itemId);
        Object.assign(item, { ...update, serviceProgress: { ...item.serviceProgress, ...(update.serviceProgress ?? {}) } });
      });
      return queueManager;
    }

    function ctxFor(queueManager: ReturnType<typeof createQueueManager>, onPrimaryReady: (i: number, link: CopyLinkItem) => void) {
      return {
        queueManager: queueManager as any,
        saveHistoryItemImmediate: vi.fn(async () => undefined),
        addResultToHistoryItem: vi.fn(async () => true),
        reconcileHistoryPrimary: vi.fn(async () => true),
        saveHistoryItem: vi.fn(async () => undefined),
        toast: { showConfig: vi.fn() } as any,
        onPrimaryReady,
      };
    }

    const success = (serviceId: string) => ({ serviceId, status: 'success', result: { serviceId, fileKey: `${serviceId}-k`, url: `https://img.example/${serviceId}.jpg` } });

    it('waits for the pinned host instead of announcing the first one to finish', async () => {
      const queueManager = statefulQueue('q-pin', ['jd', 'upyun']);
      const announced: string[] = [];
      uploadToMultipleServicesMock.mockImplementationOnce(async (_f: string, _s: string[], _c: unknown, _p: unknown, onServiceResult?: (r: unknown) => Promise<void> | void) => {
        await onServiceResult?.(success('jd'));
        expect(announced).toEqual([]);
        await onServiceResult?.(success('upyun'));
        return { primaryService: 'upyun', primaryUrl: 'https://img.example/upyun.jpg', results: [] };
      });

      await processUploadQueue(
        [{ itemId: 'q-pin', filePath: 'C:/tmp/q-pin.jpg', uploadFilePath: 'C:/tmp/q-pin.jpg', fileName: 'q-pin.jpg' }],
        { services: { jd: {}, upyun: {} }, linkOutput: { defaultFormat: 'url', customTemplate: '', autoCopy: true, copyFromService: 'upyun' } } as any,
        ['jd', 'upyun'], 1, ctxFor(queueManager, (_i, link) => { announced.push(link.serviceId!); }),
      );

      expect(announced).toEqual(['upyun']);
    });

    it('falls back to the first finished host as soon as the pinned one fails', async () => {
      const queueManager = statefulQueue('q-fallback', ['jd', 'upyun']);
      const announced: string[] = [];
      uploadToMultipleServicesMock.mockImplementationOnce(async (_f: string, _s: string[], _c: unknown, _p: unknown, onServiceResult?: (r: unknown) => Promise<void> | void) => {
        await onServiceResult?.(success('jd'));
        await onServiceResult?.({ serviceId: 'upyun', status: 'failed', error: '超时' });
        expect(announced).toEqual(['jd']);
        return { primaryService: 'jd', primaryUrl: 'https://img.example/jd.jpg', results: [] };
      });

      await processUploadQueue(
        [{ itemId: 'q-fallback', filePath: 'C:/tmp/q-fallback.jpg', uploadFilePath: 'C:/tmp/q-fallback.jpg', fileName: 'q-fallback.jpg' }],
        { services: { jd: {}, upyun: {} }, linkOutput: { defaultFormat: 'url', customTemplate: '', autoCopy: true, copyFromService: 'upyun' } } as any,
        ['jd', 'upyun'], 1, ctxFor(queueManager, (_i, link) => { announced.push(link.serviceId!); }),
      );

      expect(announced).toEqual(['jd']);
    });
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
        reconcileHistoryPrimary: vi.fn(async () => true),
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
        reconcileHistoryPrimary: vi.fn(async () => true),
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
        reconcileHistoryPrimary: vi.fn(async () => true),
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
