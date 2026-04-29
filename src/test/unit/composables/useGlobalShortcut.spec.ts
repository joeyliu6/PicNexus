import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getClipboardMocks,
  getDialogOpenMock,
  getGlobalShortcutMocks,
  getInvokeMock,
  getListenMock,
  getNotificationMocks,
  resetTauriMocks,
} from '../../helpers/tauriMock';
import { DEFAULT_CONFIG, type UserConfig } from '../../../config/types';
import { MAX_FILES_PER_UPLOAD } from '../../../composables/upload/FileValidator';

type ShortcutHandler = (event: { state: 'Pressed' | 'Released' }) => void;
type ConfigUpdatedHandler = () => void | Promise<void>;

const {
  addResultToHistoryItemMock,
  buildUploadSummaryToastMock,
  configGetMock,
  formatLinkWithConfigMock,
  getLinkFormatConfigMock,
  saveHistoryItemImmediateMock,
  uploadToMultipleServicesMock,
} = vi.hoisted(() => ({
  addResultToHistoryItemMock: vi.fn(),
  buildUploadSummaryToastMock: vi.fn(),
  configGetMock: vi.fn(),
  formatLinkWithConfigMock: vi.fn(),
  getLinkFormatConfigMock: vi.fn(),
  saveHistoryItemImmediateMock: vi.fn(),
  uploadToMultipleServicesMock: vi.fn(),
}));

vi.mock('../../../store/instances', () => ({
  configStore: {
    get: configGetMock,
  },
}));

vi.mock('../../../core/MultiServiceUploader', () => ({
  MultiServiceUploader: vi.fn(() => ({
    uploadToMultipleServices: uploadToMultipleServicesMock,
  })),
}));

vi.mock('../../../composables/useHistorySaver', () => ({
  useHistorySaver: () => ({
    saveHistoryItemImmediate: saveHistoryItemImmediateMock,
    addResultToHistoryItem: addResultToHistoryItemMock,
  }),
}));

vi.mock('../../../composables/useCopyLink', () => ({
  formatLinkWithConfig: formatLinkWithConfigMock,
  getLinkFormatConfig: getLinkFormatConfigMock,
}));

vi.mock('../../../utils/uploadSummary', () => ({
  buildUploadSummaryToast: buildUploadSummaryToastMock,
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const shortcutMocks = getGlobalShortcutMocks();
const notificationMocks = getNotificationMocks();
const invokeMock = getInvokeMock();
const listenMock = getListenMock();
const dialogOpenMock = getDialogOpenMock();
const writeTextMock = getClipboardMocks().writeText;

let shortcutHandlers: Map<string, ShortcutHandler>;
let configUpdatedHandler: ConfigUpdatedHandler | undefined;
let unlistenMock: ReturnType<typeof vi.fn>;

function makeConfig(overrides: Partial<UserConfig> = {}): UserConfig {
  const shortcutOverrides = overrides.globalShortcut || {};
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    enabledServices: overrides.enabledServices ?? ['imgur'],
    services: {
      ...DEFAULT_CONFIG.services,
      ...(overrides.services || {}),
    },
    linkOutput: {
      ...DEFAULT_CONFIG.linkOutput!,
      ...(overrides.linkOutput || {}),
    },
    globalShortcut: {
      enabled: true,
      uploadClipboard: 'CommandOrControl+Shift+V',
      uploadFromFile: 'CommandOrControl+Shift+O',
      ...shortcutOverrides,
    },
  };
}

async function loadComposable() {
  const { useGlobalShortcut } = await import('../../../composables/useGlobalShortcut');
  return useGlobalShortcut();
}

async function flushAsyncWork(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetModules();
  resetTauriMocks();
  configGetMock.mockReset();
  addResultToHistoryItemMock.mockReset();
  buildUploadSummaryToastMock.mockReset();
  formatLinkWithConfigMock.mockReset();
  getLinkFormatConfigMock.mockReset();
  saveHistoryItemImmediateMock.mockReset();
  uploadToMultipleServicesMock.mockReset();
  invokeMock.mockResolvedValue({ width: 100, height: 80 });
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn(() => 'history-id-1'),
  });

  shortcutHandlers = new Map();
  configUpdatedHandler = undefined;
  unlistenMock = vi.fn();

  shortcutMocks.register.mockImplementation(async (shortcut, handler) => {
    const shortcuts = Array.isArray(shortcut) ? shortcut : [shortcut];
    for (const key of shortcuts) {
      shortcutHandlers.set(key, handler as ShortcutHandler);
    }
  });
  listenMock.mockImplementation(async (event, handler) => {
    if (event === 'config-updated') {
      configUpdatedHandler = handler as ConfigUpdatedHandler;
    }
    return unlistenMock;
  });
  notificationMocks.isPermissionGranted.mockResolvedValue(true);
  getLinkFormatConfigMock.mockReturnValue({ format: 'markdown' });
  formatLinkWithConfigMock.mockImplementation((input: { url: string; fileName: string; serviceId?: string }) => {
    return `${input.serviceId}:${input.fileName}:${input.url}`;
  });
  buildUploadSummaryToastMock.mockReturnValue({
    summary: '上传完成',
    detail: '成功 1 张',
  });
  configGetMock.mockResolvedValue(makeConfig());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useGlobalShortcut 初始化与清理', () => {
  it('初始化时按配置注册两个快捷键，并在 cleanup 时注销与取消监听', async () => {
    const api = await loadComposable();

    await api.initGlobalShortcuts();

    expect(shortcutMocks.register).toHaveBeenCalledTimes(2);
    expect(shortcutHandlers.has('CommandOrControl+Shift+V')).toBe(true);
    expect(shortcutHandlers.has('CommandOrControl+Shift+O')).toBe(true);
    expect(listenMock).toHaveBeenCalledWith('config-updated', expect.any(Function));

    await api.cleanup();

    expect(unlistenMock).toHaveBeenCalledTimes(1);
    expect(shortcutMocks.unregisterAll).toHaveBeenCalledTimes(1);
  });

  it('配置更新但快捷键配置未变化时，不重复注销和注册', async () => {
    const api = await loadComposable();
    await api.initGlobalShortcuts();
    shortcutMocks.register.mockClear();
    shortcutMocks.unregisterAll.mockClear();

    await configUpdatedHandler?.();

    expect(shortcutMocks.unregisterAll).not.toHaveBeenCalled();
    expect(shortcutMocks.register).not.toHaveBeenCalled();
  });

  it('配置更新且快捷键变化时，先注销旧快捷键再注册新快捷键', async () => {
    configGetMock
      .mockResolvedValueOnce(makeConfig())
      .mockResolvedValueOnce(makeConfig({
        globalShortcut: {
          enabled: true,
          uploadClipboard: 'Alt+V',
          uploadFromFile: 'Alt+O',
        },
      }));
    const api = await loadComposable();
    await api.initGlobalShortcuts();
    shortcutMocks.register.mockClear();
    shortcutMocks.unregisterAll.mockClear();

    await configUpdatedHandler?.();

    expect(shortcutMocks.unregisterAll).toHaveBeenCalledTimes(1);
    expect(shortcutMocks.register).toHaveBeenCalledTimes(2);
    expect(shortcutHandlers.has('Alt+V')).toBe(true);
    expect(shortcutHandlers.has('Alt+O')).toBe(true);
  });

  it('快捷键已被注册时会先 unregister 当前键，再重新 register', async () => {
    shortcutMocks.isRegistered.mockImplementation(async (shortcut) => shortcut === 'CommandOrControl+Shift+V');
    const api = await loadComposable();

    await api.initGlobalShortcuts();

    expect(shortcutMocks.unregister).toHaveBeenCalledWith('CommandOrControl+Shift+V');
  });
});

