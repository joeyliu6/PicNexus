/**
 * 上传还没结束就点重试：首次上传与单图床重试并发写同一个队列项 / 同一条历史记录。
 *
 * 用真的 UploadQueueManager + processUploadQueue + RetryService + useHistorySaver，
 * 只把图床上传和数据库换成可控的假实现，验证两条链路交错时谁都不丢谁的结果。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryItem } from '@/config/types';
import type { UploadResult } from '@/uploaders/base/types';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';

const { db, uploadPlan, retryPlan } = vi.hoisted(() => ({
  db: new Map<string, HistoryItem>(),
  uploadPlan: new Map<string, Promise<UploadResult>>(),
  retryPlan: new Map<string, Promise<UploadResult>>(),
}));

vi.mock('@/services/database', () => ({
  historyDB: {
    getById: vi.fn(async (id: string) => structuredClone(db.get(id) ?? null)),
    insertOrIgnore: vi.fn(async (item: HistoryItem) => {
      if (db.has(item.id)) return false;
      db.set(item.id, structuredClone(item));
      return true;
    }),
    update: vi.fn(async (id: string, updates: Partial<HistoryItem>) => {
      const current = db.get(id);
      if (!current) throw new Error(`记录不存在: ${id}`);
      db.set(id, { ...current, ...structuredClone(updates) });
    }),
    updateResults: vi.fn(async (id: string, results: HistoryItem['results']) => {
      const current = db.get(id);
      if (!current) throw new Error(`记录不存在: ${id}`);
      db.set(id, { ...current, results: structuredClone(results) });
    }),
  },
}));

vi.mock('@/core/MultiServiceUploader', () => ({
  MultiServiceUploader: class {
    async uploadToMultipleServices(
      _filePath: string,
      services: string[],
      _config: unknown,
      onProgress?: (serviceId: string, percent: number, step?: string) => void,
      onServiceResult?: (result: unknown) => Promise<void>,
    ) {
      const results = await Promise.all(services.map(async serviceId => {
        onProgress?.(serviceId, 10, '开始上传...');
        let single;
        try {
          const result = await uploadPlan.get(serviceId)!;
          single = { serviceId, status: 'success' as const, result };
        } catch (error) {
          single = { serviceId, status: 'failed' as const, error: (error as Error).message };
        }
        await onServiceResult?.(single);
        return single;
      }));
      const primary = results.find(r => r.status === 'success');
      if (!primary || primary.status !== 'success') {
        const details = results.map(r => `  - ${r.serviceId}: ${'error' in r ? r.error : ''}`).join('\n');
        throw new Error(`所有图床上传均失败：\n${details}\n\n请检查网络连接和服务配置`);
      }
      const partialFailures = results
        .filter(r => r.status === 'failed')
        .map(r => ({ serviceId: r.serviceId, error: 'error' in r ? r.error : '' }));
      return {
        primaryService: primary.serviceId,
        primaryUrl: primary.result.url,
        results,
        isPartialSuccess: partialFailures.length > 0,
        partialFailures,
      };
    }

    retryUpload(_filePath: string, serviceId: string) {
      return retryPlan.get(serviceId)!;
    }
  },
}));

vi.mock('@/composables/image/useImageMetadata', () => ({
  getImageMetadata: vi.fn(async () => ({ width: 10, height: 10, aspect_ratio: 1, file_size: 100, format: 'png' })),
  clearImageMetadataCache: vi.fn(),
}));
vi.mock('@/composables/history/useHistory', () => ({ invalidateCache: vi.fn() }));
vi.mock('@/events/cacheEvents', () => ({ emitHistoryUpdated: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }));
vi.mock('@/utils/network', () => ({ checkNetworkConnectivity: vi.fn(async () => true) }));
vi.mock('@/utils/clipboardTempFile', () => ({ cleanupClipboardTempFile: vi.fn(async () => undefined) }));
vi.mock('@/composables/service/useServiceHealth', () => ({
  useServiceHealth: () => ({ markUploadError: vi.fn() }),
}));
vi.mock('@/composables/service/useServiceAvailability', () => ({
  useServiceAvailability: () => ({ markServiceAvailable: vi.fn(async () => undefined) }),
}));
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { UploadQueueManager } = await import('@/core/UploadQueue');
const { useQueueState } = await import('@/composables/upload/useQueueState');
const { processUploadQueue } = await import('@/composables/upload/UploadExecutor');
const { RetryService } = await import('@/services/RetryService');
const { useHistorySaver } = await import('@/composables/history/useHistorySaver');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function uploaded(serviceId: string): UploadResult {
  return { serviceId, fileKey: `${serviceId}-key`, url: `https://img.example/${serviceId}.png` };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const SERVICES = ['github', 'smms'];
const FILE = 'C:/tmp/a.png';

function setup() {
  const queueManager = new UploadQueueManager();
  const saver = useHistorySaver();
  const itemId = queueManager.addFile(FILE, 'a.png', SERVICES)!;
  const toast = { success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const retryService = new RetryService({
    configStore: {} as never,
    queueManager,
    toast,
    saveHistoryItem: async (filePath, result, customId) => { await saver.saveHistoryItem(filePath, result, customId); },
  });
  const config = { ...DEFAULT_CONFIG, imageCompression: { ...DEFAULT_CONFIG.imageCompression!, enabled: false } } as UserConfig;
  const run = processUploadQueue(
    [{ itemId, filePath: FILE, uploadFilePath: FILE, fileName: 'a.png' }],
    config,
    SERVICES,
    5,
    { queueManager, ...saver, toast: { showConfig: vi.fn() } as never },
  );
  return { queueManager, itemId, retryService, config, run };
}

describe('上传还没结束时点重试', () => {
  beforeEach(() => {
    db.clear();
    uploadPlan.clear();
    retryPlan.clear();
    useQueueState().clearQueue();
  });

  it('重试先成功、另一个图床后成功：两个结果都在同一条记录里，主图床按配置顺序', async () => {
    const github = deferred<UploadResult>();
    const smms = deferred<UploadResult>();
    uploadPlan.set('github', github.promise);
    uploadPlan.set('smms', smms.promise);
    retryPlan.set('github', Promise.resolve(uploaded('github')));

    const { queueManager, itemId, retryService, config, run } = setup();
    github.reject(new Error('github 超时'));
    await flush();
    expect(queueManager.getItem(itemId)?.serviceProgress.github?.status).toBe('✗ 失败');

    // smms 还在传，用户点了 github 的重试
    await retryService.retrySingleService(itemId, 'github', config);
    smms.resolve(uploaded('smms'));
    await run;

    const item = queueManager.getItem(itemId)!;
    const record = db.get(item.historyId!)!;
    expect(db.size).toBe(1);
    expect(record.results.map(r => r.serviceId).sort()).toEqual(['github', 'smms']);
    expect(record.primaryService).toBe('github');
    expect(record.generatedLink).toBe('https://img.example/github.png');
    expect(item.status).toBe('success');
    expect(item.primaryUrl).toBe('https://img.example/github.png');
    expect(item.serviceProgress.github).toMatchObject({ status: '✓ 完成', link: 'https://img.example/github.png' });
    expect(item.serviceProgress.smms).toMatchObject({ status: '✓ 完成', link: 'https://img.example/smms.png' });
  });

  it('重试还在传、另一个图床先成功收尾：重试中的图床不被标成「已跳过」，补完后进同一条记录', async () => {
    const github = deferred<UploadResult>();
    const smms = deferred<UploadResult>();
    const githubRetry = deferred<UploadResult>();
    uploadPlan.set('github', github.promise);
    uploadPlan.set('smms', smms.promise);
    retryPlan.set('github', githubRetry.promise);

    const { queueManager, itemId, retryService, config, run } = setup();
    github.reject(new Error('github 超时'));
    await flush();

    const retry = retryService.retrySingleService(itemId, 'github', config);
    await flush();
    smms.resolve(uploaded('smms'));
    await run;

    const mid = queueManager.getItem(itemId)!;
    expect(mid.serviceProgress.github?.status).not.toContain('跳过');
    expect(mid.serviceProgress.github?.isRetrying).toBe(true);
    // 还有图床在重试，整项不能先显示「完成」（否则节流守卫会吞掉重试进度）
    expect(mid.status).toBe('uploading');

    githubRetry.resolve(uploaded('github'));
    await retry;

    const item = queueManager.getItem(itemId)!;
    const record = db.get(item.historyId!)!;
    expect(db.size).toBe(1);
    expect(record.results.map(r => r.serviceId).sort()).toEqual(['github', 'smms']);
    expect(item.serviceProgress.github).toMatchObject({ status: '✓ 完成', link: 'https://img.example/github.png' });
    expect(item.status).toBe('success');
  });

  it('重试还在传、另一个图床也失败导致整次上传失败：不把重试中的图床改成失败', async () => {
    const github = deferred<UploadResult>();
    const smms = deferred<UploadResult>();
    const githubRetry = deferred<UploadResult>();
    uploadPlan.set('github', github.promise);
    uploadPlan.set('smms', smms.promise);
    retryPlan.set('github', githubRetry.promise);

    const { queueManager, itemId, retryService, config, run } = setup();
    github.reject(new Error('github 超时'));
    await flush();

    const retry = retryService.retrySingleService(itemId, 'github', config);
    await flush();
    smms.reject(new Error('smms 401'));
    await run;

    const mid = queueManager.getItem(itemId)!;
    expect(mid.serviceProgress.github?.status).not.toContain('失败');
    expect(mid.serviceProgress.github?.isRetrying).toBe(true);
    expect(mid.status).toBe('uploading');
    expect(mid.serviceProgress.smms?.status).toBe('✗ 失败');

    githubRetry.resolve(uploaded('github'));
    await retry;

    const item = queueManager.getItem(itemId)!;
    expect(item.serviceProgress.github).toMatchObject({ status: '✓ 完成', link: 'https://img.example/github.png' });
    const record = db.get(item.historyId!)!;
    expect(record.results.map(r => r.serviceId)).toEqual(['github']);
    expect(record.primaryService).toBe('github');
  });

  it('重试已成功、另一个图床随后失败导致整次上传失败：已成功的图床保持成功', async () => {
    const github = deferred<UploadResult>();
    const smms = deferred<UploadResult>();
    uploadPlan.set('github', github.promise);
    uploadPlan.set('smms', smms.promise);
    retryPlan.set('github', Promise.resolve(uploaded('github')));

    const { queueManager, itemId, retryService, config, run } = setup();
    github.reject(new Error('github 超时'));
    await flush();
    await retryService.retrySingleService(itemId, 'github', config);
    smms.reject(new Error('smms 401'));
    await run;

    const item = queueManager.getItem(itemId)!;
    expect(item.serviceProgress.github).toMatchObject({ status: '✓ 完成', link: 'https://img.example/github.png' });
    expect(item.serviceProgress.smms?.status).toBe('✗ 失败');
    expect(db.get(item.historyId!)?.results.map(r => r.serviceId)).toEqual(['github']);
  });
});
