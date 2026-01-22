// 统一的错误码和结构化错误定义

/**
 * 上传错误码枚举
 */
export enum UploadErrorCode {
  // 认证错误 (1xxx)
  COOKIE_EXPIRED = 'COOKIE_EXPIRED',
  COOKIE_INVALID = 'COOKIE_INVALID',
  COOKIE_EMPTY = 'COOKIE_EMPTY',
  AUTH_FAILED = 'AUTH_FAILED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',

  // 配置错误 (2xxx)
  CONFIG_MISSING = 'CONFIG_MISSING',
  CONFIG_INVALID = 'CONFIG_INVALID',
  BUCKET_NOT_FOUND = 'BUCKET_NOT_FOUND',
  DOMAIN_INVALID = 'DOMAIN_INVALID',

  // 网络错误 (3xxx)
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  CONNECTION_REFUSED = 'CONNECTION_REFUSED',

  // 权限错误 (4xxx)
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  ACCESS_DENIED = 'ACCESS_DENIED',

  // 文件错误 (5xxx)
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  FILE_TYPE_INVALID = 'FILE_TYPE_INVALID',

  // 限流错误 (6xxx)
  RATE_LIMIT = 'RATE_LIMIT',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',

  // 通用错误 (9xxx)
  UNKNOWN = 'UNKNOWN',
  UPLOAD_FAILED = 'UPLOAD_FAILED',
  SERVER_ERROR = 'SERVER_ERROR'
}

/**
 * 结构化错误接口
 */
export interface StructuredError {
  /** 错误码 */
  code: UploadErrorCode;

  /** 用户友好的错误消息 */
  message: string;

  /** 技术细节（用于日志） */
  details?: string;

  /** 是否可重试 */
  retryable: boolean;

  /** 建议的解决方案 */
  solution?: string;

  /** 原始错误对象 */
  originalError?: any;

  /** 所属图床 */
  serviceId?: string;
}

/**
 * 创建结构化错误
 */
export function createStructuredError(
  code: UploadErrorCode,
  message: string,
  options?: {
    details?: string;
    retryable?: boolean;
    solution?: string;
    originalError?: any;
    serviceId?: string;
  }
): StructuredError {
  return {
    code,
    message,
    details: options?.details,
    retryable: options?.retryable ?? true,
    solution: options?.solution,
    originalError: options?.originalError,
    serviceId: options?.serviceId
  };
}

