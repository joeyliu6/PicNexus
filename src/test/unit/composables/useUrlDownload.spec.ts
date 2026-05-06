import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getInvokeMock } from '../../helpers/tauriMock';
import { useUrlDownload } from '../../../composables/useUrlDownload';

const toastShowConfigMock = vi.hoisted(() => vi.fn());
const invokeMock = getInvokeMock();

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({
    showConfig: toastShowConfigMock,
  }),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('useUrlDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps downloaded file paths in input URL order even when later downloads finish first', async () => {
    invokeMock.mockImplementation(async (_cmd, args) => {
      const { url } = args as { url: string };
      if (url.endsWith('a.png')) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }

      return {
        file_path: `C:/tmp/${url.split('/').pop()}`,
        content_type: 'image/png',
        file_size: 1,
      };
    });

    const uploadHandler = vi.fn(async () => undefined);
    const { downloadAndUpload } = useUrlDownload();

    const success = await downloadAndUpload(
      'https://example.com/a.png\nhttps://example.com/b.png',
      uploadHandler,
    );

    expect(success).toBe(true);
    expect(uploadHandler).toHaveBeenCalledWith(['C:/tmp/a.png', 'C:/tmp/b.png']);
  });

  it('preserves input order among successful downloads when some URLs fail', async () => {
    invokeMock.mockImplementation(async (_cmd, args) => {
      const { url } = args as { url: string };
      if (url.endsWith('b.png')) throw new Error('download failed');
      if (url.endsWith('a.png')) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }

      return {
        file_path: `C:/tmp/${url.split('/').pop()}`,
        content_type: 'image/png',
        file_size: 1,
      };
    });

    const uploadHandler = vi.fn(async () => undefined);
    const { downloadAndUpload } = useUrlDownload();

    const success = await downloadAndUpload(
      'https://example.com/a.png\nhttps://example.com/b.png\nhttps://example.com/c.png',
      uploadHandler,
    );

    expect(success).toBe(true);
    expect(uploadHandler).toHaveBeenCalledWith(['C:/tmp/a.png', 'C:/tmp/c.png']);
    expect(toastShowConfigMock).toHaveBeenCalledWith('warn', expect.anything());
  });

  it('超过 20 个 URL 时提示截断并只下载前 20 个', async () => {
    invokeMock.mockImplementation(async (_cmd, args) => {
      const { url } = args as { url: string };
      return {
        file_path: `C:/tmp/${url.split('/').pop()}`,
        content_type: 'image/png',
        file_size: 1,
      };
    });

    const uploadHandler = vi.fn(async () => undefined);
    const { downloadAndUpload } = useUrlDownload();
    const urls = Array.from({ length: 23 }, (_, index) => `https://example.com/${index + 1}.png`);

    const success = await downloadAndUpload(urls.join('\n'), uploadHandler);

    expect(success).toBe(true);
    expect(invokeMock).toHaveBeenCalledTimes(20);
    expect(uploadHandler).toHaveBeenCalledWith(
      Array.from({ length: 20 }, (_, index) => `C:/tmp/${index + 1}.png`),
    );
    expect(toastShowConfigMock).toHaveBeenCalledWith('warn', expect.objectContaining({
      summary: 'URL 数量超限',
      detail: expect.stringContaining('3'),
    }));
  });

  it('returns false without downloading when input has no valid URL', async () => {
    const uploadHandler = vi.fn(async () => undefined);
    const { downloadAndUpload } = useUrlDownload();

    const success = await downloadAndUpload('not-a-url', uploadHandler);

    expect(success).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(uploadHandler).not.toHaveBeenCalled();
    expect(toastShowConfigMock).toHaveBeenCalledWith('warn', expect.anything());
  });

  it('returns false and skips upload when every download fails', async () => {
    invokeMock.mockRejectedValue(new Error('network down'));
    const uploadHandler = vi.fn(async () => undefined);
    const { downloadAndUpload } = useUrlDownload();

    const success = await downloadAndUpload('https://example.com/a.png', uploadHandler);

    expect(success).toBe(false);
    expect(uploadHandler).not.toHaveBeenCalled();
    expect(toastShowConfigMock).toHaveBeenCalledWith('error', expect.anything());
  });
});
