import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getClipboardMocks,
  getInvokeMock,
  setupInvokeHandler,
} from '../../helpers/tauriMock';
import { useClipboardImage } from '../../../composables/useClipboardImage';

const toastWarnMock = vi.hoisted(() => vi.fn());
const invokeMock = getInvokeMock();
const readTextMock = getClipboardMocks().readText;

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({
    warn: toastWarnMock,
  }),
}));

vi.mock('../../../utils/logger', () => ({
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
      if (cmd === 'read_clipboard_image') return 'C:/tmp/from-clipboard.webp';
      throw new Error(`unexpected command: ${cmd}`);
    });
    const uploadHandler = vi.fn(async () => undefined);

    await useClipboardImage().pasteAndUpload(uploadHandler);

    expect(uploadHandler).toHaveBeenCalledWith(['C:/tmp/from-clipboard.webp']);
    expect(toastWarnMock).not.toHaveBeenCalled();
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

  it('图片 URL 下载失败时提示下载失败，且不触发上传', async () => {
    readTextMock.mockResolvedValue('https://example.com/a.png');
    setupInvokeHandler(async (cmd) => {
      if (cmd === 'clipboard_has_image') return false;
      if (cmd === 'download_url_image') throw new Error('404');
      throw new Error(`unexpected command: ${cmd}`);
    });
    const uploadHandler = vi.fn(async () => undefined);

    await useClipboardImage().pasteAndUpload(uploadHandler);

    expect(uploadHandler).not.toHaveBeenCalled();
    expect(toastWarnMock).toHaveBeenCalledWith('下载失败', '图片链接下载失败: Error: 404');
  });

  it('剪贴板文本不是图片 URL 时，提示粘贴失败', async () => {
    readTextMock.mockResolvedValue('https://example.com/readme.txt');
    setupInvokeHandler(async (cmd) => {
      if (cmd === 'clipboard_has_image') return false;
      throw new Error(`unexpected command: ${cmd}`);
    });

    await useClipboardImage().pasteAndUpload(vi.fn());

    expect(toastWarnMock).toHaveBeenCalledWith(
      '粘贴失败',
      '剪贴板中没有图片，也没有有效的图片链接',
    );
  });
});
