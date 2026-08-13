import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile } from '@tauri-apps/plugin-fs';
import {
  getInvokeMock,
  getListenMock,
  resetTauriMocks,
  utf8Bytes,
} from '../../helpers/tauriMock';
import { NON_UTF8_ERROR_MESSAGE } from '@/composables/md-rescue/mdTextIo';

const toastMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const mruMocks = vi.hoisted(() => ({
  recordMruEntry: vi.fn(),
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => toastMocks,
}));

vi.mock('@/composables/md-rescue/useMdRescueMru', () => ({
  recordMruEntry: mruMocks.recordMruEntry,
}));

import {
  getFileName,
  isMarkdownFile,
  wrapLinksWithFile,
  collectLinksFromFiles,
  useMdFileLoader,
} from '@/composables/md-rescue/useMdFileLoader';
import {
  collectProgress,
  fileContent,
  filePath,
  folderPath,
  imageLinks,
  includeCodeBlocks,
  includeSubfolders,
  isCollecting,
  mdFiles,
  mode,
  phase,
  readyFiles,
  scanProgress,
  scanStage,
  setCollectCancelled,
  skippedDirs,
} from '@/composables/md-rescue/shared';
import type { MdImageLink } from '@/types/linkCheck';

const mockReadFile = vi.mocked(readFile);

/** GBK 编码的“中文”，在 UTF-8 下是非法字节序列 */
const GBK_BYTES = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);

describe('getFileName', () => {
  it('从 POSIX 路径取文件名', () => {
    expect(getFileName('/foo/bar/baz.md')).toBe('baz.md');
  });

  it('从 Windows 路径取文件名', () => {
    expect(getFileName('C:\\docs\\notes.md')).toBe('notes.md');
  });

  it('无分隔符时返回原字符串', () => {
    expect(getFileName('onlyfile.md')).toBe('onlyfile.md');
  });

  it('混合斜杠路径', () => {
    expect(getFileName('C:\\docs/sub/a.md')).toBe('a.md');
  });
});

describe('isMarkdownFile', () => {
  it('识别 .md', () => {
    expect(isMarkdownFile('a.md')).toBe(true);
    expect(isMarkdownFile('/dir/file.MD')).toBe(true);
  });

  it('识别 .markdown', () => {
    expect(isMarkdownFile('readme.markdown')).toBe(true);
  });

  it('其他扩展名返回 false', () => {
    expect(isMarkdownFile('a.txt')).toBe(false);
    expect(isMarkdownFile('photo.png')).toBe(false);
    expect(isMarkdownFile('a')).toBe(false);
  });
});

describe('wrapLinksWithFile', () => {
  it('为每个 link 附加 sourceFile 和 sourceFileName', () => {
    const links: MdImageLink[] = [
      { originalText: '![](a)', url: 'a', altText: '', lineNumber: 1, syntax: 'markdown', context: 'normal' },
      { originalText: '![](b)', url: 'b', altText: '', lineNumber: 2, syntax: 'markdown', context: 'normal' },
    ];
    const result = wrapLinksWithFile(links, '/docs/notes.md');
    expect(result).toHaveLength(2);
    expect(result[0].sourceFile).toBe('/docs/notes.md');
    expect(result[0].sourceFileName).toBe('notes.md');
    expect(result[1].sourceFileName).toBe('notes.md');
  });

  it('空数组返回空数组', () => {
    expect(wrapLinksWithFile([], '/a.md')).toEqual([]);
  });
});

