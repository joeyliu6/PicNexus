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
import { MultiServiceUploader } from '../core/MultiServiceUploader';
import { historyDB } from '../services/HistoryDatabase';
import { configStore } from '../store/instances';
import { getServiceDisplayName } from '../constants/serviceNames';
import { createLogger } from '../utils/logger';
import type { UserConfig } from '../config/types';
import { DEFAULT_CONFIG } from '../config/types';
import type {
  MigratePhase,
  MigrateTargetService,
  MigrateItemStatus,
  MigrateResult,
  MigrateStats,
  MigrateFailureDetail,
} from '../types/batchMigrate';
import { migrateOneItem, processBatch } from './batchMigrate/migrateCore';
import { Semaphore } from '../utils/semaphore';

export type { MigratePhase, MigrateTargetService, MigrateItemStatus, MigrateResult, MigrateStats, MigrateFailureDetail };

const log = createLogger('useBatchMigrate');

const PAGE_SIZE = 100;
const MAX_CONSECUTIVE_FAILURES = 10;

// 迁移核心逻辑（migrateOneItem / processBatch / extractErrorMessage 等）抽至 batchMigrate/migrateCore.ts

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
  const timestampAfterMs = ref<number | null>(null); // 上传时间起点（ms 时间戳），null = 不限

  // 图床配置
  const targetServices = ref<MigrateTargetService[]>([]);

  // 执行
  const itemStatuses = shallowRef<MigrateItemStatus[]>([]);
  const allItemStatuses = shallowRef<MigrateItemStatus[]>([]);
  const isMigrating = ref(false);
  const isCancelled = ref(false);
  // 用户点击暂停后立即置为 true；主循环在拉取下一批前阻塞，在途条目按保守策略（下载中继续下完不上传、上传中完成后不再派发）落定
  const isPaused = ref(false);
  const migrateResult = ref<MigrateResult | null>(null);
  const globalProgress = ref({ current: 0, total: 0, percent: 0 });

  // 累计统计（迁移进行中实时更新，UI 可绑定）
  const cumulativeCounts = ref({ success: 0, failed: 0, skipped: 0 });

  // done 态下正在原地重试的 historyId 集合（驱动 UI spinner）
  const retryingIds = ref<Set<string>>(new Set());

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
    itemStatuses.value.filter(s =>
      s.status === 'downloading' || s.status === 'converting' || s.status === 'uploading',
    ).length,
  );

  // "正在暂停..." —— 用户已点暂停但仍有在途条目未落定（下载/转换/上传中）
  const isPausing = computed(() => isPaused.value && concurrentCount.value > 0);

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
      const timestampAfter = timestampAfterMs.value ?? undefined;
      const params = {
        maxSuccessCount: maxSuccessCount.value,
        hasServiceId,
        timestampAfter,
      };

      // 获取总数 + 各图床分布（同时获取不带来源筛选的分布，用于构建来源下拉列表）
      const [{ total }, existingMap, allDistribution] = await Promise.all([
        historyDB.getItemsByBackupCount({ ...params, limit: 1, offset: 0 }),
        historyDB.getServiceDistribution(params),
        // 不带 hasServiceId 的分布——用于构建来源图床列表（时间范围仍生效，避免列表中出现无记录项）
        historyDB.getServiceDistribution({ maxSuccessCount: maxSuccessCount.value, timestampAfter }),
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
    isPaused.value = false;
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
    let autoAborted = false;

    globalProgress.value = { current: 0, total: totalToProcess, percent: 0 };

    // 跟踪已处理（跳过/失败）但未从查询中消失的 ID，避免重复处理
    const processedIds = new Set<string>();
    let skipOffset = 0;

    while (!isCancelled.value) {
      // 暂停等待：在拉取下一批前阻塞，直至 resume 或取消
      while (isPaused.value && !isCancelled.value) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (isCancelled.value) break;

      const { items, total: queryTotal } = await historyDB.getItemsByBackupCount({
        maxSuccessCount: maxSuccessCount.value,
        hasServiceId: sourceServiceFilter.value.length > 0 ? sourceServiceFilter.value : undefined,
        timestampAfter: timestampAfterMs.value ?? undefined,
        limit: PAGE_SIZE,
        offset: skipOffset,
      });

      if (items.length === 0) break;

      // 过滤掉已处理过的 + 对所有勾选目标都已存在的项
      // 后者避免 migrateCore 白跑一轮判定为 skipped，也不再污染结果列表
      const newItems = items.filter(item => {
        if (processedIds.has(item.id)) return false;
        const existingIds = new Set(
          item.results.filter(r => r.status === 'success').map(r => r.serviceId),
        );
        return targets.some(t => !existingIds.has(t));
      });
      if (newItems.length === 0) {
        // 当前页全是已处理或已备份项，继续翻页
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

      await processBatch(newItems, batchStatuses, targets, config, multiUploader, isCancelled, isPaused, migrateStats, (status) => {
        // 暂停期间被"持有"的条目保持 pending 不计入统计，resume 后会重新查询
        if (status.status === 'pending') return;
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
          if (status.error) failures.push({
            historyId: status.historyId,
            fileName: status.fileName,
            error: status.error,
            errorType: status.errorType,
            details: status.failureDetails ?? [{ message: status.error }],
          });
          // 连续失败过多 → 自动终止（走 isCancelled 分支，pauseReason 记为 consecutive-failures）
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && !autoAborted) {
            autoAborted = true;
            isCancelled.value = true;
            log.warn(`连续 ${consecutiveFailures} 次失败，自动终止迁移`);
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
      // 暂停期间被持有的 pending 条目不入集合，resume 后可以被重新查询到
      for (const status of batchStatuses) {
        if (status.status !== 'pending') processedIds.add(status.historyId);
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

    const pauseReason = autoAborted
      ? 'consecutive-failures' as const
      : isCancelled.value
        ? 'user-cancelled' as const
        : undefined;
    const finalElapsed = Date.now() - startTime;
    migrateResult.value = {
      successCount, failedCount, skippedCount, failures, partialFailures, pauseReason,
      durationMs: finalElapsed,
      avgBytesPerSec: finalElapsed > 0 ? migrateStats.value.totalBytes / (finalElapsed / 1000) : 0,
      targetServiceIds: [...targets],
      itemsSnapshot: allItemStatuses.value.slice(),
    };
    isMigrating.value = false;
    phase.value = 'done';
  }

  function cancelMigrate() {
    isCancelled.value = true;
    // 取消时顺带解除暂停，让主循环 while-pause 立即 break
    isPaused.value = false;
  }

  function pauseMigrate() {
    if (!isMigrating.value || isCancelled.value) return;
    isPaused.value = true;
  }

  function resumeMigrate() {
    if (!isPaused.value) return;
    isPaused.value = false;
  }

  async function resetToConfiguring() {
    phase.value = 'configuring';
    itemStatuses.value = [];
    allItemStatuses.value = [];
    isMigrating.value = false;
    isCancelled.value = false;
    isPaused.value = false;
    migrateResult.value = null;
    globalProgress.value = { current: 0, total: 0, percent: 0 };
    migrateStats.value = { startTime: 0, elapsedMs: 0, processedCount: 0, totalCount: 0, totalBytes: 0 };
    cumulativeCounts.value = { success: 0, failed: 0, skipped: 0 };
    sourceServiceFilter.value = [];
    timestampAfterMs.value = null;
    isFilterApplied.value = false;
    cachedConfig = null;
    await initConfiguring();
  }

  /**
   * 单条原地重试（done 态专用）
   * 不改 phase，失败行视觉上变为「重试中」，完成后根据结果更新 migrateResult
   */
  async function retrySingleFailed(historyId: string): Promise<void> {
    if (!migrateResult.value) return;
    if (retryingIds.value.has(historyId)) return;
    const result = migrateResult.value;
    const failureIdx = result.failures.findIndex(f => f.historyId === historyId);
    if (failureIdx < 0) return;
    const targets = result.targetServiceIds;
    if (targets.length === 0) return;

    retryingIds.value = new Set([...retryingIds.value, historyId]);
    try {
      const items = await historyDB.getItemsByIds([historyId]);
      if (items.length === 0) return;
      const status: MigrateItemStatus = {
        historyId,
        fileName: items[0].localFileName,
        status: 'pending',
        serviceResults: Object.fromEntries(targets.map(sid => [sid, 'pending' as const])),
      };
      const config = await getOrCacheConfig();
      const multiUploader = cachedUploader ?? new MultiServiceUploader();
      const localCancelled = ref(false);
      const localPaused = ref(false);
      await migrateOneItem(items[0], status, targets, config, multiUploader, localCancelled, localPaused, migrateStats);

      const newResult = { ...result, failures: [...result.failures], itemsSnapshot: [...result.itemsSnapshot] };
      if (status.status === 'success') {
        newResult.failures.splice(failureIdx, 1);
        newResult.successCount++;
        newResult.failedCount = Math.max(0, newResult.failedCount - 1);
      } else if (status.status === 'failed') {
        newResult.failures[failureIdx] = {
          historyId, fileName: status.fileName,
          error: status.error ?? '', errorType: status.errorType,
          details: status.failureDetails ?? [{ message: status.error ?? '' }],
        };
      }
      const snapIdx = newResult.itemsSnapshot.findIndex(s => s.historyId === historyId);
      if (snapIdx >= 0) newResult.itemsSnapshot[snapIdx] = { ...status };
      migrateResult.value = newResult;
    } catch (e) {
      log.error('单条重试失败', e);
    } finally {
      const next = new Set(retryingIds.value);
      next.delete(historyId);
      retryingIds.value = next;
    }
  }

  /**
   * 批量原地重试失败项（done 态专用，不改 phase）
   * 并发上限 2，与 MAX_CONCURRENT 对齐
   */
  async function retryFailed(historyIds: string[]): Promise<void> {
    if (historyIds.length === 0) return;
    const sem = new Semaphore(2);
    await Promise.all(historyIds.map(id => sem.withPermit(() => retrySingleFailed(id))));
  }

  return {
    phase, isInitialized, isFilterApplied, initError,
    maxSuccessCount, sourceServiceFilter, availableSourceServices,
    timestampAfterMs,
    targetServices, configuredServices, unconfiguredServices,
    checkedTargets, totalPending, isAllBackedUp,
    itemStatuses, allItemStatuses, isMigrating, globalProgress, migrateResult, cumulativeCounts,
    retryingIds,
    isPaused, isPausing,
    migrateStats, estimatedTimeRemaining, averageSpeed, concurrentCount,
    initConfiguring, applyFilter,
    startMigrate, cancelMigrate, pauseMigrate, resumeMigrate,
    retryFailed, retrySingleFailed, resetToConfiguring,
  };
}
