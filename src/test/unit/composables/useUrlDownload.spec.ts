import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUrlDownload } from '../../../composables/useUrlDownload';

const invokeMock = vi.hoisted(() => vi.fn());
const toastShowConfigMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

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
    invokeMock.mockImplementation(async (_cmd: string, { url }: { url: string }) => {
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

    await downloadAndUpload(
      'https://example.com/a.png\nhttps://example.com/b.png',
      uploadHandler,
    );

    expect(uploadHandler).toHaveBeenCalledWith(['C:/tmp/a.png', 'C:/tmp/b.png']);
  });

  it('preserves input order among successful downloads when some URLs fail', async () => {
    invokeMock.mockImplementation(async (_cmd: string, { url }: { url: string }) => {
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

    await downloadAndUpload(
      'https://example.com/a.png\nhttps://example.com/b.png\nhttps://example.com/c.png',
      uploadHandler,
    );

    expect(uploadHandler).toHaveBeenCalledWith(['C:/tmp/a.png', 'C:/tmp/c.png']);
    expect(toastShowConfigMock).toHaveBeenCalledWith('warn', expect.anything());
  });
});
