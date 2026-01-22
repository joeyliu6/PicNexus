// 微博上传错误处理

import { UploadErrorCode, StructuredError, createStructuredError } from '../base/ErrorTypes';

/**
 * 微博上传错误类
 */
export class WeiboUploadError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly httpStatus?: number,
    public readonly originalError?: any
  ) {
    super(message);
    this.name = 'WeiboUploadError';
  }
}

/**
 * 转换通用错误为微博错误
 */
export function convertToWeiboError(error: any): WeiboUploadError {
  if (error instanceof WeiboUploadError) {
    return error;
  }

  const msg = error?.message || String(error);

  // Cookie 过期
  if (msg.includes('Cookie expired') || msg.includes('100006')) {
    return new WeiboUploadError(
      'Cookie 已过期：请立即检查并更新 Cookie（错误码：100006）',
      'COOKIE_EXPIRED',
      undefined,
      error
    );
  }

  // 通用上传错误
  return new WeiboUploadError(
    `上传失败: ${msg}`,
    'UPLOAD_ERROR',
    undefined,
    error
  );
}

/**
 * 新增：转换为结构化错误
 */
export function convertToStructuredWeiboError(error: any): StructuredError {
  const weiboError = convertToWeiboError(error);

  let code: UploadErrorCode;
  let retryable = false;
  let solution: string | undefined;

  switch (weiboError.code) {
    case 'COOKIE_EXPIRED':
      code = UploadErrorCode.COOKIE_EXPIRED;
      solution = '请前往设置页面更新微博 Cookie';
      break;
    case 'INVALID_COOKIE':
      code = UploadErrorCode.COOKIE_INVALID;
      solution = '请前往设置页面更新微博 Cookie';
      break;
    case 'EMPTY_COOKIE':
      code = UploadErrorCode.COOKIE_EMPTY;
      solution = '请前往设置页面配置微博 Cookie';
      break;
    case 'UPLOAD_ERROR':
    default:
      code = UploadErrorCode.UPLOAD_FAILED;
      retryable = true;
      break;
  }

  return createStructuredError(code, weiboError.message, {
    details: weiboError.originalError?.message,
    retryable,
    solution,
    originalError: weiboError.originalError,
    serviceId: 'weibo'
  });
}
