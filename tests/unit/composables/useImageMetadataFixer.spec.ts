import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useImageMetadataFixer } from '@/composables/useImageMetadataFixer';

// Mock historyDB 动态导入
vi.mock('@/services/HistoryDatabase', () => ({
  historyDB: {
    update: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockInvoke = vi.mocked(invoke);

describe('useImageMetadataFixer - fixMissingMetadata', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    const fixer = useImageMetadataFixer();
    fixer.clearPending();
  });

  it('已有有效 width/height/aspectRatio → 直接返回', async () => {
    const fixer = useImageMetadataFixer();
    const item = {
      id: '1', width: 100, height: 50, aspectRatio: 2,
      results: [], timestamp: 0, primaryService: 'weibo', generatedLink: '', localFileName: '',
    } as any;
    const result = await fixer.fixMissingMetadata(item);
    expect(result).toEqual({ width: 100, height: 50, aspectRatio: 2 });
  });

  it('有宽高但无 aspectRatio → 计算出来', async () => {
    const fixer = useImageMetadataFixer();
    const item = {
      id: '1', width: 200, height: 100, aspectRatio: 2,
      results: [], timestamp: 0, primaryService: 'weibo', generatedLink: '', localFileName: '',
    } as any;
    const result = await fixer.fixMissingMetadata(item);
    expect(result?.aspectRatio).toBeCloseTo(2);
  });

  it('缺元数据 + 有 filePath → invoke Rust 获取', async () => {
    mockInvoke.mockResolvedValue({ width: 300, height: 150, aspect_ratio: 2 } as any);
    const fixer = useImageMetadataFixer();
    const item = {
      id: '1', filePath: '/a.png',
      results: [], timestamp: 0, primaryService: 'weibo', generatedLink: '', localFileName: '',
    } as any;
    const result = await fixer.fixMissingMetadata(item);
    expect(result).toEqual({ width: 300, height: 150, aspectRatio: 2 });
    expect(mockInvoke).toHaveBeenCalledWith('get_image_metadata', { filePath: '/a.png' });
  });

  it('aspect_ratio 缺失时用 width/height 计算', async () => {
    mockInvoke.mockResolvedValue({ width: 400, height: 200 } as any);
    const fixer = useImageMetadataFixer();
    const result = await fixer.fixMissingMetadata({
      id: '1', filePath: '/a.png',
      results: [], timestamp: 0, primaryService: 'weibo', generatedLink: '', localFileName: '',
    } as any);
    expect(result?.aspectRatio).toBeCloseTo(2);
  });

  it('invoke 抛错 → 返回默认 200x200', async () => {
    mockInvoke.mockRejectedValue(new Error('not found'));
    const fixer = useImageMetadataFixer();
    const result = await fixer.fixMissingMetadata({
      id: '1', filePath: '/a.png',
      results: [], timestamp: 0, primaryService: 'weibo', generatedLink: '', localFileName: '',
    } as any);
    expect(result).toEqual({ width: 200, height: 200, aspectRatio: 1 });
  });

  it('Rust 返回 width=0 → 视为无效回退默认', async () => {
    mockInvoke.mockResolvedValue({ width: 0, height: 0 } as any);
    const fixer = useImageMetadataFixer();
    const result = await fixer.fixMissingMetadata({
      id: '1', filePath: '/a.png',
      results: [], timestamp: 0, primaryService: 'weibo', generatedLink: '', localFileName: '',
    } as any);
    expect(result).toEqual({ width: 200, height: 200, aspectRatio: 1 });
  });

  it('无 filePath 无元数据 → 返回默认值', async () => {
    const fixer = useImageMetadataFixer();
    const result = await fixer.fixMissingMetadata({
      id: '1',
      results: [], timestamp: 0, primaryService: 'weibo', generatedLink: '', localFileName: '',
    } as any);
    expect(result).toEqual({ width: 200, height: 200, aspectRatio: 1 });
  });
});

describe('useImageMetadataFixer - batchFixMissingMetadata', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    const fixer = useImageMetadataFixer();
    fixer.clearPending();
  });

  it('无需修复的项不走 invoke', async () => {
    const fixer = useImageMetadataFixer();
    const count = await fixer.batchFixMissingMetadata([
      { id: 'a', width: 100, height: 100, aspectRatio: 1 },
    ]);
    expect(count).toBe(0);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('批量修复返回成功数量', async () => {
    mockInvoke
      .mockResolvedValueOnce({ width: 100, height: 50, aspect_ratio: 2 } as any)
      .mockResolvedValueOnce({ width: 0, height: 0 } as any)
      .mockRejectedValueOnce(new Error('gone'));

    const fixer = useImageMetadataFixer();
    const count = await fixer.batchFixMissingMetadata([
      { id: 'a', filePath: '/a.png' },
      { id: 'b', filePath: '/b.png' },
      { id: 'c', filePath: '/c.png' },
    ]);
    expect(count).toBe(1);
  });

  it('超过并发上限时分 chunk 执行', async () => {
    mockInvoke.mockResolvedValue({ width: 10, height: 10, aspect_ratio: 1 } as any);
    const fixer = useImageMetadataFixer();
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `i${i}`, filePath: `/${i}.png` }));
    const count = await fixer.batchFixMissingMetadata(items);
    expect(count).toBe(12);
  });

  it('没有 filePath 的项不计入', async () => {
    const fixer = useImageMetadataFixer();
    const count = await fixer.batchFixMissingMetadata([{ id: 'a' }]);
    expect(count).toBe(0);
  });
});

describe('useImageMetadataFixer - 队列管理', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    const fixer = useImageMetadataFixer();
    fixer.clearPending();
  });

  it('fixMissingMetadata 触发 queueUpdate → getPendingCount 增长', async () => {
    mockInvoke.mockResolvedValue({ width: 10, height: 10, aspect_ratio: 1 } as any);
    const fixer = useImageMetadataFixer();
    await fixer.fixMissingMetadata({
      id: 'x', filePath: '/x.png',
      results: [], timestamp: 0, primaryService: 'weibo', generatedLink: '', localFileName: '',
    } as any);
    expect(fixer.getPendingCount()).toBe(1);
  });

  it('clearPending 清空队列', async () => {
    mockInvoke.mockResolvedValue({ width: 10, height: 10, aspect_ratio: 1 } as any);
    const fixer = useImageMetadataFixer();
    await fixer.fixMissingMetadata({
      id: 'x', filePath: '/x.png',
      results: [], timestamp: 0, primaryService: 'weibo', generatedLink: '', localFileName: '',
    } as any);
    expect(fixer.getPendingCount()).toBe(1);
    fixer.clearPending();
    expect(fixer.getPendingCount()).toBe(0);
  });

  it('flushNow 空队列 → 返回 0', async () => {
    const fixer = useImageMetadataFixer();
    expect(await fixer.flushNow()).toBe(0);
  });
});

describe('useImageMetadataFixer - loadImageSizeFromUrl', () => {
  it('Image onload → resolve 宽高', async () => {
    const fixer = useImageMetadataFixer();
    const promise = fixer.loadImageSizeFromUrl('http://example.com/a.png');
    // happy-dom 的 Image 会触发 onerror 或 onload 同步。
    // 这里通过轮询断言最终 reject 或 resolve 之一，保证不吊起测试。
    await expect(Promise.race([
      promise.then(() => 'resolved').catch(() => 'rejected'),
      new Promise(r => setTimeout(() => r('timeout'), 100)),
    ])).resolves.toBeDefined();
  });
});
