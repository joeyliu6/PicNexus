// 图片元信息处理模块 - 获取和缓存图片的宽高、大小等元信息

import { invoke } from '@tauri-apps/api/core';
import type { ImageMetadata } from '../config/types';
import { Semaphore } from '../utils/semaphore';

// ==================== 常量 ====================

export const METADATA_BATCH_SIZE = 50;
export const METADATA_CONCURRENCY = 5;
const MAX_CACHE_SIZE = 500;  // 缓存上限，防止内存无限增长

// ==================== 模块级缓存 ====================

const imageMetadataCache = new Map<string, ImageMetadata>();

// ==================== 公共函数 ====================

/**
 * 获取图片元信息
 * 使用缓存避免重复调用 Rust 命令
 * @param filePath 图片文件路径
 * @returns 图片元信息
 */
export async function getImageMetadata(filePath: string): Promise<ImageMetadata> {
  if (imageMetadataCache.has(filePath)) {
    return imageMetadataCache.get(filePath)!;
  }

  try {
    const metadata = await invoke<ImageMetadata>('get_image_metadata', { filePath });

    // 缓存淘汰：超过上限时删除最早的条目（FIFO）
    if (imageMetadataCache.size >= MAX_CACHE_SIZE) {
      const firstKey = imageMetadataCache.keys().next().value;
      if (firstKey) {
        imageMetadataCache.delete(firstKey);
      }
    }

    imageMetadataCache.set(filePath, metadata);
    return metadata;
  } catch (error) {
    console.error('[元信息] 获取图片元信息失败:', error);
    return {
      width: 0,
      height: 0,
      aspect_ratio: 1,
      file_size: 0,
      format: 'unknown'
    };
  }
}

/**
 * 清理图片元信息缓存
 * @param filePath 可选，指定要清理的文件路径；不传则清理全部
 */
export function clearImageMetadataCache(filePath?: string): void {
  if (filePath) {
    imageMetadataCache.delete(filePath);
  } else {
    imageMetadataCache.clear();
  }
}

/**
 * 批量获取图片元数据（带并发控制和错误隔离）
 * 性能优化：分批获取避免同时发起大量请求
 * 错误隔离：单个图片失败不影响其他图片，失败的返回默认值
 * @param filePaths 文件路径列表
 * @param concurrency 并发数（默认 5）
 * @returns 文件路径到元数据的 Map
 */
export async function fetchMetadataBatch(
  filePaths: string[],
  concurrency: number = METADATA_CONCURRENCY
): Promise<Map<string, ImageMetadata>> {
  const results = new Map<string, ImageMetadata>();
  const semaphore = new Semaphore(concurrency);

  // 使用 Promise.allSettled 确保单个失败不影响整体
  const promises = filePaths.map(async (filePath) => {
    await semaphore.acquire();
    try {
      const metadata = await getImageMetadata(filePath);
      return { filePath, metadata, success: true as const };
    } catch (error) {
      // getImageMetadata 内部已有 try-catch，这里是额外保护
      console.warn('[元信息] 批量获取时单个文件失败:', filePath, error);
      return {
        filePath,
        metadata: {
          width: 0,
          height: 0,
          aspect_ratio: 1,
          file_size: 0,
          format: 'unknown'
        } as ImageMetadata,
        success: false as const
      };
    } finally {
      semaphore.release();
    }
  });

  const settledResults = await Promise.allSettled(promises);

  settledResults.forEach((result) => {
    if (result.status === 'fulfilled') {
      results.set(result.value.filePath, result.value.metadata);
    }
    // rejected 情况理论上不会发生（已被内部 try-catch 捕获）
  });

  return results;
}
