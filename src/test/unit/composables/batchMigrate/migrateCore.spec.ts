import { beforeEach, describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { remove } from '@tauri-apps/plugin-fs';
import { extractErrorMessage, markStatusFailed, MAX_CONCURRENT, migrateOneItem, processBatch } from '../../../../composables/batchMigrate/migrateCore';
import { historyDB } from '../../../../services/HistoryDatabase';
import type { MigrateItemStatus } from '../../../../types/batchMigrate';
import type { HistoryItem, UserConfig } from '../../../../config/types';
import { getInvokeMock } from '../../../helpers/tauriMock';

vi.mock('../../../../services/HistoryDatabase', () => ({
  historyDB: {
    update: vi.fn(),
  },
}));

function createStatus(overrides: Partial<MigrateItemStatus> = {}): MigrateItemStatus {
  return {
    historyId: overrides.historyId ?? 'h1',
    fileName: overrides.fileName ?? 'a.png',
    sourceUrl: overrides.sourceUrl,
    status: overrides.status ?? 'pending',
    error: overrides.error,
    errorType: overrides.errorType,
    failureDetails: overrides.failureDetails,
    convertedFormat: overrides.convertedFormat,
    serviceResults: overrides.serviceResults ?? { r2: 'pending', github: 'pending' },
    existingServiceIds: overrides.existingServiceIds ?? ['source'],
    sourceServiceId: overrides.sourceServiceId,
    preferredSourceServiceIds: overrides.preferredSourceServiceIds,
    problemServiceIds: overrides.problemServiceIds,
  };
}

function uploadResult(serviceId: string, url: string) {
  return { serviceId, fileKey: `${serviceId}-key`, url };
}

function createItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: overrides.id ?? 'h1',
    timestamp: overrides.timestamp ?? 123,
    localFileName: overrides.localFileName ?? 'a.png',
    primaryService: overrides.primaryService ?? 'source',
    results: overrides.results ?? [
      { serviceId: 'source', status: 'success', result: uploadResult('source', 'https://img.example.com/a.png') },
    ],
    generatedLink: overrides.generatedLink ?? '',
    linkCheckStatus: overrides.linkCheckStatus,
    linkCheckSummary: overrides.linkCheckSummary,
  } as HistoryItem;
}

function checkStatus(isValid: boolean, responseTime = 100): NonNullable<HistoryItem['linkCheckStatus']>[string] {
  return {
    isValid,
    lastCheckTime: 1,
    errorType: isValid ? 'success' : 'http_4xx',
    responseTime,
  };
}

function createUploader(outcomes: Record<string, 'success' | Error>) {
  return {
    retryUpload: vi.fn(async (_filePath: string, serviceId: string) => {
      const outcome = outcomes[serviceId] ?? 'success';
      if (outcome instanceof Error) throw outcome;
      return { url: `https://cdn.example.com/${serviceId}.png` };
    }),
  };
}

function createStats() {
  return ref({ startTime: 0, elapsedMs: 0, processedCount: 0, totalCount: 0, totalBytes: 0 });
}

