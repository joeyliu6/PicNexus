// 纳米图床错误处理

import { UploadErrorCode, StructuredError, createStructuredError } from '../base/ErrorTypes';

/**
 * 纳米上传错误类
 */
export class NamiUploadError extends Error {
  constructor(
    message: string,
    public readonly code?: UploadErrorCode,
    public readonly originalError?: any
  ) {
    super(message);
    this.name = 'NamiUploadError';
  }
}

/**
 * 转换通用错误为纳米结构化错误
 */
export function convertToNamiError(error: any): StructuredError {
  const msg = error?.message || String(error);
  const lowerMsg = msg.toLowerCase();

  // Cookie 相关错误
  if (lowerMsg.includes('cookie') && (lowerMsg.includes('expired') || lowerMsg.includes('过期'))) {
    return createStructuredError(
      UploadErrorCode.COOKIE_EXPIRED,
      '纳米 Cookie 已过期',
      {
        details: msg,
        retryable: false,
        solution: '请前往设置页面重新登录获取 Cookie',
        originalError: error,
        serviceId: 'nami'
      }
    );
  }

  if (lowerMsg.includes('cookie') && (lowerMsg.includes('invalid') || lowerMsg.includes('无效'))) {
    return createStructuredError(
      UploadErrorCode.COOKIE_INVALID,
      '纳米 Cookie 无效',
      {
        details: msg,
        retryable: false,
        solution: '请前往设置页面重新登录获取 Cookie',
        originalError: error,
        serviceId: 'nami'
      }
    );
  }

  // Token 相关错误
  if (lowerMsg.includes('token') || lowerMsg.includes('auth')) {
    return createStructuredError(
      UploadErrorCode.AUTH_FAILED,
      '纳米认证失败：Token 无效或已过期',
      {
        details: msg,
        retryable: false,
        solution: '请前往设置页面重新获取 Token',
        originalError: error,
        serviceId: 'nami'
      }
    );
  }

  // 网络错误
  if (lowerMsg.includes('network') || lowerMsg.includes('timeout') || lowerMsg.includes('econnrefused')) {
    return createStructuredError(
      UploadErrorCode.NETWORK_ERROR,
      '纳米网络错误：无法连接到纳米图床服务',
      {
        details: msg,
        retryable: true,
        solution: '请检查网络连接后重试',
        originalError: error,
        serviceId: 'nami'
      }
    );
  }

  // 限流错误
  if (lowerMsg.includes('rate limit') || lowerMsg.includes('too many') || lowerMsg.includes('429')) {
    return createStructuredError(
      UploadErrorCode.RATE_LIMIT,
      '纳米限流错误：请求过于频繁',
      {
        details: msg,
        retryable: true,
        solution: '请稍后再试，避免频繁上传',
        originalError: error,
        serviceId: 'nami'
      }
    );
  }

  // 权限错误
  if (lowerMsg.includes('permission') || lowerMsg.includes('forbidden') || lowerMsg.includes('403')) {
    return createStructuredError(
      UploadErrorCode.PERMISSION_DENIED,
      '纳米权限错误：账号权限不足',
      {
        details: msg,
        retryable: false,
        solution: '请检查账号权限设置',
        originalError: error,
        serviceId: 'nami'
      }
    );
  }

  // 文件过大
  if (lowerMsg.includes('too large') || lowerMsg.includes('size') || lowerMsg.includes('过大')) {
    return createStructuredError(
      UploadErrorCode.FILE_TOO_LARGE,
      '纳米文件错误：文件过大，超出限制',
      {
        details: msg,
        retryable: false,
        solution: '请压缩图片后重试（纳米图床单文件限制 10MB）',
        originalError: error,
        serviceId: 'nami'
      }
    );
  }

  // 服务器错误
  if (lowerMsg.includes('500') || lowerMsg.includes('502') || lowerMsg.includes('503')) {
    return createStructuredError(
      UploadErrorCode.SERVER_ERROR,
      '纳米服务器错误：服务暂时不可用',
      {
        details: msg,
        retryable: true,
        solution: '请稍后重试',
        originalError: error,
        serviceId: 'nami'
      }
    );
  }

  // 通用上传错误
  return createStructuredError(
    UploadErrorCode.UPLOAD_FAILED,
    `纳米上传失败: ${msg}`,
    {
      details: msg,
      retryable: true,
      originalError: error,
      serviceId: 'nami'
    }
  );
}
