import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '@/uploaders/base/types';

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock errors 模块
vi.mock('@/types/errors', () => ({
  getErrorMessage: (err: unknown) => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'object' && err !== null && 'data' in err) {
      return (err as { data: { message: string } }).data.message;
    }
    return String(err);
  },
  isAuthError: (err: unknown) => {
    return typeof err === 'object' && err !== null && 'type' in err && (err as { type: string }).type === 'AUTH';
  },
}));

// 动态 import BaseUploader（mock 必须在 import 前注册）
const { BaseUploader } = await import('@/uploaders/base/BaseUploader');

const mockedInvoke = vi.mocked(invoke);
const mockedListen = vi.mocked(listen);

// ─── 创建测试用的具体子类 ────────────────────────────────────

class TestUploader extends BaseUploader {
  readonly serviceId = 'test';
  readonly serviceName = '测试图床';

  protected getRustCommand(): string {
    return 'upload_to_test';
  }

  async validateConfig(config: Record<string, unknown>): Promise<ValidationResult> {
    if (!config?.token) {
      return { valid: false, missingFields: ['token'], errors: ['缺少 token'] };
    }
    return { valid: true };
  }

  async upload(
    filePath: string,
    options: UploadOptions,
    onProgress?: ProgressCallback,
  ): Promise<UploadResult> {
    const config = options.config as { token?: string };
    const rustResult = (await this.uploadViaRust(
      filePath,
      { testToken: config.token },
      onProgress,
    )) as { key?: string; url?: string } | undefined;
    return {
      serviceId: this.serviceId,
      fileKey: rustResult?.key ?? 'default-key',
      url: rustResult?.url ?? 'https://test.com/img.png',
    };
  }

  getPublicUrl(result: UploadResult): string {
    return result.url;
  }

  // 暴露 protected 方法用于单元测试
  exposedIsEmpty(value: string | undefined | null): boolean {
    return this.isEmpty(value);
  }

  exposedGenerateUniqueId(): string {
    return this.generateUniqueId();
  }
}

// ─── 测试用例 ────────────────────────────────────────────────

