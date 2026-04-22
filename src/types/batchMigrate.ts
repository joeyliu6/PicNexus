/**
 * 批量迁移相关类型定义
 */

/** 迁移流程阶段：配置 → 执行 → 完成 */
export type MigratePhase = 'configuring' | 'migrating' | 'done';

/** 筛选模式（高级筛选用） */
export type FilterMode = 'all' | 'threshold';

/** 目标图床配置 */
export interface MigrateTargetService {
  serviceId: string;
  displayName: string;
  isConfigured: boolean;
  /** 不在该图床上的图片数（待迁移） */
  pendingCount: number;
  checked: boolean;
}

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

/** 单项迁移实时状态（migrating 阶段 UI 绑定） */
export interface MigrateItemStatus {
  historyId: string;
  fileName: string;
  /** 实际被下载的源 URL（知乎 webp→jpg 优化后的终值），供 UI 列表展示 */
  sourceUrl?: string;
  status: 'pending' | 'downloading' | 'converting' | 'uploading' | 'success' | 'failed' | 'skipped';
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
}

/** 失败项记录（done 态跨条目汇总用） */
export interface MigrateFailureRecord {
  /** 历史记录 ID，供单条重试 / 永久跳过定位使用 */
  historyId: string;
  fileName: string;
  /** 易读错误摘要，与 MigrateItemStatus.error 同一字符串 */
  error: string;
  errorType?: 'download' | 'upload';
  /** 结构化失败详情 */
  details: MigrateFailureDetail[];
}

/** 迁移最终结果 */
export interface MigrateResult {
  successCount: number;
  failedCount: number;
  skippedCount: number;
  failures: MigrateFailureRecord[];
  /** 整体成功但部分目标失败的记录 */
  partialFailures: Array<{ fileName: string; failedTargets: string[] }>;
  /** 非正常结束原因 */
  pauseReason?: 'consecutive-failures' | 'user-cancelled' | 'preload-error';
  /** 总耗时（毫秒） */
  durationMs: number;
  /** 平均速度（字节/秒） */
  avgBytesPerSec: number;
  /** 目标图床 ID 列表 */
  targetServiceIds: string[];
  /** 全量项快照，供终态展示和导出报告使用 */
  itemsSnapshot: MigrateItemStatus[];
}

/** 迁移实时统计（三个统计卡用） */
export interface MigrateStats {
  startTime: number;
  elapsedMs: number;
  processedCount: number;
  totalCount: number;
  /** 已传输字节数（累加每个下载文件的大小） */
  totalBytes: number;
}
