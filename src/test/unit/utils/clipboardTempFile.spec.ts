import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, warnMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  warnMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: warnMock,
    error: vi.fn(),
  }),
}));

const { cleanupClipboardTempFile, isClipboardTempFilePath } = await import('../../../utils/clipboardTempFile');

describe('clipboardTempFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue(true);
  });

  it('recognizes retained clipboard temp image paths by filename', () => {
    expect(isClipboardTempFilePath('C:/Temp/clipboard_image_20260429_001.png')).toBe(true);
    expect(isClipboardTempFilePath('C:\\Temp\\clipboard_image_20260429_001.PNG')).toBe(true);
    expect(isClipboardTempFilePath('C:/Temp/picnexus_url_20260429.png')).toBe(false);
    expect(isClipboardTempFilePath(undefined)).toBe(false);
  });

  it('skips non-clipboard paths before calling the Tauri cleanup command', async () => {
    await cleanupClipboardTempFile('C:/Temp/demo.png');

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('delegates clipboard temp cleanup to the guarded Tauri command', async () => {
    const filePath = 'C:/Temp/clipboard_image_20260429_001.png';

    await cleanupClipboardTempFile(filePath);

    expect(invokeMock).toHaveBeenCalledWith('cleanup_clipboard_temp_file', { path: filePath });
  });
});
