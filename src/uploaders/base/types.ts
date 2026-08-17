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
  metadata?: Record<string, unknown>;
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
  /** 图床特定的配置对象（派生类入口处 cast 为具体 *ServiceConfig） */
  config: unknown;

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

  /**
   * 成功时的补充说明（目前只有 WebDAV 用得上）
   *
   * Why 需要它：多数图床的连接测试只有「通」这一档，通用文案「配置有效」够用。
   * WebDAV 的连接测试却验了两段——先把探针图传上去，再**匿名**访问公开链接确认
   * 拿回来的确实是图片。后半段是用户最容易配错的地方（URL 模板各家自己发明），
   * 所以成功时要把「公开链接也验过了」这句说出来，而不是压成通用的「配置有效」。
   *
   * 失败路径本来就透传 `error`，成功路径不透传是不对称。
   */
  message?: string;

  /**
   * 失败原因是「明文 HTTP 待用户确认」（WebDAV 专属）
   *
   * Why 单独一个布尔而不是让调用方去解析 `error` 文案：`testConnection` 会把
   * 后端的结构化 AppError 压成字符串，类型信息就此丢失。调用方要据此决定
   * 能否弹逃生舱确认框，判文案既脆弱又会随文案改动静默失效。
   */
  lanHttpUnconfirmed?: boolean;
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
