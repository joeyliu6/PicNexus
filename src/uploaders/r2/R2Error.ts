// Cloudflare R2 上传错误处理

import { UploadErrorCode, StructuredError, createStructuredError } from '../base/ErrorTypes';

/**
 * R2 上传错误类
 */
export class R2UploadError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly originalError?: any
  ) {
    super(message);
    this.name = 'R2UploadError';
  }
}

/**
 * 转换通用错误为 R2 错误
 */
export function convertToR2Error(error: any): R2UploadError {
  if (error instanceof R2UploadError) {
    return error;
  }

  const msg = error?.message || String(error);

  // 认证错误
  if (msg.includes('authentication') || msg.includes('credentials') || msg.includes('AccessDenied')) {
    return new R2UploadError(
      'R2 认证失败：请检查 Account ID、Access Key ID 和 Secret Access Key 是否正确',
      'AUTH_ERROR',
      error
    );
  }

  // 存储桶错误
  if (msg.includes('bucket') || msg.includes('NoSuchBucket')) {
    return new R2UploadError(
      'R2 存储桶不存在：请检查 Bucket Name 是否正确',
      'BUCKET_ERROR',
      error
    );
  }

  // 网络错误
  if (msg.includes('network') || msg.includes('timeout') || msg.includes('ECONNREFUSED')) {
    return new R2UploadError(
      'R2 网络错误：无法连接到 Cloudflare R2 服务',
      'NETWORK_ERROR',
      error
    );
  }

  // 权限错误
  if (msg.includes('permission') || msg.includes('Forbidden')) {
    return new R2UploadError(
      'R2 权限错误：Access Key 没有上传权限',
      'PERMISSION_ERROR',
      error
    );
  }

  // 通用上传错误
  return new R2UploadError(
    `R2 上传失败: ${msg}`,
    'UPLOAD_ERROR',
    error
  );
}

/**
 * 新增：转换为结构化错误
 */
export function convertToStructuredR2Error(error: any): StructuredError {
  const r2Error = convertToR2Error(error);

  let code: UploadErrorCode;
  let retryable = false;
  let solution: string | undefined;

  switch (r2Error.code) {
    case 'AUTH_ERROR':
      code = UploadErrorCode.AUTH_FAILED;
      solution = '请检查 R2 的 Account ID、Access Key ID 和 Secret Access Key';
      break;
    case 'BUCKET_ERROR':
      code = UploadErrorCode.BUCKET_NOT_FOUND;
      solution = '请检查 Bucket Name 是否正确';
      break;
    case 'NETWORK_ERROR':
      code = UploadErrorCode.NETWORK_ERROR;
      retryable = true;
      solution = '请检查网络连接后重试';
      break;
    case 'PERMISSION_ERROR':
      code = UploadErrorCode.PERMISSION_DENIED;
      solution = '请检查 Access Key 是否有上传权限';
      break;
    case 'UPLOAD_ERROR':
    default:
      code = UploadErrorCode.UPLOAD_FAILED;
      retryable = true;
      break;
  }

  return createStructuredError(code, r2Error.message, {
    details: r2Error.originalError?.message,
    retryable,
    solution,
    originalError: r2Error.originalError,
    serviceId: 'r2'
  });
}
