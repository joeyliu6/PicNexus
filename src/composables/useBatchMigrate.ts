/**
 * 批量迁移管理器
 * 两步流程：配置（选目标图床 + 可选高级筛选）→ 执行迁移
 *
 * 核心逻辑变化：
 * - 用户直接选择目标图床，系统自动计算"不在该图床上的图片数"
 * - 高级筛选（按备份数量门槛）默认折叠隐藏
 * - 新增实时统计卡：剩余时间 / 平均速度 / 并发数
 */

import { ref, computed, shallowRef } from 'vue';
import type { Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { remove } from '@tauri-apps/plugin-fs';
import { MultiServiceUploader } from '../core/MultiServiceUploader';
import type { SingleServiceResult } from '../core/MultiServiceUploader';
import { historyDB } from '../services/HistoryDatabase';
import { configStore } from '../store/instances';
import { getServiceDisplayName } from '../constants/serviceNames';
import { needsFormatConversion } from '../constants/serviceFormats';
import { Semaphore } from '../utils/semaphore';
import { createLogger } from '../utils/logger';
import type { HistoryItem, UserConfig } from '../config/types';
import { DEFAULT_CONFIG } from '../config/types';
import type {
  MigratePhase,
  MigrateTargetService,
  MigrateItemStatus,
  MigrateResult,
  MigrateStats,
} from '../types/batchMigrate';

export type { MigratePhase, MigrateTargetService, MigrateItemStatus, MigrateResult, MigrateStats };

const log = createLogger('useBatchMigrate');

const MAX_CONCURRENT = 2;
const PAGE_SIZE = 100;
const MAX_CONSECUTIVE_FAILURES = 10;

// ============================================
// 独立辅助函数
// ============================================

/** 从未知错误中提取可读消息（处理 Tauri invoke 的 { data: { message } } 结构） */
function extractErrorMessage(e: unknown): string {
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
    filePath,
    quality: 92,
    maxLongSide: 0,
    outputFormat: 'jpeg',
    stripExif: true,
  });
  return result.outputPath;
}

