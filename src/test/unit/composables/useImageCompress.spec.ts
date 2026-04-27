import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getInvokeMock } from '../../helpers/tauriMock';
import type { CompressionPreset } from '../../../config/types';

const invokeMock = getInvokeMock();

vi.mock('../../../utils/logger', () => ({
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

    const { useImageCompress } = await import('../../../composables/useImageCompress');
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

    const { useImageCompress } = await import('../../../composables/useImageCompress');
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
    const { useImageCompress } = await import('../../../composables/useImageCompress');
    const { compressImage } = useImageCompress();

    const result = await compressImage(
      'C:/tmp/small.jpg',
      makePreset({ skipIfSmallerKB: 200, stripExif: false }),
      90_000,
    );

    expect(invokeMock).not.toHaveBeenCalled();
    expect(result).toEqual({ filePath: 'C:/tmp/small.jpg', compressed: false });
  });

  it('skips gif without calling backend command', async () => {
    const { useImageCompress } = await import('../../../composables/useImageCompress');
    const { compressImage } = useImageCompress();

    const result = await compressImage('C:/tmp/anim.gif', makePreset(), 120_000);

    expect(invokeMock).not.toHaveBeenCalled();
    expect(result).toEqual({ filePath: 'C:/tmp/anim.gif', compressed: false });
  });
});
