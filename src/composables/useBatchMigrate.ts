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
import { MultiServiceUploader } from '../core/MultiServiceUploader';
import type { SingleServiceResult } from '../core/MultiServiceUploader';
import { historyDB } from '../services/HistoryDatabase';
import { configStore } from '../store/instances';
import { getServiceDisplayName } from '../constants/serviceNames';
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

// ============================================
// 独立辅助函数
// ============================================

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
    const downloadResult = await invoke<{ file_path: string; content_type: string; file_size: number }>(
      'download_url_image', { url: sourceResult.result.url },
    );
    tempFilePath = downloadResult.file_path;
    // 累加文件大小到统计
    stats.value = { ...stats.value, totalBytes: stats.value.totalBytes + downloadResult.file_size };
  } catch (e: unknown) {
    status.status = 'failed';
    status.error = `下载失败: ${e instanceof Error ? e.message : String(e)}`;
    status.errorType = 'download';
    return;
  }

  // 上传
  status.status = 'uploading';
  const newResults: SingleServiceResult[] = [];
  let hasSuccess = false;

  for (const targetId of needUploadTargets) {
    if (isCancelled.value) break;
    try {
      const uploadResult = await multiUploader.retryUpload(tempFilePath, targetId, config);
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
  let running = 0;
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < batchStatuses.length && !isCancelled.value) {
      if (running >= MAX_CONCURRENT) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }
      const i = idx++;
      const item = items[i];
      const status = batchStatuses[i];
      running++;
      try {
        await migrateOneItem(item, status, targets, config, multiUploader, isCancelled, stats);
      } catch (e: unknown) {
        status.status = 'failed';
        status.error = e instanceof Error ? e.message : String(e);
      } finally {
        running--;
        onItemDone(status);
      }
    }
  }

  const workers = Array.from({ length: MAX_CONCURRENT }, () => worker());
  await Promise.all(workers);
}

// ============================================
// 管理器 Composable
// ============================================