async function migrateOneItem(
  item: HistoryItem,
  status: MigrateItemStatus,
  targets: string[],
  config: UserConfig,
  multiUploader: MultiServiceUploader,
  isCancelled: Ref<boolean>,
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

  // L4：下载前检查取消
  if (isCancelled.value) {
    status.status = 'skipped';
    return;
  }

  const sourceResult = item.results.find(r => r.status === 'success' && r.result?.url);
  if (!sourceResult?.result?.url) {
    status.status = 'failed';
    status.error = '无有效下载源';
    status.errorType = 'download';
    return;
  }

  // 下载
  status.status = 'downloading';
  let tempFilePath: string;
  try {
    // 第一层优化：如果任一目标图床不支持 webp，知乎 URL 直接改后缀获取 JPG
    const anyNeedsConversion = needUploadTargets.some(sid => needsFormatConversion(sid, 'webp'));
    const optimizedUrl = anyNeedsConversion
      ? optimizeSourceUrl(sourceResult.result.url, needUploadTargets.find(sid => needsFormatConversion(sid, 'webp'))!)
      : sourceResult.result.url;
    const downloadResult = await invoke<{ file_path: string; content_type: string; file_size: number }>(
      'download_url_image', { url: optimizedUrl },
    );
    tempFilePath = downloadResult.file_path;
    // 累加文件大小到统计
    stats.value = { ...stats.value, totalBytes: stats.value.totalBytes + downloadResult.file_size };
  } catch (e: unknown) {
    status.status = 'failed';
    status.error = extractErrorMessage(e);
    status.errorType = 'download';
    return;
  }

  // L4：上传前检查取消
  if (isCancelled.value) {
    // 清理已下载的临时文件
    remove(tempFilePath).catch((e) => log.warn(`临时文件清理失败: ${tempFilePath}`, e));
    status.status = 'skipped';
    return;
  }

  // 上传
  status.status = 'uploading';
  const newResults: SingleServiceResult[] = [];
  let hasSuccess = false;
  const tempFiles = new Set<string>(); // 跟踪需要清理的临时文件

  for (const targetId of needUploadTargets) {
    if (isCancelled.value) break;
    try {
      // 第二层兜底：文件格式不被目标图床支持时，自动转为 JPEG
      const uploadPath = await convertIfNeeded(tempFilePath, targetId);
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

  // 清理临时文件（下载的原文件 + 格式转换的文件）
  for (const f of [tempFilePath, ...tempFiles]) {
    remove(f).catch((e) => log.warn(`临时文件清理失败: ${f}`, e));
  }

  if (hasSuccess) {
    try {
      const updatedResults = [
        ...item.results,
        ...newResults.map(r => ({
          serviceId: r.serviceId,
          result: r.result,
          status: r.status,
          error: r.error,
        })),
      ];
      await historyDB.update(item.id, { results: updatedResults });
      status.status = 'success';
    } catch (e) {
      log.error(`更新历史记录失败: ${item.id}`, e);
      status.status = 'failed';
      status.error = '历史记录更新失败';
      status.errorType = 'upload';
    }
  } else {
    status.status = 'failed';
    status.errorType = 'upload';
    const failedServices = newResults
      .filter(r => r.status === 'failed')
      .map(r => `${r.serviceId}: ${r.error}`);
    status.error = failedServices.join('; ');
  }
}

async function processBatch(
  items: HistoryItem[],
  batchStatuses: MigrateItemStatus[],
  targets: string[],
  config: UserConfig,
  multiUploader: MultiServiceUploader,
  isCancelled: Ref<boolean>,
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
      try {
        await migrateOneItem(item, status, targets, config, multiUploader, isCancelled, stats);
      } catch (e: unknown) {
        status.status = 'failed';
        status.error = extractErrorMessage(e);
      } finally {
        onItemDone(status);
      }
    });
  });
  await Promise.all(tasks);
}

// ============================================
// 管理器 Composable
// ============================================

