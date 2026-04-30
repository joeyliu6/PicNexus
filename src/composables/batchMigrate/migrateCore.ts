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
import { getSourceCandidatesForStatus } from './sourceSelection';

const log = createLogger('migrateCore');

/**
 * 图片级并发上限。
 * 单张图内部多目标改为 Promise.allSettled 并行后，每图床的峰值并发数 = MAX_CONCURRENT（和目标数无关）。
 * 取 3 是「网络 I/O 为主 + compress_image CPU 峰值 + 多目标并行转换临时文件」的折中档位。
 */
export const MAX_CONCURRENT = 3;
const MAX_SOURCE_RETRY = 3;

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
 *
 * @param onTargetSettled 并行上传时每个目标落定（成功/失败）后调用，
 *   用于让外层触发 shallowRef 刷新，保证 chip 一个一个变色（而不是等整条落定一起跳）。
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
  onTargetSettled?: () => void,
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

  const sourceCandidates = getSourceCandidatesForStatus(
    item,
    status.sourceServiceId,
    status.problemServiceIds,
  ).slice(0, MAX_SOURCE_RETRY);
  if (sourceCandidates.length === 0) {
    if (status.problemServiceIds && status.problemServiceIds.length > 0) {
      status.status = 'skipped';
      status.error = '检测结果已更新，不再满足可恢复图片条件';
      status.errorType = undefined;
      status.failureDetails = undefined;
      return;
    }
    markStatusFailed(status, [{ message: '无有效下载源' }], 'download');
    return;
  }

  // 下载
  status.status = 'downloading';
  let tempFilePath: string | null = null;
  let lastDownloadError: unknown = null;
  const anyNeedsConversion = needUploadTargets.some(sid => needsFormatConversion(sid, 'webp'));
  const conversionTarget = anyNeedsConversion
    ? needUploadTargets.find(sid => needsFormatConversion(sid, 'webp')) ?? needUploadTargets[0]
    : undefined;

  for (const source of sourceCandidates) {
    try {
      const optimizedUrl = anyNeedsConversion && conversionTarget
        ? optimizeSourceUrl(source.url, conversionTarget)
        : source.url;
      status.sourceUrl = optimizedUrl;
      status.sourceServiceId = source.serviceId;
      const downloadResult = await invoke<{ file_path: string; content_type: string; file_size: number }>(
        'download_url_image', { url: optimizedUrl },
      );
      tempFilePath = downloadResult.file_path;
      stats.value = { ...stats.value, totalBytes: stats.value.totalBytes + downloadResult.file_size };
      lastDownloadError = null;
      break;
    } catch (e: unknown) {
      lastDownloadError = e;
      if (sourceCandidates.length > 1) {
        log.warn(`下载源失败，尝试下一个有效源: ${source.serviceId}`, e);
      }
    }
  }

  if (!tempFilePath) {
    markStatusFailed(status, [{
      message: cleanMigrateError(undefined, extractErrorMessage(lastDownloadError ?? '无有效下载源')),
    }], 'download');
    return;
  }
  const downloadedFilePath = tempFilePath;

  if (isCancelled.value) {
    remove(downloadedFilePath).catch((e) => log.warn(`临时文件清理失败: ${downloadedFilePath}`, e));
    status.status = 'skipped';
    return;
  }

  // 暂停（下载完成后）：清理临时文件 + 回退到 pending（保守策略，resume 时重新下载）
  if (isPaused.value) {
    remove(downloadedFilePath).catch((e) => log.warn(`临时文件清理失败: ${downloadedFilePath}`, e));
    status.status = 'pending';
    return;
  }

  // 上传：所有目标并行（Promise.allSettled），每个目标独立完成独立写 serviceResults，
  // Vue 响应式会逐个刷新对应 chip，一成功一显示。
  // 任一目标失败不影响其它；取消不打断已发起的上传，只是下一张图不再被取出处理。
  const ext = downloadedFilePath.split('.').pop()?.toLowerCase() || '';
  const anyNeedsConvert = needUploadTargets.some(t => needsFormatConversion(t, ext));
  status.status = anyNeedsConvert ? 'converting' : 'uploading';
  const tempFiles = new Set<string>();

  const newResults: SingleServiceResult[] = await Promise.all(needUploadTargets.map(async (targetId): Promise<SingleServiceResult> => {
    const willConvert = needsFormatConversion(targetId, ext);
    try {
      const uploadPath = await convertIfNeeded(downloadedFilePath, targetId);
      if (willConvert) {
        status.convertedFormat = 'jpeg';
        // 任一目标完成转换后把整体状态推进到 uploading
        if (status.status === 'converting') status.status = 'uploading';
      }
      if (uploadPath !== downloadedFilePath) tempFiles.add(uploadPath);
      const uploadResult = await multiUploader.retryUpload(uploadPath, targetId, config);
      status.serviceResults[targetId] = 'success';
      onTargetSettled?.();
      return { serviceId: targetId, result: uploadResult, status: 'success' };
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      status.serviceResults[targetId] = 'failed';
      onTargetSettled?.();
      log.warn(`迁移到 ${targetId} 失败: ${errorMsg}`);
      return { serviceId: targetId, status: 'failed', error: errorMsg };
    }
  }));
  const hasSuccess = newResults.some(r => r.status === 'success');
  const failedDetails = newResults
    .filter(r => r.status === 'failed')
    .map<MigrateFailureDetail>(r => ({
      serviceId: r.serviceId,
      message: cleanMigrateError(r.serviceId, r.error ?? ''),
    }));

  // 清理临时文件
  for (const f of [downloadedFilePath, ...tempFiles]) {
    remove(f).catch((e) => log.warn(`临时文件清理失败: ${f}`, e));
  }

  if (hasSuccess) {
    if (failedDetails.length > 0) {
      status.errorType = 'upload';
      status.failureDetails = failedDetails;
      status.error = formatMigrateFailureSummary(failedDetails);
    }
    try {
      const updatedResults = [
        ...item.results,
        ...newResults.map(r => ({ serviceId: r.serviceId, result: r.result, status: r.status, error: r.error })),
      ];

      // 同步 linkCheckSummary：新追加的成功图床尚未检测，计入 total 和 unchecked
      const appendedSuccess = newResults.filter(r => r.status === 'success').length;
      const updates: Partial<HistoryItem> = { results: updatedResults };
      if (appendedSuccess > 0 && item.linkCheckSummary) {
        updates.linkCheckSummary = {
          ...item.linkCheckSummary,
          totalLinks: item.linkCheckSummary.totalLinks + appendedSuccess,
          uncheckedLinks: item.linkCheckSummary.uncheckedLinks + appendedSuccess,
        };
      }

      await historyDB.update(item.id, updates);
      status.status = 'success';
    } catch (e) {
      log.error(`更新历史记录失败: ${item.id}`, e);
      markStatusFailed(status, [{ message: '历史记录更新失败' }], 'upload');
    }
  } else {
    markStatusFailed(status, failedDetails, 'upload');
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
  onTargetSettled?: () => void,
) {
  const semaphore = new Semaphore(MAX_CONCURRENT);
  const tasks = batchStatuses.map((status, i) => {
    const item = items[i];
    return semaphore.withPermit(async () => {
      if (isCancelled.value) {
        status.status = 'skipped';
        onItemDone(status);
        return;
      }
      // 暂停期间拿到 permit 的新条目：保持 pending，不计入统计，主循环 resume 后重新查询
      if (isPaused.value) {
        return;
      }
      try {
        await migrateOneItem(item, status, targets, config, multiUploader, isCancelled, isPaused, stats, onTargetSettled);
      } catch (e: unknown) {
        markStatusFailed(status, [{ message: cleanMigrateError(undefined, extractErrorMessage(e)) }]);
      } finally {
        onItemDone(status);
      }
    });
  });
  await Promise.all(tasks);
}
