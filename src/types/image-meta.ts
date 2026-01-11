/**
 * 图片元数据类型定义
 * 用于时间轴视图的轻量级数据加载
 */

import type { ServiceType } from '../config/types';

/**
 * 图片元数据（轻量级）
 *
 * 用于时间轴视图的布局计算和缩略图渲染
 * 启动时全量加载，内存占用约 100 字节/条
 *
 * @example
 * 10万条元数据 ≈ 10MB 内存
 */
export interface ImageMeta {
  // ==================== 核心字段 ====================

  /** 唯一标识符 */
  id: string;

  /** 上传时间戳（毫秒） */
  timestamp: number;

  /** 本地文件名（用于搜索） */
  localFileName: string;

  // ==================== 布局必需字段 ====================

  /**
   * 宽高比（width / height）
   * Justified Layout 布局计算的唯一必需字段
   * 默认值为 1.0（正方形）
   */
  aspectRatio: number;

  // ==================== 缩略图必需字段 ====================

  /** 主力图床服务 ID */
  primaryService: ServiceType;

  /** 主力图床 URL */
  primaryUrl: string;

  /**
   * 主力图床 fileKey（微博、纳米等需要）
   * 用于生成不同尺寸的缩略图
   */
  primaryFileKey?: string;
}

/**
 * 从 HistoryItem 提取元数据
 */
export function extractMetaFromHistoryItem(item: any): ImageMeta {
  // 提取主力图床的 fileKey
  const primaryResult = item.results?.find(
    (r: any) => r.serviceId === item.primaryService && r.status === 'success'
  );

  return {
    id: item.id,
    timestamp: item.timestamp,
    localFileName: item.localFileName || '',
    aspectRatio: item.aspectRatio || 1.0,
    primaryService: item.primaryService,
    primaryUrl: primaryResult?.result?.url || item.generatedLink,
    primaryFileKey: primaryResult?.result?.fileKey,
  };
}
