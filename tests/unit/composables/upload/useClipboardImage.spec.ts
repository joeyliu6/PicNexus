import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getClipboardMocks,
  getInvokeMock,
  setupInvokeHandler,
} from '../../helpers/tauriMock';
import { useClipboardImage } from '@/composables/upload/useClipboardImage';
import { useQueueState } from '@/composables/upload/useQueueState';

const toastWarnMock = vi.hoisted(() => vi.fn());
const toastInfoMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const invokeMock = getInvokeMock();
const readTextMock = getClipboardMocks().readText;

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    warn: toastWarnMock,
    info: toastInfoMock,
    error: toastErrorMock,
  }),
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useClipboardImage.readClipboardImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueueState().clearQueue();
    readTextMock.mockResolvedValue('');
  });

  it('剪贴板有图片时读取临时文件路径，并在结束后释放 processing 状态', async () => {
    setupInvokeHandler(async (cmd) => {
      if (cmd === 'clipboard_has_image') return true;
      if (cmd === 'read_clipboard_image') return 'C:/tmp/clipboard.png';
      throw new Error(`unexpected command: ${cmd}`);
    });

    const api = useClipboardImage();
    const result = await api.readClipboardImage();

    expect(result).toEqual({ success: true, filePath: 'C:/tmp/clipboard.png' });
    expect(api.isProcessing.value).toBe(false);
  });

  it('剪贴板无图片时返回可展示错误，且不读取图片文件', async () => {
    setupInvokeHandler(async (cmd) => {
      if (cmd === 'clipboard_has_image') return false;
      throw new Error(`unexpected command: ${cmd}`);
    });

    const result = await useClipboardImage().readClipboardImage();

    expect(result).toEqual({ success: false, error: '剪贴板中没有图片' });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('Tauri 读取失败时返回错误消息，并重置 processing 状态', async () => {
    setupInvokeHandler(async (cmd) => {
      if (cmd === 'clipboard_has_image') throw new Error('permission denied');
      throw new Error(`unexpected command: ${cmd}`);
    });

    const api = useClipboardImage();
    await expect(api.readClipboardImage()).resolves.toEqual({
      success: false,
      error: 'permission denied',
    });
    expect(api.isProcessing.value).toBe(false);
  });

  it('并发读取会被 processing guard 拦住，避免重复调用后端', async () => {
    const hasImage = deferred<boolean>();
    setupInvokeHandler(async (cmd) => {
      if (cmd === 'clipboard_has_image') return hasImage.promise;
      if (cmd === 'read_clipboard_image') return 'C:/tmp/clipboard.png';
      throw new Error(`unexpected command: ${cmd}`);
    });

    const api = useClipboardImage();
    const first = api.readClipboardImage();
    await Promise.resolve();

    await expect(api.readClipboardImage()).resolves.toEqual({
      success: false,
      error: '正在处理中...',
    });

    hasImage.resolve(true);
    await expect(first).resolves.toEqual({ success: true, filePath: 'C:/tmp/clipboard.png' });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});

describe('useClipboardImage.pasteAndUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readTextMock.mockResolvedValue('');
  });

  it('剪贴板图片读取成功后，把临时路径交给上传处理器', async () => {
    setupInvokeHandler(async (cmd) => {
      if (cmd === 'clipboard_has_image') return true;
      if (cmd === 'read_clipboard_image') return 'C:/tmp/clipboard_image_from_clipboard.png';
      if (cmd === 'cleanup_clipboard_temp_file') return true;
      throw new Error(`unexpected command: ${cmd}`);
    });
    const uploadHandler = vi.fn(async () => undefined);

    await useClipboardImage().pasteAndUpload(uploadHandler);

    expect(uploadHandler).toHaveBeenCalledWith(['C:/tmp/clipboard_image_from_clipboard.png']);
    expect(invokeMock).toHaveBeenCalledWith('cleanup_clipboard_temp_file', {
      path: 'C:/tmp/clipboard_image_from_clipboard.png',
    });
    expect(toastWarnMock).not.toHaveBeenCalled();
  });

  it('剪贴板图片上传处理器失败时仍清理本次临时文件', async () => {
    setupInvokeHandler(async (cmd) => {
      if (cmd === 'clipboard_has_image') return true;
      if (cmd === 'read_clipboard_image') return 'C:/tmp/clipboard_image_from_clipboard.png';
      if (cmd === 'cleanup_clipboard_temp_file') return true;
      throw new Error(`unexpected command: ${cmd}`);
    });
    const uploadHandler = vi.fn(async () => {
      throw new Error('upload failed');
    });

    await expect(useClipboardImage().pasteAndUpload(uploadHandler)).rejects.toThrow('upload failed');

    expect(invokeMock).toHaveBeenCalledWith('cleanup_clipboard_temp_file', {
      path: 'C:/tmp/clipboard_image_from_clipboard.png',
    });
  });

  it('剪贴板图片上传后若队列仍有失败服务，则保留临时文件用于重试', async () => {
    setupInvokeHandler(async (cmd) => {
      if (cmd === 'clipboard_has_image') return true;
      if (cmd === 'read_clipboard_image') return 'C:/tmp/clipboard_image_from_clipboard.png';
      if (cmd === 'cleanup_clipboard_temp_file') return true;
      throw new Error(`unexpected command: ${cmd}`);
    });
    const uploadHandler = vi.fn(async () => {
      useQueueState().addItem({
        id: 'q-clip',
        fileName: 'clipboard_image_from_clipboard.png',
        filePath: 'C:/tmp/clipboard_image_from_clipboard.png',
        enabledServices: ['weibo', 'r2'],
        serviceProgress: {
          weibo: { serviceId: 'weibo', progress: 100, status: '✓ 完成' },
          r2: { serviceId: 'r2', progress: 0, status: '✗ 失败', error: 'boom' },
        },
        status: 'success',
      } as any);
    });

    await useClipboardImage().pasteAndUpload(uploadHandler);

    expect(invokeMock).not.toHaveBeenCalledWith('cleanup_clipboard_temp_file', expect.anything());
  });

  it('剪贴板没有图片但包含图片 URL 时，先下载再上传', async () => {
    readTextMock.mockResolvedValue('  https://example.com/a.JPG?token=1  ');
    setupInvokeHandler(async (cmd, args) => {
      if (cmd === 'clipboard_has_image') return false;
      if (cmd === 'download_url_image') {
        expect(args).toEqual({ url: 'https://example.com/a.JPG?token=1' });
        return { file_path: 'C:/tmp/downloaded.jpg' };
      }
      throw new Error(`unexpected command: ${cmd}`);
    });
    const uploadHandler = vi.fn(async () => undefined);

    await useClipboardImage().pasteAndUpload(uploadHandler);

    expect(uploadHandler).toHaveBeenCalledWith(['C:/tmp/downloaded.jpg']);
    expect(toastWarnMock).not.toHaveBeenCalled();
  });

  // 粘贴上传这次失败了：红色，原因 + 处理办法；Rust 报的错是对象，读出里面的话（不能显示成 [object Object]）
  it('图片 URL 下载失败时说清原因与处理办法，且不触发上传', async () => {
    readTextMock.mockResolvedValue('https://example.com/a.png');
    setupInvokeHandler(async (cmd) => {
      if (cmd === 'clipboard_has_image') return false;
      if (cmd === 'download_url_image') throw { type: 'NETWORK', data: { message: '下载失败: HTTP 404' } };
      throw new Error(`unexpected command: ${cmd}`);
    });
    const uploadHandler = vi.fn(async () => undefined);

    await useClipboardImage().pasteAndUpload(uploadHandler);

    expect(uploadHandler).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('图片链接下载失败', '下载失败: HTTP 404，请检查链接后重试');
    expect(toastWarnMock).not.toHaveBeenCalled();
  });

  // Patterns.dc.html 通知样例：「剪贴板里没有图片 / 复制一张图片后再按 Ctrl V」（灰色 i，不是警告）；
  // 快捷键照全应用的写法（交接说明 3.3：Ctrl+V，macOS ⌘V），与投放区的「或按 Ctrl+V 粘贴」一致
  it('剪贴板里既没有图片也没有图片链接时，说清怎么做', async () => {
    readTextMock.mockResolvedValue('https://example.com/readme.txt');
    setupInvokeHandler(async (cmd) => {
      if (cmd === 'clipboard_has_image') return false;
      throw new Error(`unexpected command: ${cmd}`);
    });

    await useClipboardImage().pasteAndUpload(vi.fn());

    expect(toastInfoMock).toHaveBeenCalledWith('剪贴板里没有图片', '复制一张图片后再按 Ctrl+V');
    expect(toastWarnMock).not.toHaveBeenCalled();
  });
});
