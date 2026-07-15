import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import {
  getDialogOpenMock,
  getInvokeMock,
  setupInvokeHandler,
} from '../helpers/tauriMock';
import type { CompressionPreset } from '@/config/types';
import type { CompressResult } from '@/composables/useCompressionTask';
import { useCompressionTask } from '@/composables/useCompressionTask';

const dialogOpenMock = getDialogOpenMock();
const invokeMock = getInvokeMock();

function makePreset(overrides: Partial<CompressionPreset> = {}): CompressionPreset {
  return {
    id: 'preset-1',
    name: '测试预设',
    quality: 82,
    outputFormat: 'webp',
    maxLongSide: 0,
    scalePercent: 100,
    skipIfSmallerKB: 0,
    stripExif: true,
    ...overrides,
  };
}

function makeResult(overrides: Partial<CompressResult> = {}): CompressResult {
  return {
    outputPath: 'C:/tmp/out.webp',
    originalSize: 1_000_000,
    compressedSize: 420_000,
    ratio: 0.42,
    width: 1600,
    height: 900,
    format: 'webp',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useCompressionTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('用户取消选择时返回 false，并保持重置后的空状态', async () => {
    dialogOpenMock.mockResolvedValue(null);
    const api = useCompressionTask(ref(makePreset()));

    await expect(api.selectAndCompress()).resolves.toBe(false);

    expect(api.status.value).toBe('compressing');
    expect(api.fileName.value).toBe('');
    expect(api.result.value).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('成功压缩：读取元数据计算缩放最长边、加载预览、清理临时文件并触发 onDone', async () => {
    dialogOpenMock.mockResolvedValue('C:/photos/original.jpg');
    const onDone = vi.fn();
    const cleanupPaths: string[][] = [];
    const compressResult = makeResult({ outputPath: 'C:/tmp/original.webp', ratio: 0.4 });

    setupInvokeHandler(async (cmd, args) => {
      if (cmd === 'get_image_metadata') return { width: 4000, height: 2600 };
      if (cmd === 'compress_image') {
        expect(args).toEqual({
          filePath: 'C:/photos/original.jpg',
          quality: 82,
          maxLongSide: 2000,
          outputFormat: 'webp',
          stripExif: true,
        });
        return compressResult;
      }
      if (cmd === 'read_image_as_base64') {
        const filePath = (args as { filePath: string }).filePath;
        return filePath.endsWith('original.webp') ? 'compressed-b64' : 'original-b64';
      }
      if (cmd === 'cleanup_compressed_files') {
        cleanupPaths.push((args as { filePaths: string[] }).filePaths);
        return undefined;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    const api = useCompressionTask(ref(makePreset({ scalePercent: 50 })), { onDone });

    await expect(api.selectAndCompress()).resolves.toBe(true);

    expect(api.fileName.value).toBe('original.jpg');
    expect(api.result.value).toEqual(compressResult);
    expect(api.originalSrc.value).toBe('original-b64');
    expect(api.compressedSrc.value).toBe('compressed-b64');
    expect(api.status.value).toBe('done');
    expect(api.getSaved()).toBe(60);
    expect(api.getIsLarger()).toBe(false);
    expect(api.formatSize(512)).toBe('512 B');
    expect(api.formatSize(1536)).toBe('1.5 KB');
    expect(api.formatSize(2 * 1024 * 1024)).toBe('2.00 MB');
    expect(cleanupPaths).toContainEqual(['C:/tmp/original.webp']);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('scalePercent 为 100 时不读取元数据，并使用 maxLongSide=0', async () => {
    dialogOpenMock.mockResolvedValue('C:/photos/a.png');
    setupInvokeHandler(async (cmd, args) => {
      if (cmd === 'compress_image') {
        expect(args).toEqual(expect.objectContaining({ maxLongSide: 0 }));
        return makeResult({ outputPath: 'C:/tmp/a.webp' });
      }
      if (cmd === 'read_image_as_base64') return 'b64';
      if (cmd === 'cleanup_compressed_files') return undefined;
      throw new Error(`unexpected command: ${cmd}`);
    });

    await useCompressionTask(ref(makePreset({ scalePercent: 100 }))).selectAndCompress();

    expect(invokeMock).not.toHaveBeenCalledWith('get_image_metadata', expect.anything());
  });

  it('压缩失败时进入 error 状态，保存错误消息并触发 onError', async () => {
    dialogOpenMock.mockResolvedValue('C:/photos/bad.jpg');
    const onError = vi.fn();
    setupInvokeHandler(async (cmd) => {
      if (cmd === 'compress_image') throw new Error('encoder crashed');
      if (cmd === 'read_image_as_base64') return 'original-b64';
      throw new Error(`unexpected command: ${cmd}`);
    });

    const api = useCompressionTask(ref(makePreset()), { onError });

    await expect(api.selectAndCompress()).resolves.toBe(true);

    expect(api.status.value).toBe('error');
    expect(api.errorMsg.value).toBe('encoder crashed');
    expect(api.result.value).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('较早的压缩任务完成晚于新任务时，不覆盖新结果，并清理旧临时文件', async () => {
    dialogOpenMock
      .mockResolvedValueOnce('C:/photos/old.jpg')
      .mockResolvedValueOnce('C:/photos/new.jpg');
    const oldCompress = deferred<CompressResult>();
    const cleanupPaths: string[][] = [];
    const newResult = makeResult({ outputPath: 'C:/tmp/new.webp', ratio: 1.1 });

    setupInvokeHandler(async (cmd, args) => {
      if (cmd === 'compress_image') {
        const filePath = (args as { filePath: string }).filePath;
        if (filePath.endsWith('old.jpg')) return oldCompress.promise;
        return newResult;
      }
      if (cmd === 'read_image_as_base64') {
        const filePath = (args as { filePath: string }).filePath;
        if (filePath.endsWith('new.webp')) return 'new-compressed-b64';
        return `${filePath}-original-b64`;
      }
      if (cmd === 'cleanup_compressed_files') {
        cleanupPaths.push((args as { filePaths: string[] }).filePaths);
        return undefined;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    const api = useCompressionTask(ref(makePreset()));
    const first = api.selectAndCompress();
    await Promise.resolve();
    const second = api.selectAndCompress();

    await expect(second).resolves.toBe(true);
    oldCompress.resolve(makeResult({ outputPath: 'C:/tmp/old.webp', ratio: 0.3 }));
    await expect(first).resolves.toBe(true);

    expect(api.fileName.value).toBe('new.jpg');
    expect(api.result.value).toEqual(newResult);
    expect(api.compressedSrc.value).toBe('new-compressed-b64');
    expect(api.getIsLarger()).toBe(true);
    expect(cleanupPaths).toContainEqual(['C:/tmp/new.webp']);
    expect(cleanupPaths).toContainEqual(['C:/tmp/old.webp']);
  });
});
