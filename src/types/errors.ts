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
  | 'WEBDAV_LAN_HTTP_UNCONFIRMED'
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
  /**
   * WebDAV 地址解析进代理 fake-ip 池，判不出是否局域网
   *
   * 唯一可由用户显式确认后放行的一档（Rust 侧 `LanHttpConsent`）。
   * 前端据此决定能否弹逃生舱确认框——按类型分流，不匹配文案。
   */
  | { type: 'WEBDAV_LAN_HTTP_UNCONFIRMED'; data: SimpleErrorData }
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
    'WEBDAV_LAN_HTTP_UNCONFIRMED',
    'STORAGE',
  ];

  return validTypes.includes(obj.type as AppErrorType);
}

/**
 * 是否为「明文 HTTP 待用户确认」这一档
 *
 * 只有这一档允许提供逃生舱（见 Rust 侧 `LanHttpConsent` 的 doc）。
 * 判类型而不是判文案：文案改动不该让这个分支静默失效。
 */
export function isLanHttpUnconfirmedError(error: unknown): boolean {
  return isAppError(error) && error.type === 'WEBDAV_LAN_HTTP_UNCONFIRMED';
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
 * 检查是否为认证错误（Cookie 过期等）
 */
export function isAuthError(error: unknown): boolean {
  return isAppError(error) && error.type === 'AUTH';
}
