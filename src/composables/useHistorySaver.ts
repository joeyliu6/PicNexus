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
 *
 * 导出 withHistoryUpdateQueue 给 RetryService 共用：让 retry 路径的
 * updateHistoryRecord 与初始上传的 addResultToHistoryItem 走同一把按 ID 锁，
 * 防止两个 read-modify-write 互相覆盖（详见 [[project_rebuild_layer_done]]）。
 */
const historyUpdateQueue = new Map<string, Promise<void>>();

export async function withHistoryUpdateQueue<T>(
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
   *
   * 行为：
   * - 传入 customId 且对应记录已存在 → 走 update，只更新 results / primaryService /
   *   generatedLink，保留 isFavorited / linkCheckStatus / linkCheckSummary 等 retry
   *   不应覆盖的字段。
   * - 否则按 customId（或新生成的 UUID）走 insertOrIgnore 建新记录。
   *
   * Why：全量重试场景下，队列项的 historyId 必须被复用，否则会插出一条与原记录指向
   * 同一文件的孤儿记录，用户会在历史里看到重复条目（[[project_rebuild_layer_done]]）。
   */
  async function saveHistoryItem(
    filePath: string,
    uploadResult: MultiUploadResult,
    customId?: string,
    liveResults?: SingleServiceResult[]
  ): Promise<string | undefined> {
    const targetId = customId || crypto.randomUUID();

    // 共享 per-id 串行锁：避免与 addResultToHistoryItem 并发对同一 historyId 读改写互相覆盖
    return withHistoryUpdateQueue(targetId, async () => {
      try {
        const fileName = await getFileName(filePath);

        // 使用 liveResults 或回退到 uploadResult.results
        const resultsSource = liveResults || uploadResult.results;

        // customId 存在时先探测：DB 已有记录则走 update（仅刷新 retry 关心的字段）
        const existing = customId ? await historyDB.getById(customId) : null;
        if (existing) {
          await historyDB.update(customId!, {
            results: resultsSource,
            primaryService: uploadResult.primaryService,
            generatedLink: uploadResult.primaryUrl || '',
          });
          log.info('[历史记录] 已更新:', existing.localFileName, '(retry 复用 historyId)');
        } else {
          const metadata = await getImageMetadata(filePath);

          const newItem: HistoryItem = {
            id: targetId,
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
        }

        invalidateCache();
        await emitHistoryUpdated([targetId]);
        clearImageMetadataCache(filePath);

        return targetId;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log.error('[历史记录] 保存失败:', error);
        throw new Error(`保存历史记录失败: ${errorMsg}`);
      }
    });
  }

  /**
   * 立即保存历史记录（第一个成功结果到达时调用）
   * 创建只包含首个成功结果的历史记录，后续结果通过 addResultToHistoryItem 追加
   *
   * Why: 必须与 addResultToHistoryItem 共享同一把 historyId 串行锁，否则会出现
   *      insertOrIgnore 还没 commit 时 addResult 的 getById 返回 null，导致后续
   *      图床结果静默丢失（50ms 重试是 workaround，根本上要靠串行化）。
   */
  async function saveHistoryItemImmediate(
    filePath: string,
    firstResult: SingleServiceResult,
    historyId: string
  ): Promise<void> {
    return withHistoryUpdateQueue(historyId, async () => {
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
      // Why: addResultToHistoryItem 同名调用是 await 的，这里若不 await 会让"首次创建"事件
      //      晚于"后续追加"事件抵达 UI 监听器，触发瞬间空白/记录闪现。
      await emitHistoryUpdated([historyId]);
      clearImageMetadataCache(filePath);
    });
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
