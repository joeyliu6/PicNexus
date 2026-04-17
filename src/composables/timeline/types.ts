/**
 * 虚拟时间轴共享类型定义
 */

import type { ImageMeta } from '../../types/image-meta';

/** 图片分组 */
export interface PhotoGroup {
  /** 分组 ID（如 '2024-5-15'） */
  id: string;
  /** 分组标签（如 '2024年5月15日'） */
  label: string;
  /** 年份 */
  year: number;
  /** 月份 (0-11) */
  month: number;
  /** 日期 */
  day: number;
  /** 日期对象 */
  date: Date;
  /** 该分组的图片元数据 */
  items: ImageMeta[];
  /** SQL 聚合的预期图片数量（骨架高度估算用，仅按需加载模式下填充） */
  expectedCount?: number;
  /** 是否为骨架占位（items 为空，尚未从 DB 加载）*/
  isSkeleton?: boolean;
}

/** 可见图片项（用于渲染） */
export interface VisibleItem {
  /** 图片元数据 */
  meta: ImageMeta;
  /** x 坐标 */
  x: number;
  /** y 坐标 */
  y: number;
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
  /** 所属分组 ID */
  groupId: string;
}

/** 可见分组头部 */
export interface VisibleHeader {
  /** 分组 ID */
  groupId: string;
  /** 分组标签 */
  label: string;
  /** y 坐标 */
  y: number;
  /** 高度 */
  height: number;
}

/** 虚拟时间轴配置 */
export interface VirtualTimelineOptions {
  /** 目标行高 */
  targetRowHeight?: number;
  /** 图片间距 */
  gap?: number;
  /** 分组头部高度 */
  headerHeight?: number;
  /** 分组间距 */
  groupGap?: number;
  /** 最大行高 */
  maxRowHeight?: number;
  /** 可视区域上下额外渲染的行数 */
  overscan?: number;
}

/** 默认配置 */
export const DEFAULT_OPTIONS: Required<VirtualTimelineOptions> = {
  targetRowHeight: 200,
  gap: 4,
  headerHeight: 48,
  groupGap: 24,
  maxRowHeight: 300,
  overscan: 3,
};

/** 快速模式占位符项 */
export interface FastModeItem {
  x: number;
  y: number;
  width: number;
  height: number;
}
