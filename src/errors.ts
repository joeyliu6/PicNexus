// src/errors.ts
// 自定义错误类，用于替代魔术字符串错误处理

/**
 * Cookie 相关错误基类
 */
export class CookieError extends Error {
  constructor(message: string, public readonly originalError?: any) {
    super(message);
    this.name = 'CookieError';
  }
}

/**
 * Cookie 已过期错误
 */
export class CookieExpiredError extends CookieError {
  constructor(message: string = 'Cookie 已过期，请重新获取 Cookie', originalError?: any) {
    super(message, originalError);
    this.name = 'CookieExpiredError';
  }
}

/**
 * Cookie 无效错误
 */
export class InvalidCookieError extends CookieError {
  constructor(message: string = 'Cookie 无效或格式不正确', originalError?: any) {
    super(message, originalError);
    this.name = 'InvalidCookieError';
  }
}

/**
 * 网络错误
 */
export class NetworkError extends Error {
  constructor(
    message: string = '网络连接失败，请检查网络连接或防火墙设置',
    public readonly originalError?: any,
    public readonly retryable: boolean = true
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * 超时错误
 */
export class TimeoutError extends NetworkError {
  constructor(message: string = '请求超时，请检查网络连接', originalError?: any) {
    super(message, originalError, true);
    this.name = 'TimeoutError';
  }
}

/**
 * 配置错误
 */
export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly originalError?: any
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * 文件读取错误
 */
export class FileReadError extends Error {
  constructor(
    message: string,
    public readonly filePath?: string,
    public readonly originalError?: any
  ) {
    super(message);
    this.name = 'FileReadError';
  }
}

/**
 * R2 操作错误
 */
export class R2Error extends Error {
  constructor(
    message: string,
    public readonly operation?: string,
    public readonly originalError?: any
  ) {
    super(message);
    this.name = 'R2Error';
  }
}

/**
 * WebDAV 操作错误
 */
export class WebDAVError extends Error {
  constructor(
    message: string,
    public readonly operation?: string,
    public readonly originalError?: any
  ) {
    super(message);
    this.name = 'WebDAVError';
  }
}

/**
 * 判断错误是否可重试
 * @param error 错误对象
 * @returns 是否可重试
 */
export function isRetryableError(error: any): boolean {
  // NetworkError 和 TimeoutError 默认可重试
  if (error instanceof NetworkError || error instanceof TimeoutError) {
    return error.retryable;
  }
  
  // 其他错误类型不可重试
  if (error instanceof CookieError || 
      error instanceof ConfigError || 
      error instanceof FileReadError) {
    return false;
  }
  
  // 未知错误，检查错误消息中的关键字
  const errorMessage = error?.message?.toLowerCase() || '';
  const retryableKeywords = ['network', 'timeout', '超时', '网络', 'connection', 'econnrefused', 'etimedout'];
  const nonRetryableKeywords = ['cookie', '认证', 'permission', '权限', 'invalid', '无效'];
  
  // 如果包含不可重试的关键字，返回 false
  if (nonRetryableKeywords.some(keyword => errorMessage.includes(keyword))) {
    return false;
  }
  
  // 如果包含可重试的关键字，返回 true
  if (retryableKeywords.some(keyword => errorMessage.includes(keyword))) {
    return true;
  }
  
  // 默认不重试
  return false;
}

/**
 * 判断错误是否为 Cookie 相关错误
 * @param error 错误对象
 * @returns 是否为 Cookie 错误
 */
export function isCookieError(error: any): boolean {
  return error instanceof CookieError;
}

/**
 * 判断错误是否为网络相关错误
 * @param error 错误对象
 * @returns 是否为网络错误
 */
export function isNetworkError(error: any): boolean {
  return error instanceof NetworkError || error instanceof TimeoutError;
}

/**
 * 从微博上传器错误代码转换为自定义错误
 * @param error WeiboUploadError 或其他错误
 * @returns 对应的自定义错误
 */
export function convertWeiboError(error: any): Error {
  const errorCode = error?.code;
  const errorMessage = error?.message || '未知错误';
  const originalError = error?.originalError || error;
  
  switch (errorCode) {
    case 'COOKIE_EXPIRED':
      return new CookieExpiredError(errorMessage, originalError);
    
    case 'COOKIE_ERROR':
    case 'INVALID_COOKIE':
    case 'EMPTY_COOKIE':
      return new InvalidCookieError(errorMessage, originalError);
    
    case 'NETWORK_ERROR':
      return new NetworkError(errorMessage, originalError, true);
    
    case 'TIMEOUT_ERROR':
      return new TimeoutError(errorMessage, originalError);
    
    default:
      // 如果没有代码，尝试从消息中推断错误类型
      const lowerMessage = errorMessage.toLowerCase();
      
      if (lowerMessage.includes('cookie') && (lowerMessage.includes('过期') || lowerMessage.includes('expired'))) {
        return new CookieExpiredError(errorMessage, originalError);
      }
      
      if (lowerMessage.includes('cookie') && (lowerMessage.includes('无效') || lowerMessage.includes('invalid'))) {
        return new InvalidCookieError(errorMessage, originalError);
      }
      
      if (lowerMessage.includes('network') || lowerMessage.includes('网络')) {
        return new NetworkError(errorMessage, originalError, true);
      }
      
      if (lowerMessage.includes('timeout') || lowerMessage.includes('超时')) {
        return new TimeoutError(errorMessage, originalError);
      }
      
      // 默认返回原始错误
      return error instanceof Error ? error : new Error(errorMessage);
  }
}

