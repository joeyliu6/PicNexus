// 京东图床错误处理

import { UploadErrorCode, StructuredError, createStructuredError } from '../base/ErrorTypes';

/**
 * 京东上传错误类
 */
export class JDUploadError extends Error {
  constructor(
    message: string,
    public readonly code?: UploadErrorCode,
    public readonly originalError?: any
  ) {
    super(message);
    this.name = 'JDUploadError';
  }
}

/**
 * 转换通用错误为京东结构化错误
 */
export function convertToJDError(error: any): StructuredError {
  const msg = error?.message || String(error);
  const lowerMsg = msg.toLowerCase();

  // 网络错误
  if (lowerMsg.includes('network') || lowerMsg.includes('timeout') || lowerMsg.includes('econnrefused')) {
    return createStructuredError(
      UploadErrorCode.NETWORK_ERROR,
      '京东网络错误：无法连接到京东图床服务',
      {
        details: msg,
        retryable: true,
        solution: '请检查网络连接后重试',
        originalError: error,
        serviceId: 'jd'
      }
    );
  }

  // 限流错误
  if (lowerMsg.includes('rate limit') || lowerMsg.includes('too many requests') || lowerMsg.includes('429')) {
    return createStructuredError(
      UploadErrorCode.RATE_LIMIT,
      '京东限流错误：请求过于频繁',
      {
        details: msg,
        retryable: true,
        solution: '请稍后再试，避免频繁上传',
        originalError: error,
        serviceId: 'jd'
      }
    );
  }

  // 文件错误
  if (lowerMsg.includes('file') && (lowerMsg.includes('not found') || lowerMsg.includes('无法找到'))) {
    return createStructuredError(
      UploadErrorCode.FILE_NOT_FOUND,
      '京东文件错误：文件不存在或无法读取',
      {
        details: msg,
        retryable: false,
        solution: '请确认文件路径正确',
        originalError: error,
        serviceId: 'jd'
      }
    );
  }

  // 文件过大
  if (lowerMsg.includes('too large') || lowerMsg.includes('size') || lowerMsg.includes('过大')) {
    return createStructuredError(
      UploadErrorCode.FILE_TOO_LARGE,
      '京东文件错误：文件过大，超出限制',
      {
        details: msg,
        retryable: false,
        solution: '请压缩图片后重试',
        originalError: error,
        serviceId: 'jd'
      }
    );
  }

  // 服务器错误
  if (lowerMsg.includes('500') || lowerMsg.includes('502') || lowerMsg.includes('503')) {
    return createStructuredError(
      UploadErrorCode.SERVER_ERROR,
      '京东服务器错误：服务暂时不可用',
      {
        details: msg,
        retryable: true,
        solution: '请稍后重试',
        originalError: error,
        serviceId: 'jd'
      }
    );
  }

  // 通用上传错误
  return createStructuredError(
    UploadErrorCode.UPLOAD_FAILED,
    `京东上传失败: ${msg}`,
    {
      details: msg,
      retryable: true,
      originalError: error,
      serviceId: 'jd'
    }
  );
}
