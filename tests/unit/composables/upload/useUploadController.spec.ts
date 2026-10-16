import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { DEFAULT_CONFIG } from '@/config/types';

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
  listeners: {} as Record<string, (event: { payload: unknown }) => void>,
  fresh: {} as Record<string, unknown>,
  onItemAdded: null as null | ((id: string) => void),
  managerOptions: null as null | { onCopied?: (r: unknown) => void; quietSummary?: () => boolean },
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
  UploadQueueManager: class {
    constructor(options: { onItemAdded?: (id: string) => void }) { m.onItemAdded = options.onItemAdded ?? null; }
  },
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
vi.mock('@/services/RetryService', () => ({ RetryService: class { retryAllFailed = m.retryAllFailed; retrySingleService = vi.fn(); retryAll = vi.fn(); } }));
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
vi.mock('@/composables/useCopyLink', () => ({ useCopyLink: () => ({ copyLinks: vi.fn(async () => ({ ok: true, copiedCount: 1, format: 'url' })) }) }));
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), showConfig: vi.fn() }) }));

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
    m.handleFilesUpload.mockImplementationOnce(async () => {
      m.onItemAdded?.('q-1');
      m.onItemAdded?.('q-2');
      m.managerOptions?.onCopied?.({ ok: true, copiedCount: 2, format: 'markdown' });
    });
    await upload.uploadFiles(['C:/a.png', 'C:/b.png']);
    expect(upload.sessions).toHaveLength(1);
    expect(upload.sessions[0]).toMatchObject({ itemIds: ['q-1', 'q-2'], finished: true, copied: { count: 2, format: 'markdown' } });

    m.handleFilesUpload.mockResolvedValueOnce(undefined);
    await upload.uploadFiles(['C:/not-an-image.zip']);
    expect(upload.sessions).toHaveLength(1);
  });

  it('keeps the summary toast quiet only while the home page is on screen', () => {
    const upload = useUploadController();
    let onHome = true;
    upload.setHomeVisible(() => onHome);
    expect(m.managerOptions?.quietSummary?.()).toBe(true);
    onHome = false;
    expect(m.managerOptions?.quietSummary?.()).toBe(false);
  });

  it('handles tray upload actions after init', async () => {
    const upload = useUploadController();
    m.selectFiles.mockResolvedValue(['C:/tray.png']);
    await upload.init();

    m.listeners['tray-action']({ payload: 'upload_clipboard' });
    expect(m.pasteAndUpload).toHaveBeenCalledTimes(1);

    m.listeners['tray-action']({ payload: 'select_upload_files' });
    await vi.waitFor(() => expect(m.handleFilesUpload).toHaveBeenCalledWith(['C:/tray.png'], {}));
  });

  it('saves the compression choice, with 关 meaning original images', async () => {
    const upload = useUploadController();
    await upload.setCompression('default');
    expect(m.saveConfig).toHaveBeenLastCalledWith(expect.objectContaining({ imageCompression: expect.objectContaining({ enabled: true, activePresetId: 'default' }) }), true);
    await upload.setCompression(null);
    expect(m.saveConfig).toHaveBeenLastCalledWith(expect.objectContaining({ imageCompression: expect.objectContaining({ enabled: false }) }), true);
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
});