describe('collectLinksFromFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCollectCancelled(false);
    includeCodeBlocks.value = false;
  });

  it('空数组直接返回空数组', async () => {
    const result = await collectLinksFromFiles([]);
    expect(result).toEqual([]);
  });

  it('读取每个文件并提取 image link', async () => {
    mockReadFile
      .mockResolvedValueOnce(utf8Bytes('![alt](https://x.com/a.png)'))
      .mockResolvedValueOnce(utf8Bytes('![](https://y.com/b.jpg)'));

    const onProgress = vi.fn();
    const result = await collectLinksFromFiles(['/a.md', '/b.md'], onProgress);

    expect(result).toHaveLength(2);
    expect(result.map(r => r.url).sort()).toEqual(['https://x.com/a.png', 'https://y.com/b.jpg']);
    expect(onProgress).toHaveBeenCalled();
    const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1];
    expect(lastCall[0]).toBe(2); // processed
  });

  it('读取失败时记录并继续', async () => {
    mockReadFile
      .mockRejectedValueOnce(new Error('EACCES'))
      .mockResolvedValueOnce(utf8Bytes('![](https://ok.com/a.png)'));

    const result = await collectLinksFromFiles(['/bad.md', '/ok.md']);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://ok.com/a.png');
  });

  it('非 UTF-8 文件计入读取失败，不把乱码内容带进后续修复', async () => {
    mockReadFile
      .mockResolvedValueOnce(GBK_BYTES)
      .mockResolvedValueOnce(utf8Bytes('![](https://ok.com/a.png)'));
    const onFileError = vi.fn();

    const result = await collectLinksFromFiles(['/gbk.md', '/ok.md'], undefined, { onFileError });

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://ok.com/a.png');
    expect(onFileError).toHaveBeenCalledWith('/gbk.md', expect.objectContaining({
      message: NON_UTF8_ERROR_MESSAGE,
    }));
  });

  it('已取消 → 跳过文件读取', async () => {
    setCollectCancelled(true);
    mockReadFile.mockResolvedValue(utf8Bytes('![](https://x.com/a.png)'));

    const result = await collectLinksFromFiles(['/a.md', '/b.md']);
    expect(result).toEqual([]);
    setCollectCancelled(false);
  });

  it('读取后取消 → 不收集该文件结果', async () => {
    let readCount = 0;
    mockReadFile.mockImplementation(async () => {
      readCount++;
      if (readCount === 2) setCollectCancelled(true);
      return utf8Bytes('![](https://x.com/a.png)');
    });

    const result = await collectLinksFromFiles(['/a.md', '/b.md', '/c.md']);
    // 第 1 个始终成功；取消后续
    expect(result.length).toBeLessThanOrEqual(2);
    setCollectCancelled(false);
  });
});

function resetLoaderState(): void {
  mode.value = null;
  filePath.value = null;
  folderPath.value = null;
  mdFiles.value = [];
  fileContent.value = null;
  imageLinks.value = [];
  isCollecting.value = false;
  collectProgress.value = null;
  includeSubfolders.value = true;
  includeCodeBlocks.value = false;
  phase.value = 'idle';
  scanStage.value = 'checking';
  scanProgress.value = null;
  readyFiles.value = new Set();
  skippedDirs.value = [];
  setCollectCancelled(false);
}

