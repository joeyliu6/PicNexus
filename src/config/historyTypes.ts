// 历史记录和杂项类型定义

import { UploadResult } from '../uploaders/base/types';

/**
 * 历史记录项（新架构）
 * 支持多图床并行上传结果
 */
export interface HistoryItem {
  /** 唯一标识符 */
  id: string;

  /** 上传时间戳 */
  timestamp: number;

  /** 原始本地文件名 */
  localFileName: string;

  /** 原始文件路径（用于重试上传） */
  filePath?: string;

  /** 主力图床（第一个上传成功的图床，支持复合 ID） */
  primaryService: string;

  /** 所有图床的上传结果 */
  results: Array<{
    /** 图床服务 ID（支持复合 ID 如 custom_s3:xxx） */
    serviceId: string;

    /** 上传结果 */
    result?: UploadResult;

    /** 上传状态 */
    status: 'success' | 'failed';

    /** 错误信息（如果失败） */
    error?: string;
  }>;

  /** 最终生成的链接（基于主力图床） */
  generatedLink: string;

  /** 链接检测状态（每个图床的检测结果） */
  linkCheckStatus?: {
    [serviceId: string]: {
      isValid: boolean;
      lastCheckTime: number;
      statusCode?: number;
      errorType: 'success' | 'http_4xx' | 'http_5xx' | 'timeout' | 'network' | 'pending';
      responseTime?: number;
      error?: string;
    };
  };

  /** 汇总状态（用于快速筛选） */
  linkCheckSummary?: {
    totalLinks: number;
    validLinks: number;
    invalidLinks: number;
    uncheckedLinks: number;
    lastCheckTime?: number;
  };

  // ========== 图片元信息字段（用于 Justified Layout 布局） ==========

  /** 图片宽度（像素） */
  width?: number;

  /** 图片高度（像素） */
  height?: number;

  /** 宽高比（width / height） */
  aspectRatio?: number;

  /** 文件大小（字节） */
  fileSize?: number;

  /** 图片格式（jpg, png, webp, gif, bmp 等） */
  format?: string;

  /** 是否已收藏 */
  isFavorited?: boolean;

  /**
   * 是否在批量迁移中永久跳过
   * - true 时 getItemsByBackupCountQuery / getServiceDistributionQuery 不再返回该条
   * - 用户在失败项手动点「跳过」写入；可在设置页一键清空
   */
  migrationSkip?: boolean;
}

/**
 * 图片元数据接口（简化版）
 * 由 Rust 后端 get_image_metadata 命令返回
 * 性能优化：移除了 color_type 和 has_alpha 字段，这些字段实际使用中不需要
 */
export interface ImageMetadata {
  /** 图片宽度（像素） */
  width: number;
  /** 图片高度（像素） */
  height: number;
  /** 宽高比（width / height） */
  aspect_ratio: number;
  /** 文件大小（字节） */
  file_size: number;
  /** 图片格式（jpg, png, webp, gif, bmp 等） */
  format: string;
}

/**
 * 服务可用性检测状态
 * 用于持久化保存服务检测结果，实现智能检测策略
 */
export interface ServiceCheckStatus {
  /** 上次检测时间戳 */
  lastCheckTime: number | null;
  /** 上次检测结果 */
  lastCheckResult: boolean;
  /** 下次检测时间戳（仅可用时有效） */
  nextCheckTime: number | null;
}

/**
 * 单个 profile 的同步记录
 */
export interface ProfileSyncRecord {
  providerName: string;
  configLastSync: string | null;
  configSyncResult: 'success' | 'failed' | 'partial' | null;
  configSyncError?: string;
  historyLastSync: string | null;
  historySyncResult: 'success' | 'failed' | 'partial' | null;
  historySyncError?: string;
}

/**
 * 同步状态
 * 按 profileId 隔离存储，每个 WebDAV 配置独立维护同步记录
 */
export interface SyncStatus {
  /** 按 profileId 索引的同步记录 */
  syncByProfile: Record<string, ProfileSyncRecord>;

  /** @deprecated 使用 jdCheckStatus 代替 */
  lastJdCheck?: number;

  /** 京东图床检测状态 */
  jdCheckStatus?: ServiceCheckStatus;

  /** 七鱼图床检测状态 */
  qiyuCheckStatus?: ServiceCheckStatus;
}
