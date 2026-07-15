import { describe, expect, it } from 'vitest';
import {
  NamiUploadError,
  convertToNamiError,
} from '@/uploaders/nami/NamiError';
import { UploadErrorCode } from '@/uploaders/base/ErrorTypes';

describe('NamiUploadError 构造', () => {
  it('保留 message / code / originalError', () => {
    const cause = new Error('cause');
    const err = new NamiUploadError('boom', UploadErrorCode.NETWORK_ERROR, cause);
    expect(err.name).toBe('NamiUploadError');
    expect(err.message).toBe('boom');
    expect(err.code).toBe(UploadErrorCode.NETWORK_ERROR);
    expect(err.originalError).toBe(cause);
  });
});

describe('convertToNamiError - 分类逻辑', () => {
  it.each([
    ['Cookie expired at 10:00', UploadErrorCode.COOKIE_EXPIRED, false],
    ['cookie 过期了', UploadErrorCode.COOKIE_EXPIRED, false],
    ['Cookie invalid format', UploadErrorCode.COOKIE_INVALID, false],
    ['cookie 无效', UploadErrorCode.COOKIE_INVALID, false],
    ['token expired', UploadErrorCode.AUTH_FAILED, false],
    ['auth check failed', UploadErrorCode.AUTH_FAILED, false],
    ['network down', UploadErrorCode.NETWORK_ERROR, true],
    ['request timeout', UploadErrorCode.NETWORK_ERROR, true],
    ['ECONNREFUSED to upstream', UploadErrorCode.NETWORK_ERROR, true],
    ['rate limit reached', UploadErrorCode.RATE_LIMIT, true],
    ['too many requests', UploadErrorCode.RATE_LIMIT, true],
    ['got 429 status', UploadErrorCode.RATE_LIMIT, true],
    ['permission denied by server', UploadErrorCode.PERMISSION_DENIED, false],
    ['Forbidden resource', UploadErrorCode.PERMISSION_DENIED, false],
    ['403 error', UploadErrorCode.PERMISSION_DENIED, false],
    ['file too large for quota', UploadErrorCode.FILE_TOO_LARGE, false],
    ['size check failed', UploadErrorCode.FILE_TOO_LARGE, false],
    ['文件过大', UploadErrorCode.FILE_TOO_LARGE, false],
    ['got 500 server error', UploadErrorCode.SERVER_ERROR, true],
    ['502 bad gateway', UploadErrorCode.SERVER_ERROR, true],
    ['503 service unavailable', UploadErrorCode.SERVER_ERROR, true],
  ])('消息「%s」应分类为 %s（retryable=%s）', (msg, expectedCode, expectedRetryable) => {
    const se = convertToNamiError(new Error(msg));
    expect(se.code).toBe(expectedCode);
    expect(se.retryable).toBe(expectedRetryable);
    expect(se.serviceId).toBe('nami');
  });

  it('未匹配任何关键字 → 通用 UPLOAD_FAILED 且 retryable', () => {
    const se = convertToNamiError(new Error('something totally unexpected'));
    expect(se.code).toBe(UploadErrorCode.UPLOAD_FAILED);
    expect(se.retryable).toBe(true);
    expect(se.message).toContain('纳米上传失败');
    expect(se.message).toContain('something totally unexpected');
  });

  it('Cookie 关键字但无 expired/invalid 关键字 → 走通用分支', () => {
    // 仅 "cookie" 不足以触发任何 Cookie 专用分类
    const se = convertToNamiError(new Error('cookie header missing'));
    expect(se.code).toBe(UploadErrorCode.UPLOAD_FAILED);
  });

  it('不区分大小写', () => {
    const se = convertToNamiError(new Error('TIMEOUT while connecting'));
    expect(se.code).toBe(UploadErrorCode.NETWORK_ERROR);
  });

  it('originalError 被原样保留', () => {
    const cause = new Error('Cookie expired');
    const se = convertToNamiError(cause);
    expect(se.originalError).toBe(cause);
  });

  it('字符串输入能正确分类', () => {
    const se = convertToNamiError('rate limit exceeded');
    expect(se.code).toBe(UploadErrorCode.RATE_LIMIT);
  });
});
