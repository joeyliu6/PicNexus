import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readTextFile } from '@tauri-apps/plugin-fs';
import {
  getFileName,
  isMarkdownFile,
  wrapLinksWithFile,
  collectLinksFromFiles,
} from '../../../../composables/md-rescue/useMdFileLoader';
import { includeCodeBlocks, setCollectCancelled } from '../../../../composables/md-rescue/shared';

const mockReadTextFile = vi.mocked(readTextFile);

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
    const links = [
      { originalText: '![](a)', url: 'a', altText: '', lineNumber: 1, syntax: 'markdown', context: 'normal' } as any,
      { originalText: '![](b)', url: 'b', altText: '', lineNumber: 2, syntax: 'markdown', context: 'normal' } as any,
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
    mockReadTextFile
      .mockResolvedValueOnce('![alt](https://x.com/a.png)')
      .mockResolvedValueOnce('![](https://y.com/b.jpg)');

    const onProgress = vi.fn();
    const result = await collectLinksFromFiles(['/a.md', '/b.md'], onProgress);

    expect(result).toHaveLength(2);
    expect(result.map(r => r.url).sort()).toEqual(['https://x.com/a.png', 'https://y.com/b.jpg']);
    expect(onProgress).toHaveBeenCalled();
    const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1];
    expect(lastCall[0]).toBe(2); // processed
  });

  it('读取失败时记录并继续', async () => {
    mockReadTextFile
      .mockRejectedValueOnce(new Error('EACCES'))
      .mockResolvedValueOnce('![](https://ok.com/a.png)');

    const result = await collectLinksFromFiles(['/bad.md', '/ok.md']);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://ok.com/a.png');
  });

  it('已取消 → 跳过文件读取', async () => {
    setCollectCancelled(true);
    mockReadTextFile.mockResolvedValue('![](https://x.com/a.png)');

    const result = await collectLinksFromFiles(['/a.md', '/b.md']);
    expect(result).toEqual([]);
    setCollectCancelled(false);
  });

  it('读取后取消 → 不收集该文件结果', async () => {
    let readCount = 0;
    mockReadTextFile.mockImplementation(async () => {
      readCount++;
      if (readCount === 2) setCollectCancelled(true);
      return '![](https://x.com/a.png)';
    });

    const result = await collectLinksFromFiles(['/a.md', '/b.md', '/c.md']);
    // 第 1 个始终成功；取消后续
    expect(result.length).toBeLessThanOrEqual(2);
    setCollectCancelled(false);
  });
});
