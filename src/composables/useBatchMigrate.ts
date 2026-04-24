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
import type { HistoryItem, UserConfig } from '../config/types';
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
import { preloadAllPending, type PreloadedItem } from './batchMigrate/preloadPending';
import { Semaphore } from '../utils/semaphore';

export type { MigratePhase, MigrateTargetService, MigrateItemStatus, MigrateResult, MigrateStats, MigrateFailureDetail };

const log = createLogger('useBatchMigrate');

const PAGE_SIZE = 100;
const MAX_CONSECUTIVE_FAILURES = 10;
/** 离开面板 3 分钟后释放内存（对齐链接监控） */
const IDLE_RELEASE_MS = 3 * 60 * 1000;
/** 冷启动骨架屏最小可见时长，防止加载太快一闪而过 */
const MIN_SKELETON_MS = 400;

// 迁移核心逻辑（migrateOneItem / processBatch / extractErrorMessage 等）抽至 batchMigrate/migrateCore.ts
// 预加载逻辑（preloadAllPending / PreloadedItem）抽至 batchMigrate/preloadPending.ts

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

  // 正在执行 applyFilter 异步查询（counts 尚未刷新，用于抑制依赖 pendingCount 的派生状态误判）
  const isRefiltering = ref(false);

  // 计算属性
  const configuredServices = computed(() => targetServices.value.filter(s => s.isConfigured));
  const unconfiguredServices = computed(() => targetServices.value.filter(s => !s.isConfigured));
  const checkedTargets = computed(() => targetServices.value.filter(s => s.checked && s.isConfigured));
  const totalPending = computed(() => {
    // 取所有已勾选图床中最大的 pendingCount（因为迁移是并行到多个目标）
    if (checkedTargets.value.length === 0) return 0;
    return Math.max(...checkedTargets.value.map(s => s.pendingCount));
  });
  const isAllBackedUp = computed(() => {
    if (!isInitialized.value || !isFilterApplied.value) return false;
    // counts 正在被异步查询刷新，还不能用来判定"已备份"
    if (isRefiltering.value) return false;
    // 来源全未选中时 pendingCount 被短路置 0，语义上无数据可判定
    if (availableSourceServices.value.length > 0 && sourceServiceFilter.value.length === 0) return false;
    return targetServices.value.every(s => !s.isConfigured || s.pendingCount === 0);
  });

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
    // 当前批次对象是 allItemStatuses 头部的共享引用——外层 shallowRef 需要新数组引用来触发响应性，
    // 否则 MigrateProgressPhase 读 allItemStatuses 时看不到批内状态流转
    allItemStatuses.value = [...allItemStatuses.value];
    globalProgress.value = { current: processed, total, percent: total > 0 ? Math.round((processed / total) * 100) : 0 };
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
    // 冷启动：列表是空的，需要走骨架屏；热刷新：保留旧数据，仅用 isRefiltering 做轻刷新
    const isColdStart = targetServices.value.length === 0;
    if (isColdStart) isFilterApplied.value = false;
    // 只要本次会触发骨架屏显示（isInitialized/isFilterApplied 任一为 false），就保证最小可见时长
    // 覆盖 IDLE 清理回来、resetToConfiguring 等场景（targetServices 还在但 isFilterApplied 被置回 false）
    const willShowSkeleton = !isInitialized.value || !isFilterApplied.value;
    const skeletonStart = willShowSkeleton ? Date.now() : 0;
    // 立刻标脏，让 TargetCard 的 pendingCount 进入 stale 态；applyFilter 结束后自动恢复
    isRefiltering.value = true;
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
      // 保留旧 pendingCount，避免热刷新期间数字被瞬间清零闪烁
      const prevPending = new Map(targetServices.value.map(s => [s.serviceId, s.pendingCount] as const));

      const allServices = config.availableServices || [];
      const configured = cachedUploader.filterConfiguredServices(allServices, config);

      targetServices.value = allServices.map(sid => ({
        serviceId: sid,
        displayName: getServiceDisplayName(sid),
        isConfigured: configured.includes(sid),
        pendingCount: prevPending.get(sid) ?? 0,
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
      isRefiltering.value = false;
      return;
    }

    await applyFilter();

    // 默认全选来源图床，减少用户操作步骤
    if (sourceServiceFilter.value.length === 0) {
      sourceServiceFilter.value = availableSourceServices.value.map(s => s.id);
    }

    if (willShowSkeleton) {
      const remaining = MIN_SKELETON_MS - (Date.now() - skeletonStart);
      if (remaining > 0) await new Promise<void>(r => setTimeout(r, remaining));
    }

    isFilterApplied.value = true;
  }

  /**
   * 应用筛选：查询每个已配置图床的待迁移数
   * 利用 getServiceDistribution 获取"已在该图床上的图片数"，然后 total - existing = pending
   */
  async function applyFilter() {
    // 来源全未选中（区别于初始化前的空数组）→ pendingCount 全置 0，不发查询
    const hasAvailableSources = availableSourceServices.value.length > 0;
    if (hasAvailableSources && sourceServiceFilter.value.length === 0) {
      for (const svc of targetServices.value) {
        if (svc.isConfigured) svc.pendingCount = 0;
      }
      // initConfiguring 在调用前可能已把 isRefiltering 拉起来，这里兜底归位
      isRefiltering.value = false;
      return;
    }

    // 标记正在异步刷新（必须在首个 await 之前同步赋值，保证组件渲染时已读到 true）
    isRefiltering.value = true;

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
    } finally {
      isRefiltering.value = false;
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
    allItemStatuses.value = [];

    const config = await getOrCacheConfig();
    const multiUploader = cachedUploader ?? new MultiServiceUploader();

    const startTime = Date.now();
    // 初始 totalCount 用 totalPending（DB 统计），预加载完成后用实际过滤后的数量覆盖
    migrateStats.value = {
      startTime, elapsedMs: 0, processedCount: 0,
      totalCount: totalPending.value, totalBytes: 0,
    };
    globalProgress.value = { current: 0, total: totalPending.value, percent: 0 };

    // ===== 流水线：预加载与处理并发，首批 100 条加载完立即开始处理 =====
    const processQueue: PreloadedItem[] = [];
    let preloadDone = false;
    let preloadError: unknown = null;

    const preloadPromise = preloadAllPending({
      targets,
      maxSuccessCount: maxSuccessCount.value,
      sourceServiceFilter: sourceServiceFilter.value,
      timestampAfter: timestampAfterMs.value,
      allItemStatuses,
      isCancelled,
      isPaused,
      onBatch(batch) { processQueue.push(...batch); },
    }).then(all => {
      migrateStats.value = { ...migrateStats.value, totalCount: all.length };
      globalProgress.value = { ...globalProgress.value, total: all.length };
      preloadDone = true;
    }).catch((err) => {
      log.error('预加载失败', err);
      preloadError = err;
      preloadDone = true;
    });

    let successCount = 0, failedCount = 0, skippedCount = 0;
    const failures: MigrateResult['failures'] = [];
    const partialFailures: MigrateResult['partialFailures'] = [];
    let processed = 0, consecutiveFailures = 0, autoAborted = false;
    cumulativeCounts.value = { success: 0, failed: 0, skipped: 0 };

    let cursor = 0;
    while (true) {
      if (isCancelled.value) break;

      while (isPaused.value && !isCancelled.value) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (isCancelled.value) break;

      if (cursor >= processQueue.length) {
        if (preloadDone) break; // 全部加载完且已全部处理 → 退出
        await new Promise(r => setTimeout(r, 0)); // yield：等 onBatch 推入新条目
        continue;
      }

      const totalToProcess = migrateStats.value.totalCount;
      const end = Math.min(cursor + PAGE_SIZE, processQueue.length);
      const chunk = processQueue.slice(cursor, end);
      // 过滤出仍为 pending 的（暂停回退 / 上一轮未处理完的重试）
      const pendingChunk = chunk.filter(p => p.status.status === 'pending');
      if (pendingChunk.length === 0) {
        cursor = end;
        continue;
      }

      // 按需拉取当前 chunk 的完整 HistoryItem：
      // processQueue 只存 id，避免整个待迁移集合的 HistoryItem 常驻内存
      const fetched = await historyDB.getItemsByIds(pendingChunk.map(p => p.id));
      const byId = new Map(fetched.map(i => [i.id, i]));

      const batchItems: HistoryItem[] = [];
      const batchStatuses: MigrateItemStatus[] = [];
      for (const p of pendingChunk) {
        const item = byId.get(p.id);
        if (!item) {
          // 预加载到处理间隙被删除 → 视为 skipped，不再走 processBatch
          p.status.status = 'skipped';
          skippedCount++;
          processed++;
          continue;
        }
        batchItems.push(item);
        batchStatuses.push(p.status);
      }
      if (batchStatuses.length === 0) {
        cumulativeCounts.value = { success: successCount, failed: failedCount, skipped: skippedCount };
        migrateStats.value = {
          ...migrateStats.value,
          processedCount: processed,
          elapsedMs: Date.now() - startTime,
        };
        allItemStatuses.value = [...allItemStatuses.value];
        globalProgress.value = {
          current: processed,
          total: totalToProcess,
          percent: totalToProcess > 0 ? Math.round((processed / totalToProcess) * 100) : 0,
        };
        cursor = end;
        continue;
      }
      itemStatuses.value = batchStatuses;

      await processBatch(batchItems, batchStatuses, targets, config, multiUploader, isCancelled, isPaused, migrateStats, (status) => {
        if (status.status === 'pending') return;
        if (status.status === 'success') {
          successCount++;
          consecutiveFailures = 0;
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
      // 目标级落定（并行上传时单个目标成功/失败）→ RAF 节流刷新 chip，让 UI 一个个变色
      }, () => scheduleStatusUpdate(batchStatuses, processed, totalToProcess));

      flushStatusUpdate();

      // 当前 chunk 所有项都落定 → 推进 cursor；否则重试本 chunk（暂停场景回退为 pending 时）
      const allSettled = batchStatuses.every(s => s.status !== 'pending');
      if (allSettled) cursor = end;
    }

    await preloadPromise; // 确保预加载 Promise 落定（cancel 时也需干净退出）

    let pauseReason: MigrateResult['pauseReason'];
    if (autoAborted) pauseReason = 'consecutive-failures';
    else if (isCancelled.value) pauseReason = 'user-cancelled';
    else if (preloadError !== null) pauseReason = 'preload-error';
    finalizeResult(targets, startTime, successCount, failedCount, skippedCount, failures, partialFailures, pauseReason);
  }

  /** 收尾：构造 migrateResult + 切 done 态 */
  function finalizeResult(
    targets: string[],
    startTime: number,
    successCount: number,
    failedCount: number,
    skippedCount: number,
    failures: MigrateResult['failures'],
    partialFailures: MigrateResult['partialFailures'],
    pauseReason?: MigrateResult['pauseReason'],
  ) {
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
        sourceUrl: items[0].results.find(r => r.status === 'success' && r.result?.url)?.result?.url,
        status: 'pending',
        serviceResults: Object.fromEntries(targets.map(sid => [sid, 'pending' as const])),
        existingServiceIds: items[0].results.filter(r => r.status === 'success').map(r => r.serviceId),
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
   * 并发上限与 MAX_CONCURRENT 对齐
   */
  async function retryFailed(historyIds: string[]): Promise<void> {
    if (historyIds.length === 0) return;
    const sem = new Semaphore(4);
    await Promise.all(historyIds.map(id => sem.withPermit(() => retrySingleFailed(id))));
  }

  // ============================================
  // 内存空闲释放（对齐链接监控 useLinkCheck）
  // 离开面板超过 IDLE_RELEASE_MS 且非活跃迁移/重试 → 清空预加载/结果释放内存
  // UI 回到面板时通过 wasIdleCleared 标志触发 toast 告知用户
  // ============================================

  /** idle 定时器已触发过清理，UI 下次 onActivated 读到后显示 toast 再重置 */
  const wasIdleCleared = ref(false);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelIdleTimer() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }

  function onViewActivated() {
    cancelIdleTimer();
  }

  /**
   * 宿主组件真正 unmount 时调用：仅取消挂起的 idle 定时器，
   * 避免孤立的 setTimeout 持有整个 composable 闭包到超时才释放。
   */
  function dispose() {
    cancelIdleTimer();
  }

  function onViewDeactivated() {
    cancelIdleTimer();
    // 迁移中 / 存在正在重试项 → 绝不启动清理（避免打断进行中的工作）
    if (isMigrating.value) return;
    if (retryingIds.value.size > 0) return;
    // 列表/结果本来就是空 → 没必要启动定时器
    if (allItemStatuses.value.length === 0 && !migrateResult.value) return;

    idleTimer = setTimeout(() => {
      idleTimer = null;
      // 触发时再次校验，避免 race（用户刚好在定时器触发前开始新迁移）
      if (isMigrating.value || retryingIds.value.size > 0) return;
      // 清空大块内存
      itemStatuses.value = [];
      allItemStatuses.value = [];
      migrateResult.value = null;
      globalProgress.value = { current: 0, total: 0, percent: 0 };
      migrateStats.value = { startTime: 0, elapsedMs: 0, processedCount: 0, totalCount: 0, totalBytes: 0 };
      cumulativeCounts.value = { success: 0, failed: 0, skipped: 0 };
      // 回到配置页（保留目标图床勾选状态，用户回来不用重选）
      phase.value = 'configuring';
      isFilterApplied.value = false;
      wasIdleCleared.value = true;
      log.info(`迁移面板闲置 ${IDLE_RELEASE_MS / 60_000} 分钟，已释放内存`);
    }, IDLE_RELEASE_MS);
  }

  return {
    phase, isInitialized, isFilterApplied, isRefiltering, initError,
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
    onViewActivated, onViewDeactivated, wasIdleCleared, dispose,
  };
}