describe('useGlobalShortcut 触发上传', () => {
  it('剪贴板快捷键 Pressed 时读取图片、后台上传、保存历史、复制格式化链接并发送汇总通知', async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'clipboard_has_image') return true;
      if (cmd === 'read_clipboard_image') return 'C:/tmp/clip.png';
      throw new Error(`unexpected command: ${cmd}`);
    });
    const copyDone = deferred<void>();
    const notifyDone = deferred<void>();
    writeTextMock.mockImplementation(async () => {
      copyDone.resolve();
    });
    notificationMocks.sendNotification.mockImplementation(async () => {
      notifyDone.resolve();
    });
    uploadToMultipleServicesMock.mockImplementation(async (
      _filePath,
      _services,
      _config,
      _progress,
      onServiceResult: (result: unknown) => Promise<void>,
    ) => {
      await onServiceResult({
        status: 'success',
        serviceId: 'imgur',
        result: { url: 'https://i.imgur.com/clip.png' },
      });
      return {
        primaryUrl: 'https://i.imgur.com/clip.png',
        primaryService: 'imgur',
      };
    });
    const api = await loadComposable();
    await api.initGlobalShortcuts();

    shortcutHandlers.get('CommandOrControl+Shift+V')?.({ state: 'Pressed' });
    await copyDone.promise;
    await notifyDone.promise;
    await flushAsyncWork();

    expect(uploadToMultipleServicesMock).toHaveBeenCalledWith(
      'C:/tmp/clip.png',
      ['imgur'],
      expect.objectContaining({ enabledServices: ['imgur'] }),
      undefined,
      expect.any(Function),
    );
    expect(saveHistoryItemImmediateMock).toHaveBeenCalledWith(
      'C:/tmp/clip.png',
      expect.objectContaining({ serviceId: 'imgur' }),
      'history-id-1',
    );
    expect(writeTextMock).toHaveBeenCalledWith('imgur:clip.png:https://i.imgur.com/clip.png');
    expect(notificationMocks.sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: '上传完成',
      body: '成功 1 张',
    }));
    expect(api.isUploading.value).toBe(false);
  });

  it('剪贴板没有图片时只通知用户，不触发上传', async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'clipboard_has_image') return false;
      throw new Error(`unexpected command: ${cmd}`);
    });
    const api = await loadComposable();
    await api.initGlobalShortcuts();

    shortcutHandlers.get('CommandOrControl+Shift+V')?.({ state: 'Pressed' });
    await flushAsyncWork();

    expect(uploadToMultipleServicesMock).not.toHaveBeenCalled();
    expect(writeTextMock).not.toHaveBeenCalled();
    expect(notificationMocks.sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: 'PicNexus',
      body: '剪贴板中没有图片',
    }));
  });

  it('文件选择快捷键会逐个上传所选文件，并把成功链接按行复制', async () => {
    dialogOpenMock.mockResolvedValue(['C:/images/a.jpg', 'C:/images/b.png']);
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'get_image_metadata') return { width: 100, height: 80 };
      throw new Error(`unexpected command: ${cmd}`);
    });
    const copyDone = deferred<void>();
    const notifyDone = deferred<void>();
    writeTextMock.mockImplementation(async () => {
      copyDone.resolve();
    });
    notificationMocks.sendNotification.mockImplementation(async () => {
      notifyDone.resolve();
    });
    uploadToMultipleServicesMock.mockImplementation(async (filePath: string) => {
      const name = filePath.endsWith('a.jpg') ? 'a.jpg' : 'b.png';
      return {
        primaryUrl: `https://i.imgur.com/${name}`,
        primaryService: 'imgur',
      };
    });
    const api = await loadComposable();
    await api.initGlobalShortcuts();

    shortcutHandlers.get('CommandOrControl+Shift+O')?.({ state: 'Pressed' });
    await copyDone.promise;
    await notifyDone.promise;
    await flushAsyncWork();

    expect(dialogOpenMock).toHaveBeenCalledWith(expect.objectContaining({
      multiple: true,
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }],
    }));
    expect(writeTextMock).toHaveBeenCalledWith([
      'imgur:a.jpg:https://i.imgur.com/a.jpg',
      'imgur:b.png:https://i.imgur.com/b.png',
    ].join('\n'));
    expect(notificationMocks.sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: '上传完成',
    }));
  });

  it('文件选择快捷键会过滤损坏图片并截断超过上限的多选文件', async () => {
    const validFiles = Array.from(
      { length: MAX_FILES_PER_UPLOAD - 1 },
      (_, index) => `C:/images/good-${index + 1}.jpg`,
    );
    const fakeFile = 'C:/images/fake.jpg';
    const overflowFiles = Array.from(
      { length: 5 },
      (_, index) => `C:/images/overflow-${index + 1}.png`,
    );
    const textFile = 'C:/images/not-image.txt';
    dialogOpenMock.mockResolvedValue([...validFiles, fakeFile, ...overflowFiles, textFile]);
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd !== 'get_image_metadata') throw new Error(`unexpected command: ${cmd}`);
      const { filePath } = args as { filePath: string };
      if (filePath === fakeFile) throw new Error('invalid image header');
      return { width: 100, height: 80 };
    });
    const copyDone = deferred<void>();
    writeTextMock.mockImplementation(async () => {
      copyDone.resolve();
    });
    uploadToMultipleServicesMock.mockImplementation(async (filePath: string) => {
      const name = filePath.split(/[\\/]/).pop() ?? filePath;
      return {
        primaryUrl: `https://i.imgur.com/${name}`,
        primaryService: 'imgur',
      };
    });
    const api = await loadComposable();
    await api.initGlobalShortcuts();

    shortcutHandlers.get('CommandOrControl+Shift+O')?.({ state: 'Pressed' });
    await copyDone.promise;
    await flushAsyncWork();

    expect(invokeMock).toHaveBeenCalledTimes(MAX_FILES_PER_UPLOAD);
    expect(uploadToMultipleServicesMock).toHaveBeenCalledTimes(MAX_FILES_PER_UPLOAD - 1);
    const uploadedPaths = uploadToMultipleServicesMock.mock.calls.map(call => call[0]);
    expect(uploadedPaths).not.toContain(fakeFile);
    overflowFiles.forEach(filePath => expect(uploadedPaths).not.toContain(filePath));
    expect(uploadedPaths).not.toContain(textFile);
    expect(notificationMocks.sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: 'PicNexus',
      body: expect.stringContaining('已忽略 2 个无效或损坏的图片文件'),
    }));
    expect(notificationMocks.sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: 'PicNexus',
      body: expect.stringContaining('已截断多余的 5 个'),
    }));
  });

  it('没有启用图床时不复制链接，并提示先配置图床', async () => {
    configGetMock.mockResolvedValue(makeConfig({ enabledServices: [] }));
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === 'clipboard_has_image') return true;
      if (cmd === 'read_clipboard_image') return 'C:/tmp/clip.png';
      throw new Error(`unexpected command: ${cmd}`);
    });
    const api = await loadComposable();
    await api.initGlobalShortcuts();

    shortcutHandlers.get('CommandOrControl+Shift+V')?.({ state: 'Pressed' });
    await flushAsyncWork();

    expect(uploadToMultipleServicesMock).not.toHaveBeenCalled();
    expect(writeTextMock).not.toHaveBeenCalled();
    expect(notificationMocks.sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: 'PicNexus',
      body: '没有启用任何图床，请先配置',
    }));
  });
});
