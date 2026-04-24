/**
 * 图片元数据类型定义
 * 用于时间轴视图的轻量级数据加载
 */

import type { ServiceType, HistoryItem } from '../config/types';

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

  // ==================== 镜像 fallback ====================

  /**
   * 全部成功上传的镜像服务（主服务排在第 0 位，其他按原 results 顺序）
   * 用于浏览视图主图加载失败时按序 fallback 到其他镜像
   * 仅当一张图片上传到多个图床时才有多个元素
   */
  mirrorServices?: MirrorService[];

  /** 是否已收藏 */
  isFavorited?: boolean;
}

/** 单个镜像图床的精简信息（用于列表缩略图的 fallback 链） */
export interface MirrorService {
  serviceId: ServiceType;
  url: string;
  fileKey?: string;
}

/**
 * 从 HistoryItem 提取元数据
 */
export function extractMetaFromHistoryItem(item: HistoryItem): ImageMeta {
  const mirrorServices = extractMirrorServices(item.results, item.primaryService);
  const primary = mirrorServices[0];

  return {
    id: item.id,
    timestamp: item.timestamp,
    localFileName: item.localFileName || '',
    aspectRatio: item.aspectRatio || 1.0,
    primaryService: item.primaryService as ServiceType,
    primaryUrl: primary?.url || item.generatedLink,
    primaryFileKey: primary?.fileKey,
    mirrorServices: mirrorServices.length > 0 ? mirrorServices : undefined,
    isFavorited: item.isFavorited ?? false,
  };
}

/**
 * 从 results 数组抽出所有成功镜像，主服务排在首位
 * 供 HistoryItem 和底层 rowToImageMeta 共用
 */
export function extractMirrorServices(
  results: HistoryItem['results'] | undefined,
  primaryService: string,
): MirrorService[] {
  if (!results || results.length === 0) return [];
  const mirrors: MirrorService[] = [];
  let primary: MirrorService | undefined;
  for (const r of results) {
    if (r.status !== 'success' || !r.result?.url) continue;
    const entry: MirrorService = {
      serviceId: r.serviceId as ServiceType,
      url: r.result.url,
      fileKey: r.result.fileKey,
    };
    if (r.serviceId === primaryService && !primary) {
      primary = entry;
    } else {
      mirrors.push(entry);
    }
  }
  return primary ? [primary, ...mirrors] : mirrors;
}
