import { describe, expect, it } from 'vitest';
import {
  R2UploadError,
  convertToR2Error,
  convertToStructuredR2Error,
} from '@/uploaders/r2/R2Error';
import { UploadErrorCode } from '@/uploaders/base/ErrorTypes';

describe('R2UploadError 构造', () => {
  it('保留 message / code / originalError', () => {
    const cause = new Error('aws sdk error');
    const err = new R2UploadError('boom', 'AUTH_ERROR', cause);
    expect(err.name).toBe('R2UploadError');
    expect(err.code).toBe('AUTH_ERROR');
    expect(err.originalError).toBe(cause);
  });
});

describe('convertToR2Error - 分类', () => {
  it('已经是 R2UploadError 则原样返回', () => {
    const original = new R2UploadError('keep', 'AUTH_ERROR');
    expect(convertToR2Error(original)).toBe(original);
  });

  it.each([
    ['authentication failed', 'AUTH_ERROR'],
    ['invalid credentials', 'AUTH_ERROR'],
    ['AccessDenied by policy', 'AUTH_ERROR'],
    ['bucket not found', 'BUCKET_ERROR'],
    ['NoSuchBucket returned', 'BUCKET_ERROR'],
    ['network unreachable', 'NETWORK_ERROR'],
    ['request timeout', 'NETWORK_ERROR'],
    ['ECONNREFUSED at host', 'NETWORK_ERROR'],
    ['permission denied', 'PERMISSION_ERROR'],
    ['Forbidden by policy', 'PERMISSION_ERROR'],
  ])('消息「%s」应分类为 %s', (msg, expectedCode) => {
    const err = convertToR2Error(new Error(msg));
    expect(err.code).toBe(expectedCode);
  });

  it('未匹配关键字 → 通用 UPLOAD_ERROR', () => {
    const err = convertToR2Error(new Error('quirky server response'));
    expect(err.code).toBe('UPLOAD_ERROR');
    expect(err.message).toBe('R2 上传失败: quirky server response');
  });

  it('分类是按顺序匹配的——authentication 优先于 bucket', () => {
    // 两个关键字都包含，但 authentication 先命中
    const err = convertToR2Error(new Error('authentication for bucket failed'));
    expect(err.code).toBe('AUTH_ERROR');
  });

  it('originalError 被原样保留', () => {
    const cause = new Error('network timeout');
    const err = convertToR2Error(cause);
    expect(err.originalError).toBe(cause);
  });
});

describe('convertToStructuredR2Error', () => {
  it.each([
    ['authentication failed', UploadErrorCode.AUTH_FAILED, false],
    ['bucket not found', UploadErrorCode.BUCKET_NOT_FOUND, false],
    ['network error', UploadErrorCode.NETWORK_ERROR, true],
    ['permission denied', UploadErrorCode.PERMISSION_DENIED, false],
    ['quirky unknown', UploadErrorCode.UPLOAD_FAILED, true],
  ])('消息「%s」→ 结构化码 %s（retryable=%s）', (msg, expected, retryable) => {
    const se = convertToStructuredR2Error(new Error(msg));
    expect(se.code).toBe(expected);
    expect(se.retryable).toBe(retryable);
    expect(se.serviceId).toBe('r2');
  });

  it('认证错误附带 Access Key 相关的 solution 提示', () => {
    const se = convertToStructuredR2Error(new Error('authentication failed'));
    expect(se.solution).toContain('Access Key');
  });

  it('Bucket 错误附带 Bucket Name 的 solution 提示', () => {
    const se = convertToStructuredR2Error(new Error('NoSuchBucket'));
    expect(se.solution).toContain('Bucket Name');
  });

  it('通用 UPLOAD_ERROR 路径 solution 保持 undefined', () => {
    const se = convertToStructuredR2Error(new Error('unexpected'));
    expect(se.solution).toBeUndefined();
  });

  it('originalError 有值时 details 使用其消息', () => {
    const cause = new Error('detailed network trace');
    const se = convertToStructuredR2Error(cause);
    expect(se.details).toBe('detailed network trace');
  });

  it('R2UploadError 本身无 originalError 时 details 也 undefined', () => {
    const passthrough = new R2UploadError('msg', 'UPLOAD_ERROR');
    const se = convertToStructuredR2Error(passthrough);
    expect(se.details).toBeUndefined();
  });
});
