/**
 * 批量迁移核心处理逻辑
 *
 * 单条迁移管线（下载 → 可选转换 → 多目标上传 → 更新历史）
 * 从 useBatchMigrate.ts 抽出，保持纯函数（不依赖 composable 的 ref），
 * 方便批量循环和单条重试复用。
 */

import type { Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { remove } from '@tauri-apps/plugin-fs';
import type { MultiServiceUploader, SingleServiceResult } from '../../core/MultiServiceUploader';
import { historyDB } from '../../services/HistoryDatabase';
import { needsFormatConversion } from '../../constants/serviceFormats';
import { Semaphore } from '../../utils/semaphore';
import { createLogger } from '../../utils/logger';
import { cleanMigrateError, formatMigrateFailureSummary } from '../../utils/uploadFailureMessage';
import type { HistoryItem, UserConfig } from '../../config/types';
import type { MigrateItemStatus, MigrateStats, MigrateFailureDetail } from '../../types/batchMigrate';

const log = createLogger('migrateCore');

export const MAX_CONCURRENT = 4;

/** 从未知错误中提取可读消息（处理 Tauri invoke 的 { data: { message } } 结构） */
export function extractErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && e !== null) {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    const data = obj.data;
    if (typeof data === 'object' && data !== null && typeof (data as Record<string, unknown>).message === 'string') {
      return (data as Record<string, unknown>).message as string;
    }
    return JSON.stringify(e);
  }
  return String(e);
}

export function markStatusFailed(status: MigrateItemStatus, details: MigrateFailureDetail[], errorType?: 'download' | 'upload'): void {
  status.status = 'failed';
  status.errorType = errorType;
  status.failureDetails = details;
  status.error = formatMigrateFailureSummary(details);
}

/** 知乎图片 URL 支持直接改后缀获取 JPG，避免下载 webp 后再转换 */
function optimizeSourceUrl(url: string, targetServiceId: string): string {
  if (/^https?:\/\/pic[x\d]\.zhimg\.com\//.test(url) && url.endsWith('.webp')) {
    if (needsFormatConversion(targetServiceId, 'webp')) {
      const optimized = url.replace(/\.webp$/, '.jpg');
      log.info(`知乎 URL 优化: webp → jpg（目标: ${targetServiceId}）`);
      return optimized;
    }
  }
  return url;
}

/** 下载的文件格式不被目标图床支持时，用 compress_image 转为 JPEG */
async function convertIfNeeded(filePath: string, targetServiceId: string): Promise<string> {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  if (!needsFormatConversion(targetServiceId, ext)) return filePath;

  log.info(`格式不兼容，转换 ${ext} → jpeg（目标: ${targetServiceId}）`);
  const result = await invoke<{ outputPath: string }>('compress_image', {
    filePath, quality: 92, maxLongSide: 0, outputFormat: 'jpeg', stripExif: true,
  });
  return result.outputPath;
}

/**
 * 单条迁移：下载 → 可选转换 → 多目标上传 → 更新历史记录
 * 就地修改 status，不返回值
 */
