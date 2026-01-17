/**
 * 图片元数据修复器
 * 用于处理没有宽高信息的历史图片（迁移前的数据）
 * 支持批量更新数据库
 */

import { ref, shallowRef } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { HistoryItem, ImageMetadata } from '../config/types';

// ==================== 类型定义 ====================

/** 元数据修复结果 */
export interface MetadataFixResult {
  width: number;
  height: number;
  aspectRatio: number;
}

/** 可修复元数据的项（最小接口） */
export interface FixableItem {
  id: string;
  filePath?: string;
  width?: number;
  height?: number;
  aspectRatio?: number;
}

/** 待更新的元数据项 */
interface PendingUpdate {
  id: string;
  width: number;
  height: number;
  aspectRatio: number;
}

// ==================== 单例状态 ====================

/** 待批量更新的记录 */
const pendingUpdates = shallowRef<Map<string, PendingUpdate>>(new Map());

/** 刷新定时器 */
let flushTimer: number | null = null;

/** 刷新延迟（毫秒） */
const FLUSH_DELAY = 2000;

/** 是否正在刷新 */
const isFlushing = ref(false);

// ==================== 主 Composable ====================

/**
 * 图片元数据修复器 Composable
 * 使用单例模式，多个组件共享同一个更新队列
 */
export function useImageMetadataFixer() {
  /**
   * 检查并修复图片元数据
   * 如果图片缺少宽高信息，尝试从本地文件或网络获取
   *
   * @param item 历史记录项
   * @returns 修复后的元数据，或 null（如果无法修复）
   */
  async function fixMissingMetadata(item: HistoryItem): Promise<MetadataFixResult | null> {
    // 已有有效数据，直接返回
    if (hasValidMetadata(item)) {
      return {
        width: item.width!,
        height: item.height!,
        aspectRatio: item.aspectRatio || item.width! / item.height!,
      };
    }

    // 尝试从本地文件获取
    if (item.filePath) {
      try {
        const metadata = await getMetadataFromFile(item.filePath);
        if (metadata) {
          // 加入待更新队列
          queueUpdate(item.id, metadata);
          return metadata;
        }
      } catch (e) {
        console.warn(`[MetadataFixer] 无法读取本地文件: ${item.filePath}`, e);
      }
    }

    // 无法修复，返回默认值（正方形）
    return { width: 200, height: 200, aspectRatio: 1 };
  }

  /**
   * 批量检查并修复元数据
   * 返回需要修复的项的 ID 列表
   *
   * @param items 历史记录项数组
   * @returns 需要修复的项数量
   */
  async function batchFixMissingMetadata(items: FixableItem[]): Promise<number> {
    const needsFix = items.filter((item) => !hasValidMetadata(item));

    if (needsFix.length === 0) {
      return 0;
    }

    let fixedCount = 0;

    // 并行处理，但限制并发数
    const CONCURRENT_LIMIT = 5;
    const chunks = chunkArray(needsFix, CONCURRENT_LIMIT);

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(async (item) => {
          if (item.filePath) {
            try {
              const metadata = await getMetadataFromFile(item.filePath);
              if (metadata) {
                queueUpdate(item.id, metadata);
                return true;
              }
            } catch {
              // 忽略错误，继续处理下一个
            }
          }
          return false;
        })
      );

      fixedCount += results.filter((r) => r.status === 'fulfilled' && r.value).length;
    }

    return fixedCount;
  }

  /**
   * 从 URL 加载图片尺寸
   * 用于没有本地文件的情况（较慢，网络请求）
   *
   * @param url 图片 URL
   * @returns 图片尺寸
   */
  function loadImageSizeFromUrl(url: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        resolve({
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      };
      img.onerror = () => {
        reject(new Error(`无法加载图片: ${url}`));
      };
      img.src = url;
    });
  }

  /**
   * 立即刷新待更新队列到数据库
   */
  async function flushNow(): Promise<number> {
    if (pendingUpdates.value.size === 0) {
      return 0;
    }

    if (isFlushing.value) {
      // 已经在刷新中，等待完成
      return 0;
    }

    isFlushing.value = true;

    // 取出当前队列
    const updates = Array.from(pendingUpdates.value.values());
    pendingUpdates.value = new Map();

    // 清除定时器
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    try {
      // 动态导入数据库模块，避免循环依赖
      const { historyDB } = await import('../services/HistoryDatabase');

      // 批量更新数据库
      let successCount = 0;
      for (const update of updates) {
        try {
          await historyDB.update(update.id, {
            width: update.width,
            height: update.height,
            aspectRatio: update.aspectRatio,
          });
          successCount++;
        } catch (e) {
          console.error(`[MetadataFixer] 更新失败: ${update.id}`, e);
        }
      }

      console.log(`[MetadataFixer] 批量更新完成: ${successCount}/${updates.length}`);
      return successCount;
    } finally {
      isFlushing.value = false;
    }
  }

  /**
   * 获取待更新队列的大小
   */
  function getPendingCount(): number {
    return pendingUpdates.value.size;
  }

  /**
   * 清空待更新队列（不写入数据库）
   */
  function clearPending(): void {
    pendingUpdates.value = new Map();
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  return {
    fixMissingMetadata,
    batchFixMissingMetadata,
    loadImageSizeFromUrl,
    flushNow,
    getPendingCount,
    clearPending,
    isFlushing,
  };
}

// ==================== 辅助函数 ====================

/**
 * 检查是否有有效的元数据
 */
function hasValidMetadata(item: FixableItem): boolean {
  return !!(
    item.width &&
    item.height &&
    item.width > 0 &&
    item.height > 0 &&
    item.aspectRatio &&
    item.aspectRatio > 0
  );
}

/**
 * 从本地文件获取元数据（调用 Rust 命令）
 */
async function getMetadataFromFile(filePath: string): Promise<MetadataFixResult | null> {
  try {
    const metadata = await invoke<ImageMetadata>('get_image_metadata', {
      filePath,
    });

    if (metadata && metadata.width > 0 && metadata.height > 0) {
      return {
        width: metadata.width,
        height: metadata.height,
        aspectRatio: metadata.aspect_ratio || metadata.width / metadata.height,
      };
    }
  } catch (e) {
    // 文件可能已被删除或移动
    console.warn(`[MetadataFixer] 无法获取文件元数据: ${filePath}`, e);
  }

  return null;
}

/**
 * 加入待更新队列
 */
function queueUpdate(id: string, metadata: MetadataFixResult): void {
  const newMap = new Map(pendingUpdates.value);
  newMap.set(id, {
    id,
    width: metadata.width,
    height: metadata.height,
    aspectRatio: metadata.aspectRatio,
  });
  pendingUpdates.value = newMap;

  // 设置延迟刷新
  scheduleFlush();
}

/**
 * 调度延迟刷新
 */
function scheduleFlush(): void {
  if (flushTimer) {
    return; // 已有定时器，不重复设置
  }

  flushTimer = window.setTimeout(async () => {
    flushTimer = null;
    const fixer = useImageMetadataFixer();
    await fixer.flushNow();
  }, FLUSH_DELAY);
}

/**
 * 数组分块
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
