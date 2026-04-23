import { describe, it, expect, vi, beforeEach } from 'vitest';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import {
  filterValidFiles,
  selectFiles,
  VALID_IMAGE_EXTENSIONS,
  MAX_FILES_PER_UPLOAD,
} from '../../../../composables/upload/FileValidator';

const mockDialogOpen = vi.mocked(dialogOpen);

describe('常量', () => {
  it('VALID_IMAGE_EXTENSIONS 包含常见图片扩展', () => {
    for (const ext of ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']) {
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
      '/d.GIF', '/e.webp', '/f.bmp',
    ]);
    expect(result.valid.sort()).toEqual(['/a.png', '/b.JPG', '/d.GIF', '/e.webp', '/f.bmp'].sort());
    expect(result.invalid.sort()).toEqual(['/c.txt', '/no-ext'].sort());
  });

  it('空数组返回空结果', async () => {
    const result = await filterValidFiles([]);
    expect(result).toEqual({ valid: [], invalid: [] });
  });

  it('带路径的文件名正确取扩展', async () => {
    const result = await filterValidFiles(['C:\\path\\image.png', '/unix/path/photo.jpeg']);
    expect(result.valid).toEqual(['C:\\path\\image.png', '/unix/path/photo.jpeg']);
  });

  it('路径中带点但无扩展名 → invalid', async () => {
    const result = await filterValidFiles(['/weird/file.with.multiple/dots']);
    expect(result.invalid).toContain('/weird/file.with.multiple/dots');
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
