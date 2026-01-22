// 前端错误类型定义，与 Rust 后端 AppError 保持一致
// v2.10: 统一错误处理

/**
 * 错误类型枚举
 * 与 Rust 后端 #[serde(rename = "...")] 保持一致
 */
export type AppErrorType =
  | 'NETWORK'
  | 'AUTH'
  | 'FILE_IO'
  | 'UPLOAD'
  | 'CONFIG'
  | 'CLIPBOARD'
  | 'EXTERNAL'
  | 'SERVICE_UNAVAILABLE'
  | 'VALIDATION'
  | 'WEBDAV'
  | 'STORAGE';

/**
 * 基础错误数据结构（只有 message）
 */
export interface SimpleErrorData {
  message: string;
}

/**
 * 上传错误数据结构
 */
export interface UploadErrorData {
  service: string;
  code: number | null;
  message: string;
}

/**
 * 服务不可用错误数据结构
 */
export interface ServiceUnavailableErrorData {
  service: string;
  message: string;
}

/**
 * AppError 类型 - 与 Rust 后端结构匹配
 * Rust 使用 #[serde(tag = "type", content = "data")] 序列化
 */
export type AppError =
  | { type: 'NETWORK'; data: SimpleErrorData }
  | { type: 'AUTH'; data: SimpleErrorData }
  | { type: 'FILE_IO'; data: SimpleErrorData }
  | { type: 'UPLOAD'; data: UploadErrorData }
  | { type: 'CONFIG'; data: SimpleErrorData }
  | { type: 'CLIPBOARD'; data: SimpleErrorData }
  | { type: 'EXTERNAL'; data: SimpleErrorData }
  | { type: 'SERVICE_UNAVAILABLE'; data: ServiceUnavailableErrorData }
  | { type: 'VALIDATION'; data: SimpleErrorData }
  | { type: 'WEBDAV'; data: SimpleErrorData }
  | { type: 'STORAGE'; data: SimpleErrorData };

/**
 * 检查错误是否为 AppError 结构
 */
export function isAppError(error: unknown): error is AppError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const obj = error as Record<string, unknown>;
  if (typeof obj.type !== 'string' || typeof obj.data !== 'object' || obj.data === null) {
    return false;
  }

  const validTypes: AppErrorType[] = [
    'NETWORK',
    'AUTH',
    'FILE_IO',
    'UPLOAD',
    'CONFIG',
    'CLIPBOARD',
    'EXTERNAL',
    'SERVICE_UNAVAILABLE',
    'VALIDATION',
    'WEBDAV',
    'STORAGE',
  ];

  return validTypes.includes(obj.type as AppErrorType);
}

/**
 * 从任意错误中提取用户友好的错误消息
 */
export function getErrorMessage(error: unknown): string {
  // 如果是 AppError，提取 message
  if (isAppError(error)) {
    return error.data.message;
  }

  // 如果是标准 Error 对象
  if (error instanceof Error) {
    return error.message;
  }

  // 如果是字符串
  if (typeof error === 'string') {
    return error;
  }

  // 如果是带 message 属性的对象
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const msg = (error as { message: unknown }).message;
    if (typeof msg === 'string') {
      return msg;
    }
  }

  // 兜底
  return '未知错误';
}

/**
 * 获取错误类型
 */
export function getErrorType(error: unknown): AppErrorType | 'UNKNOWN' {
  if (isAppError(error)) {
    return error.type;
  }
  return 'UNKNOWN';
}

/**
 * 检查是否为认证错误（Cookie 过期等）
 */
export function isAuthError(error: unknown): boolean {
  return isAppError(error) && error.type === 'AUTH';
}

/**
 * 检查是否为网络错误
 */
export function isNetworkError(error: unknown): boolean {
  return isAppError(error) && error.type === 'NETWORK';
}

/**
 * 检查是否为上传错误
 */
export function isUploadError(error: unknown): error is { type: 'UPLOAD'; data: UploadErrorData } {
  return isAppError(error) && error.type === 'UPLOAD';
}

/**
 * 获取上传错误的服务名
 */
export function getUploadErrorService(error: unknown): string | null {
  if (isUploadError(error)) {
    return error.data.service;
  }
  return null;
}

/**
 * 获取上传错误的错误码
 */
export function getUploadErrorCode(error: unknown): number | null {
  if (isUploadError(error)) {
    return error.data.code;
  }
  return null;
}

/**
 * 根据错误类型生成用户提示
 */
export function getErrorHint(error: unknown): string | null {
  if (!isAppError(error)) {
    return null;
  }

  switch (error.type) {
    case 'AUTH':
      return '请检查登录状态或重新登录';
    case 'NETWORK':
      return '请检查网络连接后重试';
    case 'FILE_IO':
      return '请检查文件是否存在或权限是否正确';
    case 'VALIDATION':
      return '请检查输入参数是否正确';
    case 'UPLOAD':
      return `${error.data.service} 上传失败，请稍后重试`;
    case 'SERVICE_UNAVAILABLE':
      return `${(error.data as ServiceUnavailableErrorData).service} 服务暂时不可用`;
    default:
      return null;
  }
}