export function useBatchMigrateManager() {
  const phase = ref<MigratePhase>('configuring');
  const isInitialized = ref(false);

  // 高级筛选
  const maxSuccessCount = ref(999); // 默认"全部"
  const showAdvancedFilter = ref(false);

  // 图床配置
  const targetServices = ref<MigrateTargetService[]>([]);

  // 执行
  const itemStatuses = shallowRef<MigrateItemStatus[]>([]);
  const isMigrating = ref(false);
  const isCancelled = ref(false);
  const migrateResult = ref<MigrateResult | null>(null);
  const globalProgress = ref({ current: 0, total: 0, percent: 0 });

  // 实时统计（三个统计卡用）
  const migrateStats = ref<MigrateStats>({
    startTime: 0, elapsedMs: 0, processedCount: 0, totalCount: 0, totalBytes: 0,
  });

  // 计算属性
  const configuredServices = computed(() => targetServices.value.filter(s => s.isConfigured));
  const unconfiguredServices = computed(() => targetServices.value.filter(s => !s.isConfigured));
  const checkedTargets = computed(() => targetServices.value.filter(s => s.checked && s.isConfigured));
  const totalPending = computed(() => {
    // 取所有已勾选图床中最大的 pendingCount（因为迁移是并行到多个目标）
    if (checkedTargets.value.length === 0) return 0;
    return Math.max(...checkedTargets.value.map(s => s.pendingCount));
  });
  const allBackedUp = computed(() =>
    isInitialized.value && targetServices.value.every(s => !s.isConfigured || s.pendingCount === 0),
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

  function scheduleStatusUpdate(statuses: MigrateItemStatus[], processed: number, total: number) {
    pendingStatuses = statuses;
    pendingProcessed = processed;
    pendingTotal = total;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      if (pendingStatuses) {
        itemStatuses.value = [...pendingStatuses];
        globalProgress.value = {
          current: pendingProcessed,
          total: pendingTotal,
          percent: pendingTotal > 0 ? Math.round((pendingProcessed / pendingTotal) * 100) : 0,
        };
      }
      rafPending = false;
    });
  }

  function flushStatusUpdate() {
    if (pendingStatuses) {
      itemStatuses.value = [...pendingStatuses];
      globalProgress.value = {
        current: pendingProcessed,
        total: pendingTotal,
        percent: pendingTotal > 0 ? Math.round((pendingProcessed / pendingTotal) * 100) : 0,
      };
    }
    rafPending = false;
    pendingStatuses = null;
  }

  // ============================================
  // 初始化 + 筛选
  // ============================================

  let cachedConfig: UserConfig | null = null;
  let cachedUploader: MultiServiceUploader | null = null;

  async function initConfiguring() {
    try {
      const config = await configStore.get<UserConfig>('config', DEFAULT_CONFIG) ?? DEFAULT_CONFIG;
      cachedConfig = config;
      cachedUploader = new MultiServiceUploader();

      const allServices = config.availableServices || [];
      const configured = cachedUploader.filterConfiguredServices(allServices, config);

      targetServices.value = allServices.map(sid => ({
        serviceId: sid,
        displayName: getServiceDisplayName(sid),
        isConfigured: configured.includes(sid),
        pendingCount: 0,
        checked: false,
      }));

      // 如果只有 1 个已配置图床，自动预勾选
      const configuredList = targetServices.value.filter(s => s.isConfigured);
      if (configuredList.length === 1) {
        configuredList[0].checked = true;
      }

      isInitialized.value = true;
    } catch (e) {
      log.error('初始化失败', e);
    }

    await applyFilter();
  }

  /**
   * 应用筛选：查询每个已配置图床的待迁移数
   * 利用 getServiceDistribution 获取"已在该图床上的图片数"，然后 total - existing = pending
   */
  async function applyFilter() {
    try {
      const params = {
        maxSuccessCount: maxSuccessCount.value,
      };

      // 获取总数 + 各图床分布
      const [{ total }, existingMap] = await Promise.all([
        historyDB.getItemsByBackupCount({ ...params, limit: 1, offset: 0 }),
        historyDB.getServiceDistribution(params),
      ]);

      for (const svc of targetServices.value) {
        if (svc.isConfigured) {
          const existing = existingMap.get(svc.serviceId) || 0;
          svc.pendingCount = total - existing;
        }
      }
    } catch (e) {
      log.error('筛选失败', e);
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

    const config = cachedConfig ?? await configStore.get<UserConfig>('config', DEFAULT_CONFIG) ?? DEFAULT_CONFIG;
    const multiUploader = cachedUploader ?? new MultiServiceUploader();

    const totalToProcess = totalPending.value;
    const startTime = Date.now();
    migrateStats.value = { startTime, elapsedMs: 0, processedCount: 0, totalCount: totalToProcess, totalBytes: 0 };

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const failures: MigrateResult['failures'] = [];
    let processed = 0;

    globalProgress.value = { current: 0, total: totalToProcess, percent: 0 };

    while (!isCancelled.value) {
      const { items } = await historyDB.getItemsByBackupCount({
        maxSuccessCount: maxSuccessCount.value,
        limit: PAGE_SIZE,
        offset: 0,
      });

      if (items.length === 0) break;

      const batchStatuses: MigrateItemStatus[] = items.map(item => ({
        historyId: item.id,
        fileName: item.localFileName,
        status: 'pending' as const,
        serviceResults: Object.fromEntries(targets.map(sid => [sid, 'pending' as const])),
      }));
      itemStatuses.value = batchStatuses;

      await processBatch(items, batchStatuses, targets, config, multiUploader, isCancelled, migrateStats, (status) => {
        if (status.status === 'success') successCount++;
        else if (status.status === 'skipped') skippedCount++;
        else {
          failedCount++;
          if (status.error) failures.push({ fileName: status.fileName, error: status.error, errorType: status.errorType });
        }
        processed++;
        migrateStats.value = {
          ...migrateStats.value,
          processedCount: processed,
          elapsedMs: Date.now() - startTime,
        };
        scheduleStatusUpdate(batchStatuses, processed, totalToProcess);
      });

      flushStatusUpdate();

      const batchSuccessCount = batchStatuses.filter(s => s.status === 'success').length;
      if (batchSuccessCount === 0) break;
    }

    migrateResult.value = { successCount, failedCount, skippedCount, failures };
    isMigrating.value = false;
    phase.value = 'done';
  }

  function cancelMigrate() {
    isCancelled.value = true;
  }

  async function resetToConfiguring() {
    phase.value = 'configuring';
    itemStatuses.value = [];
    isMigrating.value = false;
    isCancelled.value = false;
    migrateResult.value = null;
    globalProgress.value = { current: 0, total: 0, percent: 0 };
    migrateStats.value = { startTime: 0, elapsedMs: 0, processedCount: 0, totalCount: 0, totalBytes: 0 };
    await initConfiguring();
  }

  async function retryFailed() {
    await startMigrate();
  }

  return {
    phase, isInitialized,
    maxSuccessCount, showAdvancedFilter,
    targetServices, configuredServices, unconfiguredServices,
    checkedTargets, totalPending, allBackedUp,
    itemStatuses, isMigrating, globalProgress, migrateResult,
    migrateStats, estimatedTimeRemaining, averageSpeed, concurrentCount,
    initConfiguring, applyFilter,
    startMigrate, cancelMigrate, retryFailed, resetToConfiguring,
  };
}