describe('migrateOneItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(remove).mockResolvedValue(undefined);
    getInvokeMock().mockReset();
  });

  it('skips item when every selected target already exists', async () => {
    const item = createItem({
      results: [
        { serviceId: 'r2', status: 'success', result: uploadResult('r2', 'https://r2/a.png') },
        { serviceId: 'github', status: 'success', result: uploadResult('github', 'https://github/a.png') },
      ],
    });
    const status = createStatus({ serviceResults: {} });

    await migrateOneItem(
      item,
      status,
      ['r2', 'github'],
      {} as UserConfig,
      createUploader({}) as any,
      ref(false),
      ref(false),
      createStats(),
    );

    expect(status.status).toBe('skipped');
    expect(getInvokeMock()).not.toHaveBeenCalled();
    expect(historyDB.update).not.toHaveBeenCalled();
  });

  it('records success with per-target failure without blocking successful targets', async () => {
    getInvokeMock().mockResolvedValue({ file_path: '/tmp/a.png', content_type: 'image/png', file_size: 512 });
    const uploader = createUploader({ r2: 'success', github: new Error('bad token') });
    const status = createStatus();
    const onTargetSettled = vi.fn();
    const item = createItem({
      linkCheckSummary: { totalLinks: 1, validLinks: 1, invalidLinks: 0, uncheckedLinks: 0 },
    });

    await migrateOneItem(
      item,
      status,
      ['r2', 'github'],
      {} as UserConfig,
      uploader as any,
      ref(false),
      ref(false),
      createStats(),
      onTargetSettled,
    );

    expect(status.status).toBe('success');
    expect(status.serviceResults).toEqual({ r2: 'success', github: 'failed' });
    expect(onTargetSettled).toHaveBeenCalledTimes(2);
    expect(historyDB.update).toHaveBeenCalledWith('h1', expect.objectContaining({
      linkCheckSummary: expect.objectContaining({ totalLinks: 2, uncheckedLinks: 1 }),
    }));
    expect(vi.mocked(historyDB.update).mock.calls[0][1].results).toEqual(expect.arrayContaining([
      expect.objectContaining({ serviceId: 'r2', status: 'success' }),
      expect.objectContaining({ serviceId: 'github', status: 'failed', error: 'bad token' }),
    ]));
  });

  it('marks upload failure when every target fails', async () => {
    getInvokeMock().mockResolvedValue({ file_path: '/tmp/a.png', content_type: 'image/png', file_size: 512 });
    const uploader = createUploader({ r2: new Error('r2 down'), github: new Error('bad token') });
    const status = createStatus();

    await migrateOneItem(
      createItem(),
      status,
      ['r2', 'github'],
      {} as UserConfig,
      uploader as any,
      ref(false),
      ref(false),
      createStats(),
    );

    expect(status.status).toBe('failed');
    expect(status.errorType).toBe('upload');
    expect(status.failureDetails).toEqual([
      expect.objectContaining({ serviceId: 'r2' }),
      expect.objectContaining({ serviceId: 'github' }),
    ]);
    expect(historyDB.update).not.toHaveBeenCalled();
  });

  it('marks download failure and does not upload or update history', async () => {
    getInvokeMock().mockRejectedValue(new Error('network timeout'));
    const uploader = createUploader({});
    const status = createStatus();

    await migrateOneItem(
      createItem(),
      status,
      ['r2'],
      {} as UserConfig,
      uploader as any,
      ref(false),
      ref(false),
      createStats(),
    );

    expect(status.status).toBe('failed');
    expect(status.errorType).toBe('download');
    expect(uploader.retryUpload).not.toHaveBeenCalled();
    expect(historyDB.update).not.toHaveBeenCalled();
  });

  it('cleans downloaded temp file and returns to pending when paused after download', async () => {
    const isPaused = ref(false);
    getInvokeMock().mockImplementation(async () => {
      isPaused.value = true;
      return { file_path: '/tmp/a.png', content_type: 'image/png', file_size: 512 };
    });
    const uploader = createUploader({});
    const status = createStatus();

    await migrateOneItem(
      createItem(),
      status,
      ['r2'],
      {} as UserConfig,
      uploader as any,
      ref(false),
      isPaused,
      createStats(),
    );

    expect(status.status).toBe('pending');
    expect(remove).toHaveBeenCalledWith('/tmp/a.png');
    expect(uploader.retryUpload).not.toHaveBeenCalled();
  });

  it('cleans downloaded temp file and skips when cancelled after download', async () => {
    const isCancelled = ref(false);
    getInvokeMock().mockImplementation(async () => {
      isCancelled.value = true;
      return { file_path: '/tmp/a.png', content_type: 'image/png', file_size: 512 };
    });
    const status = createStatus();

    await migrateOneItem(
      createItem(),
      status,
      ['r2'],
      {} as UserConfig,
      createUploader({}) as any,
      isCancelled,
      ref(false),
      createStats(),
    );

    expect(status.status).toBe('skipped');
    expect(remove).toHaveBeenCalledWith('/tmp/a.png');
  });

  it('converts unsupported target format before upload', async () => {
    getInvokeMock().mockImplementation(async (command) => {
      if (command === 'download_url_image') {
        return { file_path: '/tmp/a.webp', content_type: 'image/webp', file_size: 512 };
      }
      if (command === 'compress_image') {
        return { outputPath: '/tmp/a.jpeg' };
      }
      throw new Error(`unexpected command ${command}`);
    });
    const uploader = createUploader({ jd: 'success' });
    const status = createStatus({ serviceResults: { jd: 'pending' } });

    await migrateOneItem(
      createItem(),
      status,
      ['jd'],
      {} as UserConfig,
      uploader as any,
      ref(false),
      ref(false),
      createStats(),
    );

    expect(status.status).toBe('success');
    expect(status.convertedFormat).toBe('jpeg');
    expect(uploader.retryUpload).toHaveBeenCalledWith('/tmp/a.jpeg', 'jd', {});
    expect(remove).toHaveBeenCalledWith('/tmp/a.webp');
    expect(remove).toHaveBeenCalledWith('/tmp/a.jpeg');
  });

  it('optimizes zhihu webp source URL for targets that do not support webp', async () => {
    getInvokeMock().mockResolvedValue({ file_path: '/tmp/a.jpg', content_type: 'image/jpeg', file_size: 512 });
    const status = createStatus({ serviceResults: { jd: 'pending' } });

    await migrateOneItem(
      createItem({
        results: [
          { serviceId: 'zhihu', status: 'success', result: uploadResult('zhihu', 'https://pic1.zhimg.com/v2-a.webp') },
        ],
      }),
      status,
      ['jd'],
      {} as UserConfig,
      createUploader({ jd: 'success' }) as any,
      ref(false),
      ref(false),
      createStats(),
    );

    expect(status.sourceUrl).toBe('https://pic1.zhimg.com/v2-a.jpg');
    expect(getInvokeMock()).toHaveBeenCalledWith('download_url_image', { url: 'https://pic1.zhimg.com/v2-a.jpg' });
  });

  it('可恢复图片模式优先使用已检测有效的下载源', async () => {
    getInvokeMock().mockResolvedValue({ file_path: '/tmp/a.png', content_type: 'image/png', file_size: 512 });
    const status = createStatus({
      serviceResults: { github: 'pending' },
      sourceServiceId: 'r2',
      problemServiceIds: ['source'],
    });

    await migrateOneItem(
      createItem({
        results: [
          { serviceId: 'source', status: 'success', result: uploadResult('source', 'https://dead/a.png') },
          { serviceId: 'r2', status: 'success', result: uploadResult('r2', 'https://r2/a.png') },
        ],
        linkCheckStatus: {
          source: checkStatus(false),
          r2: checkStatus(true),
        },
      }),
      status,
      ['github'],
      {} as UserConfig,
      createUploader({ github: 'success' }) as any,
      ref(false),
      ref(false),
      createStats(),
    );

    expect(status.status).toBe('success');
    expect(status.sourceServiceId).toBe('r2');
    expect(getInvokeMock()).toHaveBeenCalledWith('download_url_image', { url: 'https://r2/a.png' });
  });

  it('普通补传模式按用户选择的来源图床下载', async () => {
    getInvokeMock().mockResolvedValue({ file_path: '/tmp/a.png', content_type: 'image/png', file_size: 512 });
    const status = createStatus({
      serviceResults: { github: 'pending' },
      sourceServiceId: 'r2',
      preferredSourceServiceIds: ['r2'],
    });

    await migrateOneItem(
      createItem({
        results: [
          { serviceId: 'source', status: 'success', result: uploadResult('source', 'https://dead/a.png') },
          { serviceId: 'r2', status: 'success', result: uploadResult('r2', 'https://r2/a.png') },
        ],
      }),
      status,
      ['github'],
      {} as UserConfig,
      createUploader({ github: 'success' }) as any,
      ref(false),
      ref(false),
      createStats(),
    );

    expect(status.status).toBe('success');
    expect(status.sourceServiceId).toBe('r2');
    expect(getInvokeMock()).toHaveBeenCalledWith('download_url_image', { url: 'https://r2/a.png' });
  });

  it('可恢复图片模式当前有效源下载失败时尝试下一个有效源', async () => {
    getInvokeMock().mockImplementation(async (_command, args) => {
      const url = typeof args === 'object' && args !== null ? (args as { url?: string }).url : undefined;
      if (url === 'https://r2/a.png') throw new Error('r2 timeout');
      return { file_path: '/tmp/a.png', content_type: 'image/png', file_size: 512 };
    });
    const status = createStatus({
      serviceResults: { smms: 'pending' },
      sourceServiceId: 'r2',
      problemServiceIds: ['source'],
    });

    await migrateOneItem(
      createItem({
        results: [
          { serviceId: 'source', status: 'success', result: uploadResult('source', 'https://dead/a.png') },
          { serviceId: 'r2', status: 'success', result: uploadResult('r2', 'https://r2/a.png') },
          { serviceId: 'github', status: 'success', result: uploadResult('github', 'https://github/a.png') },
        ],
        linkCheckStatus: {
          source: checkStatus(false),
          r2: checkStatus(true, 10),
          github: checkStatus(true, 20),
        },
      }),
      status,
      ['smms'],
      {} as UserConfig,
      createUploader({ smms: 'success' }) as any,
      ref(false),
      ref(false),
      createStats(),
    );

    expect(status.status).toBe('success');
    expect(status.sourceServiceId).toBe('github');
    expect(getInvokeMock()).toHaveBeenCalledWith('download_url_image', { url: 'https://r2/a.png' });
    expect(getInvokeMock()).toHaveBeenCalledWith('download_url_image', { url: 'https://github/a.png' });
  });

  it('可恢复图片模式最新检测结果不再满足时跳过', async () => {
    const status = createStatus({
      serviceResults: { github: 'pending' },
      sourceServiceId: 'r2',
      problemServiceIds: ['source'],
    });

    await migrateOneItem(
      createItem({
        results: [
          { serviceId: 'source', status: 'success', result: uploadResult('source', 'https://dead/a.png') },
          { serviceId: 'r2', status: 'success', result: uploadResult('r2', 'https://r2/a.png') },
        ],
        linkCheckStatus: {
          source: checkStatus(false),
          r2: checkStatus(false),
        },
      }),
      status,
      ['github'],
      {} as UserConfig,
      createUploader({ github: 'success' }) as any,
      ref(false),
      ref(false),
      createStats(),
    );

    expect(status.status).toBe('skipped');
    expect(status.error).toBe('检测结果已更新，不再满足可恢复图片条件');
    expect(status.errorType).toBeUndefined();
    expect(getInvokeMock()).not.toHaveBeenCalled();
    expect(historyDB.update).not.toHaveBeenCalled();
  });
});

