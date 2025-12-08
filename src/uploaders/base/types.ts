// src/uploaders/base/types.ts
// 共享类型定义

/**
 * 上传结果接口
 * 所有上传器返回的标准化结果格式
 */
export interface UploadResult {
  /** 所属图床标识 ('weibo' | 'r2' | 'nami' | ...) */
  serviceId: string;

  /** 文件唯一标识（微博：PID，R2：Key，其他图床：各自的标识符） */
  fileKey: string;

  /** 公开访问链接 */
  url: string;

  /** 文件大小（字节） */
  size?: number;

  /** 图片宽度（像素） */
  width?: number;

  /** 图片高度（像素） */
  height?: number;

  /** 扩展元数据（图床特定的额外信息） */
  metadata?: Record<string, any>;
}

/**
 * 配置验证结果
 */
export interface ValidationResult {
  /** 配置是否有效 */
  valid: boolean;

  /** 缺失的必填字段列表 */
  missingFields?: string[];

  /** 验证错误信息列表 */
  errors?: string[];
}

/**
 * 上传选项
 * 传递给上传器的额外参数
 */
export interface UploadOptions {
  /** 图床特定的配置对象 */
  config: any;

  /** 超时时间（毫秒） */
  timeout?: number;

  /** 是否自动重试 */
  retry?: boolean;

  /** 最大重试次数 */
  maxRetries?: number;
}

/**
 * 连接测试结果
 */
export interface ConnectionTestResult {
  /** 测试是否成功 */
  success: boolean;

  /** 响应时间（毫秒） */
  latency?: number;

  /** 错误信息 */
  error?: string;
}

/**
 * 进度回调函数类型
 * @param percent 进度百分比 (0-100)
 * @param step 当前步骤描述（可选）
 * @param stepIndex 当前步骤索引（可选，从1开始）
 * @param totalSteps 总步骤数（可选）
 */
export type ProgressCallback = (
  percent: number,
  step?: string,
  stepIndex?: number,
  totalSteps?: number
) => void;
