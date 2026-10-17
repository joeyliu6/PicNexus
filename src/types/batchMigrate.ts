/**
 * 补充备份（单张图迁移管线 migrateCore）的类型
 */

/**
 * 跳过的原因：目标上本来就有 / 停止或中止时还没轮到 / 抢救模式下已不需要 / 处理前记录被删了
 */
export type MigrateSkipReason = 'already-there' | 'not-attempted' | 'not-needed' | 'deleted';

/**
 * 单次失败的技术细节
 *
 * - 上传失败时每个目标图床产生一条 detail，serviceId 指明是哪个图床
 * - 下载/元数据失败时只有一条 detail，serviceId 为空
 * - message 已经剥掉 "xxx 上传失败:" 等前缀，只保留技术错误原文
 */
export interface MigrateFailureDetail {
  /** 失败发生的目标图床 serviceId；下载/元数据阶段失败时为空 */
  serviceId?: string;
  /** 纯技术错误消息，已去掉上传失败前缀 */
  message: string;
}

/** 单张图迁移的实时状态 */
export interface MigrateItemStatus {
  historyId: string;
  fileName: string;
  /** 实际被下载的源 URL（知乎 webp→jpg 优化后的终值），供 UI 列表展示 */
  sourceUrl?: string;
  status: 'pending' | 'downloading' | 'converting' | 'uploading' | 'success' | 'failed' | 'skipped';
  /**
   * 为什么跳过（只在 status === 'skipped' 时有值）
   *
   * 完成页据此分开说「N 张本来就有」和「N 张没处理」——取消 / 中止后剩下的条目也归入 skipped，
   * 混在一起就会把「没来得及做」说成「本来就有」。
   */
  skipReason?: MigrateSkipReason;
  /**
   * 易读错误摘要（UI 直接展示用）。
   * 由 failureDetails 拼成 `displayName · message；displayName · message` 格式，不再含重复前缀
   */
  error?: string;
  /** 错误类型：下载失败 / 上传失败（转换失败归 upload，避免 errorType 联合爆炸） */
  errorType?: 'download' | 'upload';
  /** 结构化失败详情（供复制、重试等逻辑按图床细分使用） */
  failureDetails?: MigrateFailureDetail[];
  /** 实际触发了 compress_image 时，记录目标格式（如 'jpeg'）。UI 用来区分「已转 JPEG」与「格式兼容」 */
  convertedFormat?: string;
  serviceResults: Record<string, 'pending' | 'success' | 'failed'>;
  /**
   * 迁移前该图片已成功存在的图床 serviceId 列表（从 HistoryItem.results 快照）。
   * UI 用它渲染「存在于」logo 带；与 serviceResults 里新成功的 target 组合出「新增」视觉。
   */
  existingServiceIds?: string[];
  /** 本次迁移实际选用的下载源图床，用于可恢复图片模式的列表与报告解释 */
  sourceServiceId?: string;
  /** 普通补传模式下由左栏来源筛选得到的候选下载源；为空表示不限来源 */
  preferredSourceServiceIds?: string[];
  /** 可恢复图片模式下，该图片里已检测异常的图床 */
  problemServiceIds?: string[];
}

/** 迁移统计（下载字节数等） */
export interface MigrateStats {
  startTime: number;
  elapsedMs: number;
  processedCount: number;
  totalCount: number;
  /** 已传输字节数（累加每个下载文件的大小） */
  totalBytes: number;
}
