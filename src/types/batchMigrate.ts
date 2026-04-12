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

/** 单项迁移实时状态（migrating 阶段 UI 绑定） */
export interface MigrateItemStatus {
  historyId: string;
  fileName: string;
  status: 'pending' | 'downloading' | 'uploading' | 'success' | 'failed' | 'skipped';
  error?: string;
  /** 错误类型：下载失败 / 上传失败 */
  errorType?: 'download' | 'upload';
  serviceResults: Record<string, 'pending' | 'success' | 'failed'>;
}

/** 迁移最终结果 */
export interface MigrateResult {
  successCount: number;
  failedCount: number;
  skippedCount: number;
  failures: Array<{ fileName: string; error: string; errorType?: 'download' | 'upload' }>;
  /** 整体成功但部分目标失败的记录 */
  partialFailures: Array<{ fileName: string; failedTargets: string[] }>;
  /** 非正常结束原因 */
  pauseReason?: 'consecutive-failures' | 'user-cancelled';
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