describe('BaseUploader', () => {
  let uploader: TestUploader;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    uploader = new TestUploader();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── uploadViaRust 基本流程 ─────────────────────────────

  describe('uploadViaRust 基本流程', () => {
    it('成功上传时调用 invoke 并返回结果', async () => {
      const rustResult = { key: 'abc123', url: 'https://test.com/abc.jpg' };
      mockedInvoke.mockResolvedValue(rustResult);
      mockedListen.mockResolvedValue(vi.fn());

      const result = await uploader.upload('/tmp/test.jpg', {
        config: { token: 'test-token' },
      });

      expect(mockedInvoke).toHaveBeenCalledWith(
        'upload_to_test',
        expect.objectContaining({
          filePath: '/tmp/test.jpg',
          testToken: 'test-token',
        }),
      );
      expect(result.serviceId).toBe('test');
      expect(result.fileKey).toBe('abc123');
      expect(result.url).toBe('https://test.com/abc.jpg');
    });

    it('invoke 参数包含自动生成的 uploadId', async () => {
      mockedInvoke.mockResolvedValue({});
      mockedListen.mockResolvedValue(vi.fn());

      await uploader.upload('/tmp/test.jpg', { config: { token: 't' } });

      const callArgs = mockedInvoke.mock.calls[0][1] as Record<string, unknown>;
      expect(callArgs.id).toMatch(/^test_\d+_[a-z0-9]+$/);
    });
  });

  // ─── 进度事件监听 ──────────────────────────────────────

  describe('进度事件监听', () => {
    it('有 onProgress 时注册 listen', async () => {
      mockedInvoke.mockResolvedValue({});
      mockedListen.mockResolvedValue(vi.fn());

      const onProgress = vi.fn();
      await uploader.upload('/tmp/test.jpg', { config: { token: 't' } }, onProgress);

      expect(mockedListen).toHaveBeenCalledWith('upload://progress', expect.any(Function));
    });

    it('无 onProgress 时不注册 listen', async () => {
      mockedInvoke.mockResolvedValue({});

      await uploader.upload('/tmp/test.jpg', { config: { token: 't' } });

      expect(mockedListen).not.toHaveBeenCalled();
    });

    it('进度事件触发 onProgress 回调', async () => {
      let progressHandler: ((event: { payload: Record<string, unknown> }) => void) | undefined;

      mockedListen.mockImplementation(async (_event, handler) => {
        progressHandler = handler as typeof progressHandler;
        return vi.fn();
      });

      // invoke 延迟解析，让我们有时间触发进度事件
      mockedInvoke.mockImplementation(async (_cmd, args) => {
        const uploadId = (args as Record<string, unknown>).id as string;
        // 模拟 Rust 发送进度事件
        progressHandler?.({
          payload: { id: uploadId, progress: 50, total: 100, step: '上传中...' },
        });
        return { key: 'k', url: 'u' };
      });

      const onProgress = vi.fn();
      await uploader.upload('/tmp/test.jpg', { config: { token: 't' } }, onProgress);

      // 第一次调用是初始 0%
      expect(onProgress).toHaveBeenCalledWith(0, '准备上传...');
      // 进度事件触发 50%
      expect(onProgress).toHaveBeenCalledWith(50, '上传中...', undefined, undefined);
      // 完成时 100%
      expect(onProgress).toHaveBeenCalledWith(100, '完成', undefined, undefined);
    });

    it('只处理匹配 uploadId 的进度事件', async () => {
      let progressHandler: ((event: { payload: Record<string, unknown> }) => void) | undefined;

      mockedListen.mockImplementation(async (_event, handler) => {
        progressHandler = handler as typeof progressHandler;
        return vi.fn();
      });

      mockedInvoke.mockImplementation(async () => {
        // 发送不匹配的进度事件
        progressHandler?.({
          payload: { id: 'other_upload_id', progress: 99, total: 100 },
        });
        return {};
      });

      const onProgress = vi.fn();
      await uploader.upload('/tmp/test.jpg', { config: { token: 't' } }, onProgress);

      // 不应该有 99% 的回调（不匹配的事件）
      const percentCalls = onProgress.mock.calls.map((c) => c[0]);
      expect(percentCalls).not.toContain(99);
    });

    it('进度永不倒退', async () => {
      let progressHandler: ((event: { payload: Record<string, unknown> }) => void) | undefined;

      mockedListen.mockImplementation(async (_event, handler) => {
        progressHandler = handler as typeof progressHandler;
        return vi.fn();
      });

      mockedInvoke.mockImplementation(async (_cmd, args) => {
        const uploadId = (args as Record<string, unknown>).id as string;
        // 先发 70%，再发 30%（模拟乱序事件）
        progressHandler?.({ payload: { id: uploadId, progress: 70, total: 100 } });
        progressHandler?.({ payload: { id: uploadId, progress: 30, total: 100 } });
        return {};
      });

      const onProgress = vi.fn();
      await uploader.upload('/tmp/test.jpg', { config: { token: 't' } }, onProgress);

      // 过滤出百分比回调（排除初始 0 和最终 100）
      const percentCalls = onProgress.mock.calls
        .map((c) => c[0] as number)
        .filter((p) => p > 0 && p < 100);

      // 应该都 >= 70（第二个 30% 应该被忽略）
      for (const p of percentCalls) {
        expect(p).toBeGreaterThanOrEqual(70);
      }
    });
  });

  // ─── 自动蠕动进度（Auto-Creep）─────────────────────────

  describe('自动蠕动进度', () => {
    it('200ms 间隔自动蠕动进度', async () => {
      mockedListen.mockResolvedValue(vi.fn());

      // invoke 不立即 resolve，让 setInterval 有机会运行
      let resolveInvoke!: (value: unknown) => void;
      mockedInvoke.mockReturnValue(new Promise((resolve) => {
        resolveInvoke = resolve;
      }));

      const onProgress = vi.fn();
      const uploadPromise = uploader.upload('/tmp/test.jpg', { config: { token: 't' } }, onProgress);

      // 等待 listen 的微任务完成
      await vi.advanceTimersByTimeAsync(0);

      // 初始调用 0%
      expect(onProgress).toHaveBeenCalledWith(0, '准备上传...');

      // 推进 200ms，触发第一次蠕动
      await vi.advanceTimersByTimeAsync(200);
      // 蠕动后进度应该 > 0 但 < 95
      const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1];
      expect(lastCall[0]).toBeGreaterThan(0);
      expect(lastCall[0]).toBeLessThan(95);

      // 完成上传
      resolveInvoke({});
      await uploadPromise;
    });

    it('蠕动不超过 95%', async () => {
      mockedListen.mockResolvedValue(vi.fn());

      let resolveInvoke!: (value: unknown) => void;
      mockedInvoke.mockReturnValue(new Promise((resolve) => {
        resolveInvoke = resolve;
      }));

      const onProgress = vi.fn();
      const uploadPromise = uploader.upload('/tmp/test.jpg', { config: { token: 't' } }, onProgress);

      // 推进大量时间，模拟长时间无响应
      await vi.advanceTimersByTimeAsync(100_000);

      const allPercents = onProgress.mock.calls.map((c) => c[0] as number);
      // 排除初始 0%，所有蠕动进度应 <= 95
      for (const p of allPercents) {
        if (p > 0) expect(p).toBeLessThanOrEqual(95);
      }

      resolveInvoke({});
      await uploadPromise;
    });
  });

  // ─── 资源清理 ──────────────────────────────────────────

  describe('资源清理', () => {
    it('上传成功后清理 unlisten 和 interval', async () => {
      const unlistenFn = vi.fn();
      mockedListen.mockResolvedValue(unlistenFn);
      mockedInvoke.mockResolvedValue({});

      const onProgress = vi.fn();
      await uploader.upload('/tmp/test.jpg', { config: { token: 't' } }, onProgress);

      expect(unlistenFn).toHaveBeenCalled();
    });

    it('上传失败后也清理资源', async () => {
      const unlistenFn = vi.fn();
      mockedListen.mockResolvedValue(unlistenFn);
      mockedInvoke.mockRejectedValue(new Error('网络错误'));

      const onProgress = vi.fn();
      await expect(
        uploader.upload('/tmp/test.jpg', { config: { token: 't' } }, onProgress),
      ).rejects.toThrow();

      expect(unlistenFn).toHaveBeenCalled();
    });

    it('listen 失败时不中断上传', async () => {
      mockedListen.mockRejectedValue(new Error('listen failed'));
      mockedInvoke.mockResolvedValue({ key: 'k', url: 'u' });

      const onProgress = vi.fn();
      const result = await uploader.upload('/tmp/test.jpg', { config: { token: 't' } }, onProgress);

      expect(result.url).toBe('u');
    });
  });

  // ─── 错误处理 ──────────────────────────────────────────

  describe('错误处理', () => {
    it('普通错误包装为 "上传失败" 消息', async () => {
      mockedInvoke.mockRejectedValue(new Error('连接超时'));

      await expect(
        uploader.upload('/tmp/test.jpg', { config: { token: 't' } }),
      ).rejects.toThrow('测试图床上传失败: 连接超时');
    });

    it('认证错误包装为 "认证失败" 消息', async () => {
      mockedInvoke.mockRejectedValue({ type: 'AUTH', data: { message: 'Cookie 已过期' } });

      await expect(
        uploader.upload('/tmp/test.jpg', { config: { token: 't' } }),
      ).rejects.toThrow('认证失败: Cookie 已过期');
    });
  });

  // ─── validateConfig（子类实现）────────────────────────

  describe('validateConfig', () => {
    it('配置完整时返回 valid: true', async () => {
      const result = await uploader.validateConfig({ token: 'abc' });
      expect(result.valid).toBe(true);
    });

    it('缺少 token 时返回 valid: false', async () => {
      const result = await uploader.validateConfig({});
      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain('token');
    });
  });

  // ─── 辅助方法 ──────────────────────────────────────────

  describe('辅助方法', () => {
    it('isEmpty 正确判断空值', () => {
      expect(uploader.exposedIsEmpty('')).toBe(true);
      expect(uploader.exposedIsEmpty('   ')).toBe(true);
      expect(uploader.exposedIsEmpty(undefined)).toBe(true);
      expect(uploader.exposedIsEmpty(null)).toBe(true);
      expect(uploader.exposedIsEmpty('abc')).toBe(false);
    });

    it('generateUniqueId 格式正确', () => {
      const id = uploader.exposedGenerateUniqueId();
      expect(id).toMatch(/^test_\d+_[a-z0-9]+$/);
    });

    it('generateUniqueId 每次不同', () => {
      const id1 = uploader.exposedGenerateUniqueId();
      const id2 = uploader.exposedGenerateUniqueId();
      expect(id1).not.toBe(id2);
    });
  });

  // ─── testConnection 默认实现 ───────────────────────────

  describe('testConnection 默认实现', () => {
    it('默认返回未实现', async () => {
      const result = await uploader.testConnection();
      expect(result.success).toBe(false);
      expect(result.error).toContain('暂未实现');
    });
  });
});
