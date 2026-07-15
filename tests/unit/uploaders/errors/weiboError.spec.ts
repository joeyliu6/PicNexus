import { describe, expect, it } from 'vitest';
import {
  WeiboUploadError,
  convertToWeiboError,
  convertToStructuredWeiboError,
} from '@/uploaders/weibo/WeiboError';
import { UploadErrorCode } from '@/uploaders/base/ErrorTypes';

describe('WeiboUploadError 构造', () => {
  it('默认只带 message', () => {
    const err = new WeiboUploadError('boom');
    expect(err.name).toBe('WeiboUploadError');
    expect(err.message).toBe('boom');
    expect(err.code).toBeUndefined();
    expect(err.httpStatus).toBeUndefined();
    expect(err.originalError).toBeUndefined();
  });

  it('可以携带 code/httpStatus/originalError', () => {
    const cause = new Error('cause');
    const err = new WeiboUploadError('boom', 'X', 500, cause);
    expect(err.code).toBe('X');
    expect(err.httpStatus).toBe(500);
    expect(err.originalError).toBe(cause);
  });
});

describe('convertToWeiboError', () => {
  it('已经是 WeiboUploadError 则原样返回', () => {
    const original = new WeiboUploadError('pass-through', 'KEEP');
    expect(convertToWeiboError(original)).toBe(original);
  });

  it('Cookie 过期关键字 → COOKIE_EXPIRED 错误码', () => {
    const err = convertToWeiboError(new Error('Cookie expired at session'));
    expect(err.code).toBe('COOKIE_EXPIRED');
    expect(err.message).toContain('Cookie 已过期');
    expect(err.message).toContain('100006');
  });

  it('错误码 100006 也能命中 COOKIE_EXPIRED', () => {
    const err = convertToWeiboError('error 100006: session invalid');
    expect(err.code).toBe('COOKIE_EXPIRED');
  });

  it('原始 Error 对象被保留在 originalError', () => {
    const cause = new Error('Cookie expired xyz');
    const err = convertToWeiboError(cause);
    expect(err.originalError).toBe(cause);
  });

  it('未匹配关键字 → UPLOAD_ERROR 通用分支', () => {
    const err = convertToWeiboError(new Error('random network glitch'));
    expect(err.code).toBe('UPLOAD_ERROR');
    expect(err.message).toBe('上传失败: random network glitch');
  });

  it('非 Error 非字符串的输入也能兜底', () => {
    const err = convertToWeiboError({ foo: 'bar' });
    expect(err.code).toBe('UPLOAD_ERROR');
    expect(err.message.startsWith('上传失败:')).toBe(true);
  });
});

describe('convertToStructuredWeiboError', () => {
  it('COOKIE_EXPIRED 映射到结构化码并提示前往设置', () => {
    const se = convertToStructuredWeiboError(new Error('Cookie expired'));
    expect(se.code).toBe(UploadErrorCode.COOKIE_EXPIRED);
    expect(se.retryable).toBe(false);
    expect(se.solution).toContain('设置页面');
    expect(se.serviceId).toBe('weibo');
  });

  it('通用上传错误标记为 retryable', () => {
    const se = convertToStructuredWeiboError(new Error('server returned 500'));
    expect(se.code).toBe(UploadErrorCode.UPLOAD_FAILED);
    expect(se.retryable).toBe(true);
  });

  it('originalError 有值时 details 使用其消息', () => {
    const cause = new Error('root cause text');
    const se = convertToStructuredWeiboError(cause);
    expect(se.details).toBe('root cause text');
    expect(se.originalError).toBe(cause);
  });

  it('originalError 未定义时 details 也 undefined', () => {
    // 直接传入 WeiboUploadError 本身（没有 originalError）则命中 originalError === undefined 分支
    const passthrough = new WeiboUploadError('msg', 'UPLOAD_ERROR');
    const se = convertToStructuredWeiboError(passthrough);
    expect(se.details).toBeUndefined();
    expect(se.originalError).toBeUndefined();
  });
});
