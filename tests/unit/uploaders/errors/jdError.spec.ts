import { describe, expect, it } from 'vitest';
import {
  JDUploadError,
  convertToJDError,
} from '@/uploaders/jd/JDError';
import { UploadErrorCode } from '@/uploaders/base/ErrorTypes';

describe('JDUploadError 构造', () => {
  it('保留 message / code / originalError', () => {
    const cause = new Error('cause');
    const err = new JDUploadError('boom', UploadErrorCode.RATE_LIMIT, cause);
    expect(err.name).toBe('JDUploadError');
    expect(err.message).toBe('boom');
    expect(err.code).toBe(UploadErrorCode.RATE_LIMIT);
    expect(err.originalError).toBe(cause);
  });
});

describe('convertToJDError - 分类', () => {
  it.each([
    ['network unreachable', UploadErrorCode.NETWORK_ERROR, true],
    ['request timeout', UploadErrorCode.NETWORK_ERROR, true],
    ['ECONNREFUSED to host', UploadErrorCode.NETWORK_ERROR, true],
    ['rate limit exceeded', UploadErrorCode.RATE_LIMIT, true],
    ['too many requests', UploadErrorCode.RATE_LIMIT, true],
    ['got 429 status code', UploadErrorCode.RATE_LIMIT, true],
    ['file not found at path', UploadErrorCode.FILE_NOT_FOUND, false],
    ['file 无法找到', UploadErrorCode.FILE_NOT_FOUND, false],
    ['file too large for upload', UploadErrorCode.FILE_TOO_LARGE, false],
    ['size exceeds', UploadErrorCode.FILE_TOO_LARGE, false],
    ['文件过大', UploadErrorCode.FILE_TOO_LARGE, false],
    ['got 500 error', UploadErrorCode.SERVER_ERROR, true],
    ['502 bad gateway', UploadErrorCode.SERVER_ERROR, true],
    ['503 service unavailable', UploadErrorCode.SERVER_ERROR, true],
  ])('消息「%s」→ %s（retryable=%s）', (msg, expectedCode, expectedRetryable) => {
    const se = convertToJDError(new Error(msg));
    expect(se.code).toBe(expectedCode);
    expect(se.retryable).toBe(expectedRetryable);
    expect(se.serviceId).toBe('jd');
  });

  it('未匹配任何关键字 → 通用 UPLOAD_FAILED 且 retryable', () => {
    const se = convertToJDError(new Error('some obscure failure'));
    expect(se.code).toBe(UploadErrorCode.UPLOAD_FAILED);
    expect(se.retryable).toBe(true);
    expect(se.message).toContain('京东上传失败');
    expect(se.message).toContain('some obscure failure');
  });

  it('仅带 file 但不包含 not found / 无法找到 → 不走 FILE_NOT_FOUND', () => {
    // "file" 单独出现不触发任何分类（通用分支命中）
    const se = convertToJDError(new Error('file upload request'));
    expect(se.code).toBe(UploadErrorCode.UPLOAD_FAILED);
  });

  it('file + too large 应落到 FILE_TOO_LARGE（顺序优先级）', () => {
    // "file" 命中但 "too large" 优先级低，上面 not-found 未命中，下面 too large 命中
    const se = convertToJDError(new Error('file too large exceeds quota'));
    expect(se.code).toBe(UploadErrorCode.FILE_TOO_LARGE);
  });

  it('originalError 被原样保留且 details 为消息', () => {
    const cause = new Error('timeout occurred');
    const se = convertToJDError(cause);
    expect(se.originalError).toBe(cause);
    expect(se.details).toBe('timeout occurred');
  });

  it('字符串输入也能分类', () => {
    const se = convertToJDError('429 rate limited');
    expect(se.code).toBe(UploadErrorCode.RATE_LIMIT);
  });

  it('大小写不敏感', () => {
    const se = convertToJDError(new Error('NETWORK lost'));
    expect(se.code).toBe(UploadErrorCode.NETWORK_ERROR);
  });
});