export async function migrateOneItem(
  item: HistoryItem,
  status: MigrateItemStatus,
  targets: string[],
  config: UserConfig,
  multiUploader: MultiServiceUploader,
  isCancelled: Ref<boolean>,
  isPaused: Ref<boolean>,
  stats: Ref<MigrateStats>,
) {
  const existingServiceIds = new Set(
    item.results.filter(r => r.status === 'success').map(r => r.serviceId),
  );
  const needUploadTargets = targets.filter(sid => !existingServiceIds.has(sid));

  if (needUploadTargets.length === 0) {
    status.status = 'skipped';
    return;
  }

  if (isCancelled.value) {
    status.status = 'skipped';
    return;
  }

  // 暂停（入口）：未开始下载的条目立即返回，保持 pending，resume 后重新查询
  if (isPaused.value) {
    return;
  }

  const sourceResult = item.results.find(r => r.status === 'success' && r.result?.url);
  if (!sourceResult?.result?.url) {
    markStatusFailed(status, [{ message: '无有效下载源' }], 'download');
    return;
  }

  // 下载
  status.status = 'downloading';
  let tempFilePath: string;
  try {
    const anyNeedsConversion = needUploadTargets.some(sid => needsFormatConversion(sid, 'webp'));
    const optimizedUrl = anyNeedsConversion
      ? optimizeSourceUrl(sourceResult.result.url, needUploadTargets.find(sid => needsFormatConversion(sid, 'webp'))!)
      : sourceResult.result.url;
    status.sourceUrl = optimizedUrl;
    const downloadResult = await invoke<{ file_path: string; content_type: string; file_size: number }>(
      'download_url_image', { url: optimizedUrl },
    );
    tempFilePath = downloadResult.file_path;
    stats.value = { ...stats.value, totalBytes: stats.value.totalBytes + downloadResult.file_size };
  } catch (e: unknown) {
    markStatusFailed(status, [{ message: cleanMigrateError(undefined, extractErrorMessage(e)) }], 'download');
    return;
  }

  if (isCancelled.value) {
    remove(tempFilePath).catch((e) => log.warn(`临时文件清理失败: ${tempFilePath}`, e));
    status.status = 'skipped';
    return;
  }

  // 暂停（下载完成后）：清理临时文件 + 回退到 pending（保守策略，resume 时重新下载）
  if (isPaused.value) {
    remove(tempFilePath).catch((e) => log.warn(`临时文件清理失败: ${tempFilePath}`, e));
    status.status = 'pending';
    return;
  }

  // 上传：每个 target 按需转换（转换发生时先切到 'converting' 让 UI 显示真实阶段）
  const ext = tempFilePath.split('.').pop()?.toLowerCase() || '';
  const newResults: SingleServiceResult[] = [];
  let hasSuccess = false;
  const tempFiles = new Set<string>();

  for (const targetId of needUploadTargets) {
    if (isCancelled.value) break;
    const willConvert = needsFormatConversion(targetId, ext);
    if (willConvert) {
      status.status = 'converting';
    } else if (status.status !== 'uploading') {
      status.status = 'uploading';
    }
    try {
      const uploadPath = await convertIfNeeded(tempFilePath, targetId);
      if (willConvert) {
        status.convertedFormat = 'jpeg';
        status.status = 'uploading';
      }
      if (uploadPath !== tempFilePath) tempFiles.add(uploadPath);
      const uploadResult = await multiUploader.retryUpload(uploadPath, targetId, config);
      newResults.push({ serviceId: targetId, result: uploadResult, status: 'success' });
      status.serviceResults[targetId] = 'success';
      hasSuccess = true;
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      newResults.push({ serviceId: targetId, status: 'failed', error: errorMsg });
      status.serviceResults[targetId] = 'failed';
      log.warn(`迁移到 ${targetId} 失败: ${errorMsg}`);
    }
  }

  // 清理临时文件
  for (const f of [tempFilePath, ...tempFiles]) {
    remove(f).catch((e) => log.warn(`临时文件清理失败: ${f}`, e));
  }

  if (hasSuccess) {
    try {
      const updatedResults = [
        ...item.results,
        ...newResults.map(r => ({ serviceId: r.serviceId, result: r.result, status: r.status, error: r.error })),
      ];
      await historyDB.update(item.id, { results: updatedResults });
      status.status = 'success';
    } catch (e) {
      log.error(`更新历史记录失败: ${item.id}`, e);
      markStatusFailed(status, [{ message: '历史记录更新失败' }], 'upload');
    }
  } else {
    const details = newResults
      .filter(r => r.status === 'failed')
      .map<MigrateFailureDetail>(r => ({
        serviceId: r.serviceId,
        message: cleanMigrateError(r.serviceId, r.error ?? ''),
      }));
    markStatusFailed(status, details, 'upload');
  }
}

/**
 * 批量处理一页项目（MAX_CONCURRENT 并发）
 * 每条完成后调用 onItemDone 回调，让上层累计统计
 */
export async function processBatch(
  items: HistoryItem[],
  batchStatuses: MigrateItemStatus[],
  targets: string[],
  config: UserConfig,
  multiUploader: MultiServiceUploader,
  isCancelled: Ref<boolean>,
  isPaused: Ref<boolean>,
  stats: Ref<MigrateStats>,
  onItemDone: (status: MigrateItemStatus) => void,
) {
  const semaphore = new Semaphore(MAX_CONCURRENT);
  const tasks = batchStatuses.map((status, i) => {
    const item = items[i];
    return semaphore.withPermit(async () => {
      if (isCancelled.value) {
        status.status = 'skipped';
        return;
      }
      // 暂停期间拿到 permit 的新条目：保持 pending，不计入统计，主循环 resume 后重新查询
      if (isPaused.value) {
        return;
      }
      try {
        await migrateOneItem(item, status, targets, config, multiUploader, isCancelled, isPaused, stats);
      } catch (e: unknown) {
        markStatusFailed(status, [{ message: cleanMigrateError(undefined, extractErrorMessage(e)) }]);
      } finally {
        onItemDone(status);
      }
    });
  });
  await Promise.all(tasks);
}
