import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getInvokeMock } from '../../helpers/tauriMock';
import type { CompressionPreset } from '@/config/types';

const invokeMock = getInvokeMock();

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function makePreset(overrides: Partial<CompressionPreset> = {}): CompressionPreset {
  return {
    id: 'p1',
    name: '测试方案',
    quality: 80,
    outputFormat: 'original',
    maxLongSide: 0,
    scalePercent: 100,
    skipIfSmallerKB: 0,
    stripExif: true,
    ...overrides,
  };
}

describe('useImageCompress', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('passes stripExif to compress_image', async () => {
    invokeMock.mockResolvedValue({
      outputPath: 'C:/tmp/out.jpg',
      originalSize: 200_000,
      compressedSize: 120_000,
      ratio: 0.6,
      width: 1200,
      height: 800,
      format: 'jpg',
    });

    const { useImageCompress } = await import('@/composables/image/useImageCompress');
    const { compressImage } = useImageCompress();

    await compressImage('C:/tmp/a.jpg', makePreset({ stripExif: false }), 200_000);

    expect(invokeMock).toHaveBeenCalledWith('compress_image', expect.objectContaining({
      filePath: 'C:/tmp/a.jpg',
      stripExif: false,
      quality: 80,
    }));
  });

  it('strips exif only when file is below threshold and stripExif enabled', async () => {
    invokeMock.mockResolvedValue({
      outputPath: 'C:/tmp/stripped.jpg',
      originalSize: 90_000,
      compressedSize: 88_000,
      ratio: 0.97,
      width: 1000,
      height: 700,
      format: 'jpg',
    });

    const { useImageCompress } = await import('@/composables/image/useImageCompress');
    const { compressImage } = useImageCompress();

    const result = await compressImage(
      'C:/tmp/small.jpg',
      makePreset({ skipIfSmallerKB: 200, stripExif: true }),
      90_000,
    );

    expect(invokeMock).toHaveBeenCalledWith('strip_exif_only', { filePath: 'C:/tmp/small.jpg' });
    expect(result.filePath).toBe('C:/tmp/stripped.jpg');
  });

  it('keeps original file when below threshold and stripExif disabled', async () => {
    const { useImageCompress } = await import('@/composables/image/useImageCompress');
    const { compressImage } = useImageCompress();

    const result = await compressImage(
      'C:/tmp/small.jpg',
      makePreset({ skipIfSmallerKB: 200, stripExif: false }),
      90_000,
    );

    expect(invokeMock).not.toHaveBeenCalled();
    expect(result).toEqual({ filePath: 'C:/tmp/small.jpg', compressed: false });
  });

  it('prepareSingleUpload：读不到文件大小时照样压缩（与批量上传口径一致），产物由调用方 cleanup 删除', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'get_image_metadata') throw new Error('decode failed');
      if (command === 'compress_image') {
        return {
          outputPath: 'C:/tmp/retry-out.jpg',
          originalSize: 5_000_000,
          compressedSize: 1_000_000,
          ratio: 0.2,
          width: 10,
          height: 10,
          format: 'jpg',
        };
      }
      return 1;
    });

    const { useImageCompress } = await import('@/composables/image/useImageCompress');
    const { prepareSingleUpload } = useImageCompress();

    const prepared = await prepareSingleUpload('C:/tmp/unknown-size.jpg', {
      enabled: true,
      activePresetId: 'p1',
      presets: [makePreset({ skipIfSmallerKB: 2048 })],
    });

    expect(prepared.uploadPath).toBe('C:/tmp/retry-out.jpg');
    await prepared.cleanup();
    expect(invokeMock).toHaveBeenCalledWith('cleanup_compressed_files', { filePaths: ['C:/tmp/retry-out.jpg'] });
  });

  it('prepareSingleUpload：压缩关闭时原样返回，不调后端', async () => {
    const { useImageCompress } = await import('@/composables/image/useImageCompress');
    const { prepareSingleUpload } = useImageCompress();

    const prepared = await prepareSingleUpload('C:/tmp/a.jpg', { enabled: false, activePresetId: 'p1', presets: [] });
    await prepared.cleanup();

    expect(prepared.uploadPath).toBe('C:/tmp/a.jpg');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('skips gif without calling backend command', async () => {
    const { useImageCompress } = await import('@/composables/image/useImageCompress');
    const { compressImage } = useImageCompress();

    const result = await compressImage('C:/tmp/anim.gif', makePreset(), 120_000);

    expect(invokeMock).not.toHaveBeenCalled();
    expect(result).toEqual({ filePath: 'C:/tmp/anim.gif', compressed: false });
  });
});
