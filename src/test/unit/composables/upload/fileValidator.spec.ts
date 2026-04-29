import { describe, it, expect, vi, beforeEach } from 'vitest';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import {
  filterValidFiles,
  selectFiles,
  VALID_IMAGE_EXTENSIONS,
  MAX_FILES_PER_UPLOAD,
} from '../../../../composables/upload/FileValidator';

const mockDialogOpen = vi.mocked(dialogOpen);
const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset().mockResolvedValue({ width: 100, height: 80 });
});

describe('常量', () => {
  it('VALID_IMAGE_EXTENSIONS 包含常见图片扩展', () => {
    for (const ext of ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff', 'ico', 'avif']) {
      expect(VALID_IMAGE_EXTENSIONS).toContain(ext);
    }
  });

  it('MAX_FILES_PER_UPLOAD 为 200', () => {
    expect(MAX_FILES_PER_UPLOAD).toBe(200);
  });
});

describe('filterValidFiles', () => {
  it('按扩展名区分 valid / invalid', async () => {
    const result = await filterValidFiles([
      '/a.png', '/b.JPG', '/c.txt', '/no-ext',
      '/d.GIF', '/e.webp', '/f.bmp', '/g.avif', '/h.svg',
    ]);
    expect(result.valid.sort()).toEqual([
      '/a.png',
      '/b.JPG',
      '/d.GIF',
      '/e.webp',
      '/f.bmp',
      '/g.avif',
      '/h.svg',
    ].sort());
    expect(result.invalid.sort()).toEqual(['/c.txt', '/no-ext'].sort());
  });

  it('空数组返回空结果', async () => {
    const result = await filterValidFiles([]);
    expect(result).toEqual({ valid: [], invalid: [], truncatedCount: 0 });
  });

  it('带路径的文件名正确取扩展', async () => {
    const result = await filterValidFiles(['C:\\path\\image.png', '/unix/path/photo.jpeg']);
    expect(result.valid).toEqual(['C:\\path\\image.png', '/unix/path/photo.jpeg']);
  });

  it('路径中带点但无扩展名 → invalid', async () => {
    const result = await filterValidFiles(['/weird/file.with.multiple/dots']);
    expect(result.invalid).toContain('/weird/file.with.multiple/dots');
  });
  it('rejects files whose extension looks valid but image headers cannot be read', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('invalid image header'));

    const result = await filterValidFiles(['/tmp/fake.png']);

    expect(result.valid).toEqual([]);
    expect(result.invalid).toEqual(['/tmp/fake.png']);
  });

  it('达到单次上传上限后不继续读取图片头', async () => {
    const files = Array.from({ length: MAX_FILES_PER_UPLOAD + 5 }, (_, index) => `/tmp/${index}.jpg`);

    const result = await filterValidFiles(files);

    expect(mockInvoke).toHaveBeenCalledTimes(MAX_FILES_PER_UPLOAD);
    expect(result.valid).toHaveLength(MAX_FILES_PER_UPLOAD);
    expect(result.truncatedCount).toBe(5);
  });
});

describe('selectFiles', () => {
  beforeEach(() => {
    mockDialogOpen.mockReset();
  });

  it('用户取消（返回 null）→ 返回 null', async () => {
    mockDialogOpen.mockResolvedValue(null);
    expect(await selectFiles()).toBeNull();
  });

  it('单个文件返回长度 1 的数组', async () => {
    mockDialogOpen.mockResolvedValue('/single.png' as any);
    expect(await selectFiles()).toEqual(['/single.png']);
  });

  it('多文件直接返回数组', async () => {
    mockDialogOpen.mockResolvedValue(['/a.png', '/b.png'] as any);
    expect(await selectFiles()).toEqual(['/a.png', '/b.png']);
  });

  it('异常时通过 toast.showConfig 上报并返回 null', async () => {
    const toast = { showConfig: vi.fn() } as any;
    mockDialogOpen.mockRejectedValue(new Error('EACCES'));
    const result = await selectFiles(toast);
    expect(result).toBeNull();
    expect(toast.showConfig).toHaveBeenCalledWith('error', expect.anything());
  });

  it('异常但未传 toast → 不抛错', async () => {
    mockDialogOpen.mockRejectedValue(new Error('x'));
    const result = await selectFiles();
    expect(result).toBeNull();
  });

  it('传给 dialogOpen 的 filter 包含图片扩展', async () => {
    mockDialogOpen.mockResolvedValue(null);
    await selectFiles();
    const opts = mockDialogOpen.mock.calls[0][0] as any;
    expect(opts.multiple).toBe(true);
    expect(opts.filters[0].extensions).toEqual([...VALID_IMAGE_EXTENSIONS]);
  });
});
