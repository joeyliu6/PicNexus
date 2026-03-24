// 历史记录保存模块 - 管理上传历史的保存和更新

import { basename } from '@tauri-apps/api/path';
import type { HistoryItem } from '../config/types';
import type { SingleServiceResult, MultiUploadResult } from '../core/MultiServiceUploader';
import { historyDB } from '../services/HistoryDatabase';
import { invalidateCache } from './useHistory';
import { emitHistoryUpdated } from '../events/cacheEvents';
import { getImageMetadata, clearImageMetadataCache } from './useImageMetadata';
import { createLogger } from '../utils/logger';

const log = createLogger('HistorySaver');

// ==================== 类型定义 ====================

export interface UseHistorySaverReturn {
  saveHistoryItem(
    filePath: string,
    uploadResult: MultiUploadResult,
    customId?: string,
    liveResults?: SingleServiceResult[]
  ): Promise<string | undefined>;

  saveHistoryItemImmediate(
    filePath: string,
    firstResult: SingleServiceResult,
    historyId: string
  ): Promise<void>;

  addResultToHistoryItem(
    historyId: string,
    result: SingleServiceResult
  ): Promise<boolean>;
}

// ==================== 内部辅助函数 ====================

/**
 * 获取文件名（容错处理）
 */
async function getFileName(filePath: string): Promise<string> {
  try {
    const name = await basename(filePath);
    if (name && name.trim().length > 0) {
      return name;
    }
  } catch {
    // 回退到手动解析
  }
  return filePath.split(/[/\\]/).pop() || '未知文件';
}

/**
 * 同一条历史记录的追加更新队列
 * 解决并发 addResultToHistoryItem 的读改写覆盖问题
 */
const historyUpdateQueue = new Map<string, Promise<void>>();

async function withHistoryUpdateQueue<T>(
  historyId: string,
  task: () => Promise<T>
): Promise<T> {
  const previous = historyUpdateQueue.get(historyId) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const currentGate = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const chained = previous.catch(() => {}).then(() => currentGate);
  historyUpdateQueue.set(historyId, chained);

  await previous.catch(() => {});

  try {
    return await task();
  } finally {
    releaseCurrent();
    if (historyUpdateQueue.get(historyId) === chained) {
      historyUpdateQueue.delete(historyId);
    }
  }
}

// ==================== 主 Composable ====================

/**
 * 历史记录保存 Composable
 *
 * 提供三种保存方式：
 * 1. saveHistoryItem - 完整保存（所有图床上传完成后）
 * 2. saveHistoryItemImmediate - 立即保存（第一个成功结果）
 * 3. addResultToHistoryItem - 追加结果（后续成功/失败结果）
 */
export function useHistorySaver(): UseHistorySaverReturn {
  /**
   * 保存历史记录（多图床结果）
   * 直接插入 SQLite，无需读取全部数据
   */
  async function saveHistoryItem(
    filePath: string,
    uploadResult: MultiUploadResult,
    customId?: string,
    liveResults?: SingleServiceResult[]
  ): Promise<string | undefined> {
    try {
      const fileName = await getFileName(filePath);

      // 使用 liveResults 或回退到 uploadResult.results
      const resultsSource = liveResults || uploadResult.results;

      const newItemId = customId || crypto.randomUUID();
      const metadata = await getImageMetadata(filePath);

      const newItem: HistoryItem = {
        id: newItemId,
        localFileName: fileName,
        timestamp: Date.now(),
        filePath: filePath,
        results: resultsSource,
        primaryService: uploadResult.primaryService,
        generatedLink: uploadResult.primaryUrl || '',
        width: metadata.width,
        height: metadata.height,
        aspectRatio: metadata.aspect_ratio,
        fileSize: metadata.file_size,
        format: metadata.format
      };

      await historyDB.insertOrIgnore(newItem);
      log.info('[历史记录] 已保存:', newItem.localFileName, '(尺寸:', metadata.width, 'x', metadata.height, ')');

      invalidateCache();
      clearImageMetadataCache(filePath);

      return newItem.id;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('[历史记录] 保存失败:', error);
      throw new Error(`保存历史记录失败: ${errorMsg}`);
    }
  }

  /**
   * 立即保存历史记录（第一个成功结果到达时调用）
   * 创建只包含首个成功结果的历史记录，后续结果通过 addResultToHistoryItem 追加
   */
  async function saveHistoryItemImmediate(
    filePath: string,
    firstResult: SingleServiceResult,
    historyId: string
  ): Promise<void> {
    const fileName = await getFileName(filePath);
    const metadata = await getImageMetadata(filePath);

    const newItem: HistoryItem = {
      id: historyId,
      localFileName: fileName,
      timestamp: Date.now(),
      filePath: filePath,
      results: [firstResult],
      primaryService: firstResult.serviceId,
      generatedLink: firstResult.result?.url || '',
      width: metadata.width,
      height: metadata.height,
      aspectRatio: metadata.aspect_ratio,
      fileSize: metadata.file_size,
      format: metadata.format
    };

    await historyDB.insertOrIgnore(newItem);
    log.info('[历史记录] 立即保存:', newItem.localFileName, '(主力图床:', firstResult.serviceId, ')');

    invalidateCache();
    emitHistoryUpdated([historyId]);
    clearImageMetadataCache(filePath);
  }

  /**
   * 向已有历史记录添加结果
   * 使用 SQLite 更新操作，无需读取全部数据
   * @returns 是否成功追加（false 表示失败，调用方可据此通知用户）
   */
  async function addResultToHistoryItem(
    historyId: string,
    result: SingleServiceResult
  ): Promise<boolean> {
    return withHistoryUpdateQueue(historyId, async () => {
      if (!historyId) return true; // 无需处理的情况视为成功

      const MAX_ATTEMPTS = 2;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          const item = await historyDB.getById(historyId);
          if (!item) {
            if (attempt < MAX_ATTEMPTS - 1) {
              await new Promise(resolve => setTimeout(resolve, 50));
              continue;
            }
            log.warn(`[历史记录] 记录 ${historyId} 不存在，无法追加 ${result.serviceId} 结果`);
            return false;
          }

          const existingIndex = item.results?.findIndex(
            (r: HistoryItem['results'][number]) => r.serviceId === result.serviceId
          );

          const updatedResults = [...(item.results || [])];
          if (typeof existingIndex === 'number' && existingIndex >= 0) {
            updatedResults[existingIndex] = result;
          } else {
            updatedResults.push(result);
          }
          await historyDB.update(historyId, { results: updatedResults });
          log.info(`[历史记录] 更新结果: ${result.serviceId}`);

          invalidateCache();
          await emitHistoryUpdated([historyId]);
          return true;
        } catch (error) {
          if (attempt < MAX_ATTEMPTS - 1) {
            await new Promise(resolve => setTimeout(resolve, 50));
          } else {
            log.error(`[历史记录] 追加 ${result.serviceId} 结果失败:`, error);
            return false;
          }
        }
      }
      return false;
    });
  }

  return {
    saveHistoryItem,
    saveHistoryItemImmediate,
    addResultToHistoryItem
  };
}
