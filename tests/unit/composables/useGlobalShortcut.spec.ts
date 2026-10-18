import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getGlobalShortcutMocks,
  getListenMock,
  resetTauriMocks,
} from '../helpers/tauriMock';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';

type ShortcutHandler = (event: { state: 'Pressed' | 'Released' }) => void;
type ConfigUpdatedHandler = () => void | Promise<void>;

const { configGetMock, logErrorMock, pasteClipboardMock, pickAndUploadMock, toastWarnMock } = vi.hoisted(() => ({
  configGetMock: vi.fn(),
  logErrorMock: vi.fn(),
  pasteClipboardMock: vi.fn(),
  pickAndUploadMock: vi.fn(),
  toastWarnMock: vi.fn(),
}));

vi.mock('@/store/instances', () => ({
  configStore: {
    get: configGetMock,
    invalidateCache: vi.fn().mockResolvedValue(undefined),
  },
  // 真实实现 = 作废缓存 + get('config', defaultValue)，这里转发到同一个 mock
  readFreshConfig: (defaultValue?: unknown) => configGetMock('config', defaultValue),
}));

// 快捷键上传走应用级上传控制器（与首页、托盘同一条路）
vi.mock('@/composables/upload/useUploadController', () => ({
  useUploadController: () => ({ pasteClipboard: pasteClipboardMock, pickAndUpload: pickAndUploadMock }),
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ warn: toastWarnMock }),
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: logErrorMock,
  }),
}));

const shortcutMocks = getGlobalShortcutMocks();
const listenMock = getListenMock();

let shortcutHandlers: Map<string, ShortcutHandler>;
let configUpdatedHandler: ConfigUpdatedHandler | undefined;
let unlistenMock: ReturnType<typeof vi.fn>;

function makeConfig(overrides: Partial<UserConfig> = {}): UserConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    globalShortcut: {
      enabled: true,
      uploadClipboard: 'CommandOrControl+Shift+V',
      uploadFromFile: 'CommandOrControl+Shift+O',
      ...(overrides.globalShortcut || {}),
    },
  };
}

async function loadComposable() {
  const { useGlobalShortcut } = await import('@/composables/useGlobalShortcut');
  return useGlobalShortcut();
}

beforeEach(() => {
  vi.resetModules();
  resetTauriMocks();
  configGetMock.mockReset();
  pasteClipboardMock.mockReset().mockResolvedValue(undefined);
  pickAndUploadMock.mockReset().mockResolvedValue(undefined);
  toastWarnMock.mockReset();
  logErrorMock.mockReset();

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
  configGetMock.mockResolvedValue(makeConfig());
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

describe('useGlobalShortcut 录制期间（设置页）', () => {
  it('录制时注销全部快捷键，期间配置变化不重新注册，结束后按最新配置注册', async () => {
    const mod = await import('@/composables/useGlobalShortcut');
    await mod.useGlobalShortcut().initGlobalShortcuts();
    await mod.suspendGlobalShortcuts();
    expect(shortcutMocks.unregisterAll).toHaveBeenCalled();
    shortcutMocks.register.mockClear();

    configGetMock.mockResolvedValue(makeConfig({ globalShortcut: { enabled: true, uploadClipboard: 'Alt+V', uploadFromFile: 'Alt+O' } }));
    await configUpdatedHandler?.();
    expect(shortcutMocks.register).not.toHaveBeenCalled();

    await mod.resumeGlobalShortcuts();
    expect(shortcutHandlers.has('Alt+V')).toBe(true);
    expect(shortcutHandlers.has('Alt+O')).toBe(true);
  });

  it('试注册：别的程序占着时返回 false，能注册时注册完立刻注销', async () => {
    const mod = await import('@/composables/useGlobalShortcut');
    shortcutMocks.register.mockRejectedValueOnce(new Error('HotKey already registered'));
    expect(await mod.probeShortcut('Alt+X')).toBe(false);
    expect(shortcutMocks.unregister).not.toHaveBeenCalledWith('Alt+X');

    expect(await mod.probeShortcut('Alt+Y')).toBe(true);
    expect(shortcutMocks.unregister).toHaveBeenCalledWith('Alt+Y');
  });
});

describe('useGlobalShortcut 触发上传', () => {
  it('剪贴板快捷键按下时交给上传控制器上传剪贴板图片，松开不触发', async () => {
    const api = await loadComposable();
    await api.initGlobalShortcuts();

    shortcutHandlers.get('CommandOrControl+Shift+V')?.({ state: 'Released' });
    expect(pasteClipboardMock).not.toHaveBeenCalled();

    shortcutHandlers.get('CommandOrControl+Shift+V')?.({ state: 'Pressed' });
    expect(pasteClipboardMock).toHaveBeenCalledTimes(1);
    expect(pickAndUploadMock).not.toHaveBeenCalled();
  });

  it('文件快捷键交给上传控制器选择文件上传，不出「更快的方法」提示', async () => {
    const api = await loadComposable();
    await api.initGlobalShortcuts();

    shortcutHandlers.get('CommandOrControl+Shift+O')?.({ state: 'Pressed' });
    expect(pickAndUploadMock).toHaveBeenCalledWith({ showHint: false });
    expect(pasteClipboardMock).not.toHaveBeenCalled();
  });

  it('上传出错只记日志，不变成未处理的 Promise 拒绝', async () => {
    pasteClipboardMock.mockRejectedValue(new Error('boom'));
    const api = await loadComposable();
    await api.initGlobalShortcuts();

    expect(() => shortcutHandlers.get('CommandOrControl+Shift+V')?.({ state: 'Pressed' })).not.toThrow();
    await vi.waitFor(() => expect(logErrorMock).toHaveBeenCalledWith('剪贴板上传 执行异常:', expect.any(Error)));
  });

  it('组合键被别的程序占用时提示一次（写清哪个键、怎么处理），同一个键不重复提示', async () => {
    shortcutMocks.register.mockRejectedValue(new Error('HotKey already registered'));
    const api = await loadComposable();
    await api.initGlobalShortcuts();

    expect(toastWarnMock).toHaveBeenCalledTimes(2);
    expect(toastWarnMock).toHaveBeenCalledWith('全局快捷键未生效', expect.stringContaining('请在 设置 › 快捷键 中更换'));

    toastWarnMock.mockClear();
    const { resumeGlobalShortcuts } = await import('@/composables/useGlobalShortcut');
    await resumeGlobalShortcuts();
    expect(toastWarnMock).not.toHaveBeenCalled();
  });
});
