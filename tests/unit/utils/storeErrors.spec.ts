import { describe, it, expect } from 'vitest';
import { StoreError } from '@/utils/storeErrors';

describe('StoreError', () => {
  it('name 固定为 StoreError', () => {
    const err = new StoreError('读取失败', 'read');
    expect(err.name).toBe('StoreError');
  });

  it('message 被正确保留', () => {
    const err = new StoreError('写入错误', 'write');
    expect(err.message).toBe('写入错误');
  });

  it('operation 字段被保留', () => {
    const err = new StoreError('清除失败', 'clear');
    expect(err.operation).toBe('clear');
  });

  it('支持所有 operation 类型：read / write / clear / init', () => {
    expect(new StoreError('', 'read').operation).toBe('read');
    expect(new StoreError('', 'write').operation).toBe('write');
    expect(new StoreError('', 'clear').operation).toBe('clear');
    expect(new StoreError('', 'init').operation).toBe('init');
  });

  it('key 字段可选，不传时为 undefined', () => {
    const err = new StoreError('读取失败', 'read');
    expect(err.key).toBeUndefined();
  });

  it('key 字段传入后可读', () => {
    const err = new StoreError('键不存在', 'read', 'myKey');
    expect(err.key).toBe('myKey');
  });

  it('originalError 字段可选，不传时为 undefined', () => {
    const err = new StoreError('读取失败', 'read');
    expect(err.originalError).toBeUndefined();
  });

  it('originalError 可传入任意值', () => {
    const cause = new Error('底层 IO 错误');
    const err = new StoreError('读取失败', 'read', 'key1', cause);
    expect(err.originalError).toBe(cause);
  });

  it('是 Error 的子类，instanceof Error 为 true', () => {
    const err = new StoreError('init 错误', 'init');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StoreError);
  });
});
