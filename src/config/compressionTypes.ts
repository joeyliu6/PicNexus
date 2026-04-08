// 图片压缩相关类型定义

/** 压缩输出格式 */
export type CompressionOutputFormat = 'original' | 'webp' | 'jpeg';

/** 单个压缩预设方案 */
export interface CompressionPreset {
  /** 预设唯一 ID */
  id: string;
  /** 预设名称 */
  name: string;
  /** 压缩质量 1-100 */
  quality: number;
  /** 输出格式 */
  outputFormat: CompressionOutputFormat;
  /** 最长边限制（像素），0 = 不限制 */
  maxLongSide: number;
  /** 等比缩放百分比，100 = 不缩放，1-99 = 按比例缩小 */
  scalePercent: number;
  /** 跳过小于此值（KB）的文件，0 = 全部压缩 */
  skipIfSmallerKB: number;
  /** 去除 EXIF 元数据 */
  stripExif: boolean;
}

/** 默认压缩预设 */
export const DEFAULT_COMPRESSION_PRESET: CompressionPreset = {
  id: 'default',
  name: '默认',
  quality: 80,
  outputFormat: 'original',
  maxLongSide: 0,
  scalePercent: 100,
  skipIfSmallerKB: 2048,
  stripExif: true,
};

/**
 * 图片压缩配置（支持多预设方案）
 * 控制上传前的图片预处理行为
 */
export interface ImageCompressionConfig {
  /** 是否启用压缩 */
  enabled: boolean;
  /** 当前激活的预设 ID */
  activePresetId: string;
  /** 所有预设方案 */
  presets: CompressionPreset[];
}
