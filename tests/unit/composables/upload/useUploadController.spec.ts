import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { DEFAULT_CONFIG } from '@/config/types';
import type { QueueItem } from '@/core/UploadQueue';
import type { UploadRequestOptions } from '@/composables/upload/useUpload';

const m = vi.hoisted(() => ({
  handleFilesUpload: vi.fn(),
  selectFiles: vi.fn(),
  toggleServiceSelection: vi.fn(),
  loadServiceButtonStates: vi.fn(),
  setupConfigListener: vi.fn(),
  pasteAndUpload: vi.fn(),
  downloadAndUpload: vi.fn(),
  saveConfig: vi.fn(),
  ensureAccepted: vi.fn(),
  cookieLogin: vi.fn(),
  cookieInstall: vi.fn(),
  retryAllFailed: vi.fn(),
  retrySingleService: vi.fn(),
  retryAll: vi.fn(),
  copyLinks: vi.fn(),
  toastError: vi.fn(),
  retryOptions: null as null | { toast: { error: (title: string, message: string) => void } },
  listeners: {} as Record<string, (event: { payload: unknown }) => void>,
  fresh: {} as Record<string, unknown>,
  managerOptions: null as null | { resultsOnScreen?: () => boolean },
  available: ['jd', 'weibo', 'webdav:nas'],
  selected: ['jd'],
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    m.listeners[name] = handler;
    return vi.fn();
  }),
}));

vi.mock('@/core/UploadQueue', () => ({
  UploadQueueManager: class {},
}));

vi.mock('@/composables/upload/useUpload', () => ({
  useUploadManager: (_queue: unknown, options: typeof m.managerOptions) => {
    m.managerOptions = options;
    return {
      handleFilesUpload: m.handleFilesUpload,
      selectFiles: m.selectFiles,
      toggleServiceSelection: m.toggleServiceSelection,
      loadServiceButtonStates: m.loadServiceButtonStates,
      setupConfigListener: m.setupConfigListener,
      saveHistoryItem: vi.fn(),
      availableServices: ref(m.available),
      isServiceAvailable: ref((id: string) => id !== 'weibo'),
      isServiceSelected: ref((id: string) => m.selected.includes(id)),
    };
  },
}));

vi.mock('@/composables/upload/useClipboardImage', () => ({ useClipboardImage: () => ({ isProcessing: ref(false), pasteAndUpload: m.pasteAndUpload }) }));
vi.mock('@/composables/upload/useUrlDownload', () => ({ useUrlDownload: () => ({ isDownloading: ref(false), downloadAndUpload: m.downloadAndUpload }) }));
vi.mock('@/services/RetryService', () => ({
  RetryService: class {
    constructor(options: typeof m.retryOptions) { m.retryOptions = options; }
    retryAllFailed = m.retryAllFailed;
    retrySingleService = m.retrySingleService;
    retryAll = m.retryAll;
  },
}));
vi.mock('@/composables/useConfig', () => ({ useConfigManager: () => ({ saveConfig: m.saveConfig }) }));
vi.mock('@/composables/usePublicRiskConfirm', () => ({ usePublicRiskConfirm: () => ({ ensureAccepted: m.ensureAccepted }) }));
vi.mock('@/composables/useCookieLogin', () => ({ useCookieLogin: () => ({ login: m.cookieLogin, install: m.cookieInstall }) }));
vi.mock('@/composables/service/useServiceHealth', () => ({
  useServiceHealth: () => ({
    healthMap: ref({ jd: { status: 'verified', lastError: null }, 'webdav:nas': { status: 'error', lastError: '网络连接异常，请稍后重试' } }),
    loadHealthStatus: vi.fn(),
    evaluateConfig: vi.fn(),
  }),
}));
vi.mock('@/store/instances', () => ({ configStore: {}, readFreshConfig: vi.fn(async () => m.fresh) }));
vi.mock('@/composables/useCopyLink', () => ({ useCopyLink: () => ({ copyLinks: m.copyLinks }) }));
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: m.toastError, warn: vi.fn(), info: vi.fn(), showConfig: vi.fn() }) }));

import { __resetUploadControllerForTests, useUploadController } from '@/composables/upload/useUploadController';
import { useQueueState } from '@/composables/upload/useQueueState';

