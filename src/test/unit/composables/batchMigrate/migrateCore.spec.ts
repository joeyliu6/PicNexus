import { describe, it, expect } from 'vitest';
import { extractErrorMessage, markStatusFailed, MAX_CONCURRENT } from '../../../../composables/batchMigrate/migrateCore';
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
  it('固定为 4', () => {
    expect(MAX_CONCURRENT).toBe(4);
  });
});
