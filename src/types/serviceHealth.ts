// 图床健康状态类型定义

/**
 * 图床健康状态
 * - unconfigured: 必填字段未填完
 * - pending: 字段已填，未验证
 * - verified: 测试连接通过
 * - error: 验证失败或上传失败
 */
export type ServiceHealthStatus = 'unconfigured' | 'pending' | 'verified' | 'error';

/**
 * 单个图床的健康记录
 */
export interface ServiceHealthRecord {
  status: ServiceHealthStatus;
  lastVerifiedAt: number | null;
  lastError: string | null;
  errorSource: 'test' | 'upload' | null;
  filledCount: number;
  totalRequired: number;
}

/**
 * 持久化到磁盘的健康数据（不含实时计算的字段）
 */
export interface PersistedHealthData {
  [serviceId: string]: {
    status: ServiceHealthStatus;
    lastVerifiedAt: number | null;
    lastError: string | null;
    errorSource: 'test' | 'upload' | null;
  };
}

/**
 * 所有图床的健康状态映射
 */
export type ServiceHealthMap = Record<string, ServiceHealthRecord>;

/**
 * 触发状态变红的认证/配置类错误码
 */
export const AUTH_CONFIG_ERROR_CODES = [
  'COOKIE_EXPIRED',
  'COOKIE_INVALID',
  'COOKIE_EMPTY',
  'AUTH_FAILED',
  'TOKEN_EXPIRED',
  'TOKEN_INVALID',
  'CONFIG_MISSING',
  'CONFIG_INVALID',
  'BUCKET_NOT_FOUND',
  'DOMAIN_INVALID',
] as const;