describe('useMdFileLoader - loader state and failures', () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.clearAllMocks();
    resetLoaderState();
  });

  it('loadFilePath 非 Markdown 文件返回 false 并提示空入口', async () => {
    const { loadFilePath } = useMdFileLoader();

    const ok = await loadFilePath('C:/docs/a.txt');

    expect(ok).toBe(false);
    expect(toastMocks.info).toHaveBeenCalledWith('不支持的文件类型', '请拖放 Markdown 文件（.md / .markdown）');
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('loadFilePath 读取成功但无图片链接时保留文件状态并提示空状态', async () => {
    mockReadFile.mockResolvedValue(utf8Bytes('plain markdown without image'));
    const { loadFilePath } = useMdFileLoader();

    const ok = await loadFilePath('C:/docs/a.md');

    expect(ok).toBe(true);
    expect(mode.value).toBe('file');
    expect(filePath.value).toBe('C:/docs/a.md');
    expect(fileContent.value).toBe('plain markdown without image');
    expect(imageLinks.value).toEqual([]);
    expect(mruMocks.recordMruEntry).toHaveBeenCalledWith('C:/docs/a.md', 'file');
    expect(toastMocks.info).toHaveBeenCalledWith('未找到图片链接', '该文件中没有图片链接');
  });

  it('loadFilePath 读取失败时返回 false 并提示读取失败', async () => {
    mockReadFile.mockRejectedValue(new Error('EACCES'));
    const { loadFilePath } = useMdFileLoader();

    const ok = await loadFilePath('C:/docs/a.md');

    expect(ok).toBe(false);
    expect(toastMocks.error).toHaveBeenCalledWith('文件加载失败', 'Error: EACCES');
  });

  it('loadFilePath 遇到非 UTF-8 文件时直接报编码不受支持', async () => {
    mockReadFile.mockResolvedValue(GBK_BYTES);
    const { loadFilePath } = useMdFileLoader();

    const ok = await loadFilePath('C:/docs/gbk.md');

    expect(ok).toBe(false);
    expect(toastMocks.error).toHaveBeenCalledWith('文件加载失败', NON_UTF8_ERROR_MESSAGE);
    expect(fileContent.value).toBeNull();
  });

  it('loadFilePath 保留原文件的 UTF-8 BOM 语义：内存内容不带 BOM', async () => {
    mockReadFile.mockResolvedValue(utf8Bytes('![](https://x.com/a.png)', true));
    const { loadFilePath } = useMdFileLoader();

    const ok = await loadFilePath('C:/docs/bom.md');

    expect(ok).toBe(true);
    expect(fileContent.value).toBe('![](https://x.com/a.png)');
  });

  it('loadFolderPath 扫描被 Rust 侧取消时清理收集状态和监听器', async () => {
    const unlisten = vi.fn();
    getListenMock().mockResolvedValue(unlisten);
    getInvokeMock().mockResolvedValue({
      files: [],
      totalFiles: 0,
      totalLinks: 0,
      elapsedMs: 1,
      cancelled: true,
      skippedDirs: [],
    });
    const { loadFolderPath } = useMdFileLoader();

    const ok = await loadFolderPath('C:/vault');

    expect(ok).toBe(false);
    expect(getInvokeMock()).toHaveBeenCalledWith('scan_md_folder', {
      dir: 'C:/vault',
      includeSubfolders: true,
      includeCodeBlocks: false,
    });
    expect(unlisten).toHaveBeenCalled();
    expect(isCollecting.value).toBe(false);
    expect(collectProgress.value).toBeNull();
  });

  it('loadFolderPath 无 MD 文件时返回 false 并保存跳过目录信息', async () => {
    getInvokeMock().mockResolvedValue({
      files: [],
      totalFiles: 0,
      totalLinks: 0,
      elapsedMs: 2,
      cancelled: false,
      skippedDirs: ['C:/vault/private'],
    });
    const { loadFolderPath } = useMdFileLoader();

    const ok = await loadFolderPath('C:/vault');

    expect(ok).toBe(false);
    expect(folderPath.value).toBe('C:/vault');
    expect(skippedDirs.value).toEqual(['C:/vault/private']);
    expect(toastMocks.info).toHaveBeenCalledWith('未找到 MD 文件', '该文件夹中没有 Markdown 文件');
    expect(isCollecting.value).toBe(false);
  });

  it('loadFolderPath 找到 MD 但全部读取失败时给出读取失败提示', async () => {
    getInvokeMock().mockResolvedValue({
      files: [],
      totalFiles: 2,
      totalLinks: 0,
      elapsedMs: 2,
      cancelled: false,
      skippedDirs: [],
      readFailedFiles: ['C:/vault/a.md', 'C:/vault/b.md'],
    });
    const { loadFolderPath } = useMdFileLoader();

    const ok = await loadFolderPath('C:/vault');

    expect(ok).toBe(false);
    expect(toastMocks.warn).toHaveBeenCalledWith(
      'Markdown 文件读取失败',
      '找到 2 个 Markdown 文件，但都读取失败',
    );
    expect(toastMocks.info).not.toHaveBeenCalledWith('未找到 MD 文件', expect.any(String));
  });

  it('loadFolderPath 部分文件读取失败且无图片链接时说明混合原因', async () => {
    getInvokeMock().mockResolvedValue({
      files: [{ filePath: 'C:/vault/a.md', fileName: 'a.md', links: [] }],
      totalFiles: 2,
      totalLinks: 0,
      elapsedMs: 2,
      cancelled: false,
      skippedDirs: [],
      readFailedFiles: ['C:/vault/b.md'],
    });
    const { loadFolderPath } = useMdFileLoader();

    const ok = await loadFolderPath('C:/vault');

    expect(ok).toBe(true);
    expect(toastMocks.warn).toHaveBeenCalledWith(
      '未找到可修复链接',
      '1 个文件无图片链接，1 个文件读取失败',
    );
  });

  it('loadFolderPath 扫描中再次调用会拒绝防重入', async () => {
    isCollecting.value = true;
    const { loadFolderPath } = useMdFileLoader();

    const ok = await loadFolderPath('C:/vault');

    expect(ok).toBe(false);
    expect(toastMocks.warn).toHaveBeenCalledWith('扫描进行中', '请等待当前扫描完成或取消后再开始新的扫描');
    expect(getInvokeMock()).not.toHaveBeenCalled();
  });
});
