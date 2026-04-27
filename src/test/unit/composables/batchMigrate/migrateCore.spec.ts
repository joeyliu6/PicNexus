import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { extractErrorMessage, markStatusFailed, MAX_CONCURRENT, processBatch } from '../../../../composables/batchMigrate/migrateCore';
import type { MigrateItemStatus } from '../../../../types/batchMigrate';

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
});