describe('useUploadController', () => {
  beforeEach(() => {
    __resetUploadControllerForTests();
    useQueueState().clearQueue();
    Object.values(m).forEach((value) => { if (typeof value === 'function' && 'mockReset' in value) (value as ReturnType<typeof vi.fn>).mockReset(); });
    m.listeners = {};
    m.fresh = {
      ...DEFAULT_CONFIG,
      webdav_profiles: [{ id: 'nas', name: '家里 NAS' }],
      imageCompression: { ...DEFAULT_CONFIG.imageCompression!, enabled: false, activePresetId: 'default' },
    };
    m.setupConfigListener.mockResolvedValue(vi.fn());
    m.cookieInstall.mockResolvedValue(vi.fn());
    m.ensureAccepted.mockResolvedValue(true);
    m.copyLinks.mockResolvedValue({ ok: true, copiedCount: 1, format: 'url' });
  });

  it('lists only added and configured hosts, with names and the reason for a warning', () => {
    const upload = useUploadController();
    const hosts = upload.hosts.value;
    expect(hosts.map((h) => h.id)).toEqual(['jd', 'webdav:nas']);
    expect(hosts[0]).toMatchObject({ selected: true, warning: null });
    expect(hosts[1]).toMatchObject({ selected: false, warning: '网络连接异常，请稍后重试', cookieLogin: false });
  });

  it('groups the items of one upload into a session and drops sessions that added nothing', async () => {
    const upload = useUploadController();
    m.handleFilesUpload.mockImplementationOnce(async (_paths: string[], request: UploadRequestOptions) => {
      request.onQueued?.(['q-1', 'q-2']);
      request.onCopied?.({ ok: true, copiedCount: 2, format: 'markdown' });
    });
    await upload.uploadFiles(['C:/a.png', 'C:/b.png']);
    expect(upload.sessions).toHaveLength(1);
    expect(upload.sessions[0]).toMatchObject({ itemIds: ['q-1', 'q-2'], finished: true, copied: { count: 2, format: 'markdown' } });

    m.handleFilesUpload.mockResolvedValueOnce(undefined);
    await upload.uploadFiles(['C:/not-an-image.zip']);
    expect(upload.sessions).toHaveLength(1);
  });

  // 两次上传同时进行、先开始的那次晚进队列：图记在它自己那一次里，不跑到后开始的那次
  it('keeps the pictures of two overlapping uploads in their own sessions', async () => {
    const upload = useUploadController();
    let queueFirst!: () => void;
    m.handleFilesUpload
      .mockImplementationOnce((_paths: string[], request: UploadRequestOptions) => new Promise<void>((resolve) => {
        queueFirst = () => { request.onQueued?.(['first']); resolve(); };
      }))
      .mockImplementationOnce(async (_paths: string[], request: UploadRequestOptions) => { request.onQueued?.(['second']); });

    const first = upload.uploadFiles(['C:/first.png']);
    await upload.uploadFiles(['C:/second.png']);
    queueFirst();
    await first;

    expect(upload.sessions.map((session) => session.itemIds)).toEqual([['second'], ['first']]);
  });

  it('keeps the summary toast quiet only while the home page is on screen', () => {
    const upload = useUploadController();
    let onHome = true;
    upload.setHomeVisible(() => onHome);
    expect(m.managerOptions?.resultsOnScreen?.()).toBe(true);
    onHome = false;
    expect(m.managerOptions?.resultsOnScreen?.()).toBe(false);
  });

  it('shows the faster-way hint only after picking files from the home button', async () => {
    const upload = useUploadController();
    m.selectFiles.mockResolvedValue(['C:/tray.png']);

    await upload.pickAndUpload({ showHint: false });
    expect(m.handleFilesUpload).toHaveBeenCalledWith(['C:/tray.png'], expect.objectContaining({ onQueued: expect.any(Function) }));
    expect(upload.showFastUploadHint.value).toBe(false);

    await upload.pickAndUpload();
    expect(upload.showFastUploadHint.value).toBe(true);
  });

  it('saves the compression choice, with 关 meaning original images', async () => {
    const upload = useUploadController();
    await upload.setCompression('default');
    expect(m.saveConfig).toHaveBeenLastCalledWith(expect.objectContaining({ imageCompression: expect.objectContaining({ enabled: true, activePresetId: 'default' }) }), true);
    await upload.setCompression(null);
    expect(m.saveConfig).toHaveBeenLastCalledWith(expect.objectContaining({ imageCompression: expect.objectContaining({ enabled: false }) }), true);
  });

  it('says 未能保存 in red when a home or tray option cannot be written', async () => {
    const upload = useUploadController();
    m.saveConfig.mockRejectedValue(new Error('磁盘已满'));
    await upload.setCompression('default');
    await upload.setCopyFrom('jd');
    expect(m.toastError).toHaveBeenCalledTimes(2);
    expect(m.toastError).toHaveBeenLastCalledWith('未能保存', '磁盘已满，请重试');
  });

  it('asks about public-host risk before enabling one, and does nothing when declined', async () => {
    const upload = useUploadController();
    m.ensureAccepted.mockResolvedValueOnce(false);
    await upload.toggleHost('qiyu');
    expect(m.toggleServiceSelection).not.toHaveBeenCalled();

    await upload.toggleHost('qiyu');
    expect(m.toggleServiceSelection).toHaveBeenCalledWith('qiyu');
  });

  it('adds a no-config host to both 已添加 and 启用 in one go', async () => {
    const upload = useUploadController();
    await upload.enableNoConfigHost('jd');
    expect(m.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      availableServices: expect.arrayContaining(['jd']),
      enabledServices: expect.arrayContaining(['jd']),
    }), true);
    expect(m.loadServiceButtonStates).toHaveBeenCalled();
  });

  it('applies a whole-config change (onboarding) to the latest saved config, then refreshes 上传到 at once', async () => {
    const upload = useUploadController();
    m.fresh = { ...m.fresh, enabledServices: ['r2'] };
    await upload.applyConfigPatch((c) => ({ ...c, enabledServices: [...(c.enabledServices ?? []), 'jd'] }));
    expect(m.ensureAccepted).not.toHaveBeenCalled();
    expect(m.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ enabledServices: ['r2', 'jd'] }), true);
    expect(m.loadServiceButtonStates).toHaveBeenCalled();
    expect(upload.config.value.enabledServices).toEqual(['r2', 'jd']);
  });

  describe('after an upload', () => {
    type HostState = 'done' | 'failed' | 'uploading';
    const STATUS: Record<HostState, string> = { done: '✓ 完成', failed: '✗ 失败', uploading: '上传中...' };

    function item(id: string, hosts: Record<string, HostState>): QueueItem {
      return {
        id,
        fileName: `${id}.png`,
        filePath: `C:/${id}.png`,
        enabledServices: Object.keys(hosts),
        serviceProgress: Object.fromEntries(Object.entries(hosts).map(([host, state]) => [host, {
          serviceId: host,
          status: STATUS[state],
          progress: state === 'done' ? 100 : 0,
          link: state === 'done' ? `https://${host}.example/${id}.png` : undefined,
          error: state === 'failed' ? '认证失败: 401' : undefined,
        }])),
        status: Object.values(hosts).includes('uploading') ? 'uploading' : Object.values(hosts).includes('done') ? 'success' : 'error',
      } as QueueItem;
    }

    async function upload(...items: QueueItem[]) {
      const controller = useUploadController();
      m.handleFilesUpload.mockImplementationOnce(async (_paths: string[], request: UploadRequestOptions) => {
        for (const queued of items) useQueueState().addItem(queued);
        request.onQueued?.(items.map((queued) => queued.id));
      });
      await controller.uploadFiles(items.map((i) => i.filePath));
      return { controller, session: controller.sessions[0] };
    }

    it('re-sends only the images that failed everywhere for 重试 N 张', async () => {
      const { controller, session } = await upload(item('whole', { jd: 'failed' }), item('half', { jd: 'done', weibo: 'failed' }));
      await controller.retryFailed(session.id);
      expect(m.retryAllFailed).toHaveBeenCalledWith(['whole'], expect.anything());
    });

    it('re-logs in once, then re-sends every image of the batch that missed that host', async () => {
      m.cookieLogin.mockImplementation(async (_host: string, after?: () => Promise<void>) => { await after?.(); });
      const { controller, session } = await upload(
        item('a', { jd: 'done', weibo: 'failed' }),
        item('b', { jd: 'done', weibo: 'failed' }),
        item('c', { jd: 'done', weibo: 'done' }),
      );
      await controller.reloginSession(session.id, 'weibo');
      expect(m.cookieLogin).toHaveBeenCalledTimes(1);
      expect(m.retrySingleService.mock.calls.map(([id, host]) => `${id}:${host}`).sort()).toEqual(['a:weibo', 'b:weibo']);
    });

    it('re-sends one host for every image of the batch that missed it, without logging in', async () => {
      const { controller, session } = await upload(item('a', { jd: 'done', r2: 'failed' }), item('b', { jd: 'done', r2: 'done' }));
      await controller.retryHostForSession(session.id, 'r2');
      expect(m.cookieLogin).not.toHaveBeenCalled();
      expect(m.retrySingleService.mock.calls.map(([id, host]) => `${id}:${host}`)).toEqual(['a:r2']);
    });

    it('copies a single retried image as soon as its first host finishes', async () => {
      const { controller } = await upload(item('one', { jd: 'failed' }));
      m.retryAll.mockImplementationOnce(async (itemId: string) => {
        useQueueState().updateItem(itemId, { status: 'uploading', serviceProgress: { jd: { serviceId: 'jd', status: '上传中...', progress: 10, link: undefined, error: undefined } } });
        await Promise.resolve();
        useQueueState().updateItem(itemId, { status: 'success', serviceProgress: { jd: { serviceId: 'jd', status: '✓ 完成', progress: 100, link: 'https://jd.example/one.png' } } });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await controller.retryItem('one');
      expect(m.copyLinks).toHaveBeenCalledWith([{ url: 'https://jd.example/one.png', fileName: 'one.png', serviceId: 'jd' }], expect.anything());
    });

    it('copies every finished host of one image, one link per line, in host order', async () => {
      const { controller } = await upload(item('many', { jd: 'done', weibo: 'failed', r2: 'done' }));
      await controller.copyAllHosts('many');
      expect(m.copyLinks).toHaveBeenLastCalledWith([
        { url: 'https://jd.example/many.png', fileName: 'many.png', serviceId: 'jd' },
        { url: 'https://r2.example/many.png', fileName: 'many.png', serviceId: 'r2' },
      ], expect.objectContaining({ showSuccessToast: false }));
    });

    it('keeps retry toasts quiet while the home page shows the result', () => {
      const controller = useUploadController();
      let onHome = true;
      controller.setHomeVisible(() => onHome);
      m.retryOptions!.toast.error('京东上传失败', '网络超时，请检查网络后重试');
      expect(m.toastError).not.toHaveBeenCalled();
      onHome = false;
      m.retryOptions!.toast.error('京东上传失败', '网络超时，请检查网络后重试');
      expect(m.toastError).toHaveBeenCalledTimes(1);
    });

    it('waits for a running batch before copying it in a new format', async () => {
      const controller = useUploadController();
      let finish!: () => void;
      m.handleFilesUpload.mockImplementationOnce((_paths: string[], request: UploadRequestOptions) => new Promise<void>((resolve) => {
        const batch = [item('a', { jd: 'done' }), item('b', { jd: 'uploading' })];
        for (const queued of batch) useQueueState().addItem(queued);
        request.onQueued?.(batch.map((queued) => queued.id));
        finish = resolve;
      }));
      const running = controller.uploadFiles(['C:/a.png', 'C:/b.png']);
      await controller.setFormat('markdown');
      expect(m.copyLinks).not.toHaveBeenCalled();
      finish();
      await running;
    });

    it('re-copies the finished card in the new format, unless asked only to change the format (tray)', async () => {
      const { controller } = await upload(item('one', { jd: 'done' }));
      await controller.setFormat('html', { recopy: false });
      expect(m.saveConfig).toHaveBeenLastCalledWith(expect.objectContaining({ linkOutput: expect.objectContaining({ defaultFormat: 'html' }) }), true);
      expect(m.copyLinks).not.toHaveBeenCalled();

      await controller.setFormat('markdown');
      expect(m.copyLinks).toHaveBeenCalledTimes(1);
    });

    it('does not re-copy in the new format when the format could not be saved', async () => {
      const { controller } = await upload(item('one', { jd: 'done' }));
      m.saveConfig.mockRejectedValue(new Error('磁盘已满'));
      await controller.setFormat('markdown');
      expect(m.copyLinks).not.toHaveBeenCalled();
      expect(m.toastError).toHaveBeenCalledWith('未能保存', '磁盘已满，请重试');
    });

    it('clears the list but keeps the newest upload on its card', async () => {
      const { controller } = await upload(item('old', { jd: 'done' }));
      const { session: newest } = await upload(item('new', { jd: 'done' }));
      controller.clearSessions();
      expect(controller.sessions.map((s) => s.id)).toEqual([newest.id]);
      expect(useQueueState().queueItems.value.map((i) => i.id)).toEqual(['new']);
      expect(controller.recentClearedAt.value).toBeGreaterThan(0);
    });
  });
});