describe('extractErrorMessage', () => {
  it('Error 实例 → .message', () => {
    expect(extractErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('字符串原样返回', () => {
    expect(extractErrorMessage('plain')).toBe('plain');
  });

  it('对象有 message 字段', () => {
    expect(extractErrorMessage({ message: 'obj-msg' })).toBe('obj-msg');
  });

  it('Tauri { data: { message } } 结构', () => {
    expect(extractErrorMessage({ data: { message: 'nested' } })).toBe('nested');
  });

  it('对象无 message → JSON.stringify', () => {
    expect(extractErrorMessage({ foo: 'bar' })).toBe('{"foo":"bar"}');
  });

  it('其他类型 → String(v)', () => {
    expect(extractErrorMessage(123)).toBe('123');
    expect(extractErrorMessage(null)).toBe('null');
    expect(extractErrorMessage(undefined)).toBe('undefined');
  });
});

describe('markStatusFailed', () => {
  function makeStatus(): MigrateItemStatus {
    return {
      id: '1',
      itemId: '1',
      status: 'pending',
      serviceResults: {},
    } as any;
  }

  it('设置 status=failed 并填 details', () => {
    const status = makeStatus();
    markStatusFailed(status, [{ serviceId: 'r2', message: 'fail' }] as any);
    expect(status.status).toBe('failed');
    expect(status.failureDetails).toEqual([{ serviceId: 'r2', message: 'fail' }]);
    expect(status.error).toContain('fail');
  });

  it('可选 errorType 参数', () => {
    const status = makeStatus();
    markStatusFailed(status, [{ message: 'x' }] as any, 'download');
    expect(status.errorType).toBe('download');
  });

  it('多条 details 用中文分号连接', () => {
    const status = makeStatus();
    markStatusFailed(status, [
      { serviceId: 'r2', message: 'a' },
      { serviceId: 'weibo', message: 'b' },
    ] as any);
    expect(status.error).toContain('；');
  });
});

describe('MAX_CONCURRENT', () => {
  it('固定为 3（并行上传后每图床峰值并发 = MAX_CONCURRENT）', () => {
    expect(MAX_CONCURRENT).toBe(3);
  });
});

describe('processBatch cancellation', () => {
  it('取消时队列中尚未开始的项目也会计入 skipped 回调', async () => {
    const statuses: MigrateItemStatus[] = [
      { historyId: '1', fileName: 'a.png', status: 'pending', serviceResults: {} },
      { historyId: '2', fileName: 'b.png', status: 'pending', serviceResults: {} },
    ];
    const done: MigrateItemStatus[] = [];

    await processBatch(
      [{ id: '1' }, { id: '2' }] as any,
      statuses,
      ['r2'],
      {} as any,
      {} as any,
      ref(true),
      ref(false),
      ref({ startTime: 0, elapsedMs: 0, processedCount: 0, totalCount: 2, totalBytes: 0 }),
      status => done.push({ ...status }),
    );

    expect(done).toHaveLength(2);
    expect(done.every(status => status.status === 'skipped')).toBe(true);
  });

  it('leaves paused items pending and does not count them as done', async () => {
    const statuses: MigrateItemStatus[] = [
      { historyId: '1', fileName: 'a.png', status: 'pending', serviceResults: { r2: 'pending' } },
    ];
    const done = vi.fn();

    await processBatch(
      [{ id: '1' }] as any,
      statuses,
      ['r2'],
      {} as any,
      {} as any,
      ref(false),
      ref(true),
      ref({ startTime: 0, elapsedMs: 0, processedCount: 0, totalCount: 1, totalBytes: 0 }),
      done,
    );

    expect(statuses[0].status).toBe('pending');
    expect(done).not.toHaveBeenCalled();
  });
});