export function useBatchMigrateManager() {
  const phase = ref<MigratePhase>('configuring');
  const isInitialized = ref(false);
  const isFilterApplied = ref(false);

  // 高级筛选
  const maxSuccessCount = ref(999); // 默认"全部"
  const sourceServiceFilter = ref<string[]>([]); // 来源图床筛选，空数组 = 全部
  const availableSourceServices = ref<Array<{ id: string; displayName: string; count: number }>>([]);

  // 图床配置
  const targetServices = ref<MigrateTargetService[]>([]);

  // 执行
  const itemStatuses = shallowRef<MigrateItemStatus[]>([]);
  const allItemStatuses = shallowRef<MigrateItemStatus[]>([]);
  const isMigrating = ref(false);
  const isCancelled = ref(false);
  const migrateResult = ref<MigrateResult | null>(null);
  const globalProgress = ref({ current: 0, total: 0, percent: 0 });

  // 累计统计（迁移进行中实时更新，UI 可绑定）
  const cumulativeCounts = ref({ success: 0, failed: 0, skipped: 0 });

  // 实时统计（三个统计卡用）
  const migrateStats = ref<MigrateStats>({
    startTime: 0, elapsedMs: 0, processedCount: 0, totalCount: 0, totalBytes: 0,
  });

  // 错误状态（C6：初始化/筛选失败时暴露给 UI）
  const initError = ref<string | null>(null);

  // 计算属性
  const configuredServices = computed(() => targetServices.value.filter(s => s.isConfigured));
  const unconfiguredServices = computed(() => targetServices.value.filter(s => !s.isConfigured));
  const checkedTargets = computed(() => targetServices.value.filter(s => s.checked && s.isConfigured));
  const totalPending = computed(() => {
    // 取所有已勾选图床中最大的 pendingCount（因为迁移是并行到多个目标）
    if (checkedTargets.value.length === 0) return 0;
    return Math.max(...checkedTargets.value.map(s => s.pendingCount));
  });
  const isAllBackedUp = computed(() =>
    isInitialized.value && isFilterApplied.value &&
    targetServices.value.every(s => !s.isConfigured || s.pendingCount === 0),
  );

  // 统计卡计算
  const estimatedTimeRemaining = computed(() => {
    const s = migrateStats.value;
    if (s.processedCount === 0) return null;
    const avgMs = s.elapsedMs / s.processedCount;
    return (s.totalCount - s.processedCount) * avgMs;
  });

  const averageSpeed = computed(() => {
    const s = migrateStats.value;
    if (s.elapsedMs === 0) return 0;
    return s.totalBytes / (s.elapsedMs / 1000);
  });

  const concurrentCount = computed(() =>
    itemStatuses.value.filter(s => s.status === 'downloading' || s.status === 'uploading').length,
  );

  // ============================================
  // RAF 节流
  // ============================================

  let rafPending = false;
  let pendingStatuses: MigrateItemStatus[] | null = null;
  let pendingProcessed = 0;
  let pendingTotal = 0;

  function updateStatusDisplay(statuses: MigrateItemStatus[], processed: number, total: number): void {
    itemStatuses.value = [...statuses];
    globalProgress.value = {
      current: processed,
      total: total,
      percent: total > 0 ? Math.round((processed / total) * 100) : 0,
    };
  }

  function scheduleStatusUpdate(statuses: MigrateItemStatus[], processed: number, total: number) {
    pendingStatuses = statuses;
    pendingProcessed = processed;
    pendingTotal = total;

    // C3：页面不可见时 RAF 可能被跳过，直接同步更新
    if (document.hidden) {
      updateStatusDisplay(statuses, processed, total);
      rafPending = false;
      return;
    }

    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      if (pendingStatuses) {
        updateStatusDisplay(pendingStatuses, pendingProcessed, pendingTotal);
      }
      rafPending = false;
    });
  }

  function flushStatusUpdate() {
    if (pendingStatuses) {
      updateStatusDisplay(pendingStatuses, pendingProcessed, pendingTotal);
    }
    rafPending = false;
    pendingStatuses = null;
  }

  // ============================================
  // 初始化 + 筛选
  // ============================================

  let cachedConfig: UserConfig | null = null;
  let cachedUploader: MultiServiceUploader | null = null;

  async function getOrCacheConfig(): Promise<UserConfig> {
    if (cachedConfig) return cachedConfig;
    cachedConfig = await configStore.get<UserConfig>('config', DEFAULT_CONFIG) ?? DEFAULT_CONFIG;
    return cachedConfig;
  }

  async function initConfiguring() {
    isFilterApplied.value = false;
    initError.value = null;

    // L3：始终清空缓存，确保读取最新配置
    cachedConfig = null;

    try {
      const config = await getOrCacheConfig();
      cachedUploader = new MultiServiceUploader();

      // F2：保留旧的勾选状态
      const prevChecked = new Set(
        targetServices.value.filter(s => s.checked).map(s => s.serviceId),
      );

      const allServices = config.availableServices || [];
      const configured = cachedUploader.filterConfiguredServices(allServices, config);

      targetServices.value = allServices.map(sid => ({
        serviceId: sid,
        displayName: getServiceDisplayName(sid),
        isConfigured: configured.includes(sid),
        pendingCount: 0,
        checked: prevChecked.has(sid) && configured.includes(sid),
      }));

      // 如果无已勾选且只有 1 个已配置图床，自动预勾选
      const configuredList = targetServices.value.filter(s => s.isConfigured);
      const hasChecked = targetServices.value.some(s => s.checked);
      if (!hasChecked && configuredList.length === 1) {
        configuredList[0].checked = true;
      }

      isInitialized.value = true;
    } catch (e) {
      log.error('初始化失败', e);
      initError.value = '初始化失败，请重试';
      return;
    }

    await applyFilter();

    // 默认全选来源图床，减少用户操作步骤
    if (sourceServiceFilter.value.length === 0) {
      sourceServiceFilter.value = availableSourceServices.value.map(s => s.id);
    }

    isFilterApplied.value = true;
  }

  /**
   * 应用筛选：查询每个已配置图床的待迁移数
   * 利用 getServiceDistribution 获取"已在该图床上的图片数"，然后 total - existing = pending
   */
  async function applyFilter() {
    try {
      const hasServiceId = sourceServiceFilter.value.length > 0 ? sourceServiceFilter.value : undefined;
      const params = {
        maxSuccessCount: maxSuccessCount.value,
        hasServiceId,
      };

      // 获取总数 + 各图床分布（同时获取不带来源筛选的分布，用于构建来源下拉列表）
      const [{ total }, existingMap, allDistribution] = await Promise.all([
        historyDB.getItemsByBackupCount({ ...params, limit: 1, offset: 0 }),
        historyDB.getServiceDistribution(params),
        // 不带 hasServiceId 的分布——用于构建来源图床列表
        historyDB.getServiceDistribution({ maxSuccessCount: maxSuccessCount.value }),
      ]);

      // 更新目标图床的待迁移数
      for (const svc of targetServices.value) {
        if (svc.isConfigured) {
          const existing = existingMap.get(svc.serviceId) || 0;
          svc.pendingCount = total - existing;
        }
      }

      // 构建来源图床列表（所有在 DB 中有记录的图床）
      availableSourceServices.value = Array.from(allDistribution.entries())
        .map(([id, count]) => ({ id, displayName: getServiceDisplayName(id), count }))
        .sort((a, b) => b.count - a.count);
    } catch (e) {
      log.error('筛选失败', e);
      initError.value = '数据查询失败，请重试';
    }
  }

  // ============================================
  // 执行迁移
  // ============================================

  async function startMigrate() {
    const targets = checkedTargets.value.map(s => s.serviceId);
    if (targets.length === 0) return;

    phase.value = 'migrating';
    isMigrating.value = true;
    isCancelled.value = false;
    migrateResult.value = null;

    const config = await getOrCacheConfig();
    const multiUploader = cachedUploader ?? new MultiServiceUploader();

    const totalToProcess = totalPending.value;
    const startTime = Date.now();
    migrateStats.value = { startTime, elapsedMs: 0, processedCount: 0, totalCount: totalToProcess, totalBytes: 0 };

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const failures: MigrateResult['failures'] = [];
    const partialFailures: MigrateResult['partialFailures'] = [];
    let processed = 0;
    cumulativeCounts.value = { success: 0, failed: 0, skipped: 0 };
    let consecutiveFailures = 0;
    let autoPaused = false;

    globalProgress.value = { current: 0, total: totalToProcess, percent: 0 };

    // 跟踪已处理（跳过/失败）但未从查询中消失的 ID，避免重复处理
    const processedIds = new Set<string>();
    let skipOffset = 0;

    while (!isCancelled.value) {
      const { items, total: queryTotal } = await historyDB.getItemsByBackupCount({
        maxSuccessCount: maxSuccessCount.value,
        hasServiceId: sourceServiceFilter.value.length > 0 ? sourceServiceFilter.value : undefined,
        limit: PAGE_SIZE,
        offset: skipOffset,
      });

      if (items.length === 0) break;

      // 过滤掉已处理过的项目
      const newItems = items.filter(item => !processedIds.has(item.id));
      if (newItems.length === 0) {
        // 当前页全是已处理项，继续翻页
        skipOffset += PAGE_SIZE;
        continue;
      }

      const batchStatuses: MigrateItemStatus[] = newItems.map(item => ({
        historyId: item.id,
        fileName: item.localFileName,
        status: 'pending' as const,
        serviceResults: Object.fromEntries(targets.map(sid => [sid, 'pending' as const])),
      }));
      itemStatuses.value = batchStatuses;
      allItemStatuses.value = [...batchStatuses, ...allItemStatuses.value];

      await processBatch(newItems, batchStatuses, targets, config, multiUploader, isCancelled, migrateStats, (status) => {
        if (status.status === 'success') {
          successCount++;
          consecutiveFailures = 0;
          // 收集部分目标失败的详情
          const failedTargets = Object.entries(status.serviceResults)
            .filter(([, state]) => state === 'failed')
            .map(([sid]) => sid);
          if (failedTargets.length > 0) {
            partialFailures.push({ fileName: status.fileName, failedTargets });
          }
        } else if (status.status === 'skipped') {
          skippedCount++;
          consecutiveFailures = 0;
        } else {
          failedCount++;
          consecutiveFailures++;
          if (status.error) failures.push({ fileName: status.fileName, error: status.error, errorType: status.errorType });
          // 连续失败过多 → 自动暂停
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && !autoPaused) {
            autoPaused = true;
            isCancelled.value = true;
            log.warn(`连续 ${consecutiveFailures} 次失败，自动暂停迁移`);
          }
        }
        processed++;
        cumulativeCounts.value = { success: successCount, failed: failedCount, skipped: skippedCount };
        migrateStats.value = {
          ...migrateStats.value,
          processedCount: processed,
          elapsedMs: Date.now() - startTime,
        };
        scheduleStatusUpdate(batchStatuses, processed, totalToProcess);
      });

      flushStatusUpdate();

      // 记录所有已处理项的 ID（含成功项，因为 maxSuccessCount=999 时成功项不会从查询中消失）
      for (const status of batchStatuses) {
        processedIds.add(status.historyId);
      }

      // 本批次有成功项 → 重置 offset（成功项的 success_count 变化可能影响排序）
      // 本批次无成功项 → 翻页继续查找未备份的项目
      const batchSuccessCount = batchStatuses.filter(s => s.status === 'success').length;
      if (batchSuccessCount > 0) {
        skipOffset = 0;
      } else {
        skipOffset += PAGE_SIZE;
      }

      // L5：防止无限翻页 — 当 offset 超出查询总量时终止
      if (skipOffset > 0 && skipOffset >= queryTotal) break;
    }

    const pauseReason = autoPaused
      ? 'consecutive-failures' as const
      : isCancelled.value
        ? 'user-cancelled' as const
        : undefined;
    migrateResult.value = { successCount, failedCount, skippedCount, failures, partialFailures, pauseReason };
    isMigrating.value = false;
    phase.value = 'done';
  }

  function cancelMigrate() {
    isCancelled.value = true;
  }

  async function resetToConfiguring() {
    phase.value = 'configuring';
    itemStatuses.value = [];
    allItemStatuses.value = [];
    isMigrating.value = false;
    isCancelled.value = false;
    migrateResult.value = null;
    globalProgress.value = { current: 0, total: 0, percent: 0 };
    migrateStats.value = { startTime: 0, elapsedMs: 0, processedCount: 0, totalCount: 0, totalBytes: 0 };
    cumulativeCounts.value = { success: 0, failed: 0, skipped: 0 };
    sourceServiceFilter.value = [];
    isFilterApplied.value = false;
    cachedConfig = null;
    await initConfiguring();
  }

  async function retryFailed() {
    // L1：重试前重新计算 pendingCount，确保 totalPending 准确
    await applyFilter();
    await startMigrate();
  }

  return {
    phase, isInitialized, isFilterApplied, initError,
    maxSuccessCount, sourceServiceFilter, availableSourceServices,
    targetServices, configuredServices, unconfiguredServices,
    checkedTargets, totalPending, isAllBackedUp,
    itemStatuses, allItemStatuses, isMigrating, globalProgress, migrateResult, cumulativeCounts,
    migrateStats, estimatedTimeRemaining, averageSpeed, concurrentCount,
    initConfiguring, applyFilter,
    startMigrate, cancelMigrate, retryFailed, resetToConfiguring,
  };
}
