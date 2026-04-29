/**
 * done 态失败项重试（单条 + 批量）
 *
 * 从 useBatchMigrate.ts 抽出——主要是为了让主管理器 <=500 行，
 * 同时把"并发安全更新 migrateResult"这段易错逻辑独立测试。
 *
 * 并发安全关键：retryFailed 用 Semaphore(4) 并发跑 retrySingleFailed，
 * 不能在 await 前捕获 migrateResult / failureIdx 闭包快照——否则多个任务
 * 共享旧 result，最后一个写赢，前面 3 个的变更被吃掉，用户点「全部重试」
 * 后失败列表大部分条目不会被清除。
 */
import { ref, type Ref } from 'vue';
import type { MultiServiceUploader } from '../../core/MultiServiceUploader';
import type { UserConfig } from '../../config/types';
import type { MigrateItemStatus, MigrateResult, MigrateStats } from '../../types/batchMigrate';
import { historyDB } from '../../services/HistoryDatabase';
import { createLogger } from '../../utils/logger';
import { Semaphore } from '../../utils/semaphore';
import { migrateOneItem } from './migrateCore';

const log = createLogger('retryFailed');

type FailureRecord = NonNullable<MigrateResult['failures'][number]>;

export interface RetryDeps {
  migrateResult: Ref<MigrateResult | null>;
  retryingIds: Ref<Set<string>>;
  getOrCacheConfig: () => Promise<UserConfig>;
  getMultiUploader: () => MultiServiceUploader;
  getRetryTargets?: () => string[];
}

export function createRetry(deps: RetryDeps) {
  const { migrateResult, retryingIds, getOrCacheConfig, getMultiUploader, getRetryTargets } = deps;

  function targetsForFailure(failure: FailureRecord, baseTargets: string[]): string[] {
    if (!failure.isPartial) return baseTargets;
    const failedTargets = failure.failedTargets?.length
      ? failure.failedTargets
      : failure.details.map(detail => detail.serviceId).filter((sid): sid is string => !!sid);
    return failedTargets.filter(sid => baseTargets.includes(sid));
  }

  function failedTargetsForPartial(failure: FailureRecord | undefined): string[] {
    if (!failure?.isPartial) return [];
    if (failure.failedTargets?.length) return failure.failedTargets;
    return failure.details.map(detail => detail.serviceId).filter((sid): sid is string => !!sid);
  }

  function failedTargetsFromStatus(status: MigrateItemStatus): string[] {
    return Object.entries(status.serviceResults)
      .filter(([, state]) => state === 'failed')
      .map(([sid]) => sid);
  }

  function remainingPartialTargets(
    status: MigrateItemStatus,
    currentFailure: FailureRecord | undefined,
    targets: string[],
  ): string[] {
    const previous = failedTargetsForPartial(currentFailure);
    const attempted = new Set(targets);
    const remaining = new Set<string>();

    for (const sid of previous) {
      if (!attempted.has(sid)) remaining.add(sid);
    }
    for (const sid of failedTargetsFromStatus(status)) {
      remaining.add(sid);
    }

    // Download/metadata failures happen before per-target upload state changes,
    // so keep the attempted partial targets marked unresolved instead of
    // overwriting their failed chips with "pending".
    if (currentFailure?.isPartial && status.status === 'failed' && failedTargetsFromStatus(status).length === 0) {
      for (const sid of previous) {
        if (attempted.has(sid)) remaining.add(sid);
      }
    }

    return [...remaining];
  }

  function detailsForTargets(
    status: MigrateItemStatus,
    currentFailure: FailureRecord | undefined,
    failedTargets: string[],
  ): MigrateResult['failures'][number]['details'] {
    const targetSet = new Set(failedTargets);
    const byService = new Map<string, MigrateResult['failures'][number]['details'][number]>();
    for (const detail of currentFailure?.details ?? []) {
      if (detail.serviceId && targetSet.has(detail.serviceId)) byService.set(detail.serviceId, detail);
    }
    for (const detail of status.failureDetails ?? []) {
      if (detail.serviceId && targetSet.has(detail.serviceId)) byService.set(detail.serviceId, detail);
    }

    const fallbackMessage = status.failureDetails?.find(detail => !detail.serviceId)?.message
      ?? status.error
      ?? currentFailure?.error
      ?? '上传失败';
    return failedTargets.map(serviceId =>
      byService.get(serviceId) ?? { serviceId, message: fallbackMessage },
    );
  }

  function makePartialFailure(
    historyId: string,
    status: MigrateItemStatus,
    currentFailure: FailureRecord | undefined,
    failedTargets: string[],
  ): FailureRecord {
    const details = detailsForTargets(status, currentFailure, failedTargets);
    return {
      historyId,
      fileName: status.fileName,
      error: status.error ?? currentFailure?.error ?? '部分目标上传失败',
      errorType: status.errorType ?? currentFailure?.errorType ?? 'upload',
      details,
      isPartial: true,
      failedTargets,
    };
  }

  function mergePartialSnapshot(
    current: MigrateResult,
    historyId: string,
    status: MigrateItemStatus,
    failedTargets: string[],
  ): MigrateItemStatus[] {
    return current.itemsSnapshot.map(item => {
      if (item.historyId !== historyId) return item;
      if (failedTargets.length > 0) {
        const serviceResults = { ...item.serviceResults, ...status.serviceResults };
        for (const sid of failedTargets) {
          if (serviceResults[sid] !== 'success') serviceResults[sid] = 'failed';
        }
        return {
          ...item,
          sourceUrl: status.sourceUrl ?? item.sourceUrl,
          convertedFormat: status.convertedFormat ?? item.convertedFormat,
          existingServiceIds: status.existingServiceIds ?? item.existingServiceIds,
          serviceResults,
          status: 'success',
          error: status.error ?? item.error,
          errorType: status.errorType ?? item.errorType,
          failureDetails: status.failureDetails ?? item.failureDetails,
        };
      }
      return {
        ...status,
        status: 'success',
      };
    });
  }

  async function retrySingleFailed(historyId: string): Promise<void> {
    const initial = migrateResult.value;
    if (!initial) return;
    if (retryingIds.value.has(historyId)) return;
    const failure = initial.failures.find(f => f.historyId === historyId);
    if (!failure) return;
    const baseTargets = getRetryTargets?.() ?? initial.targetServiceIds;
    const targets = targetsForFailure(failure, baseTargets);
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
      const localCancelled = ref(false);
      const localPaused = ref(false);
      // 不复用主 migrateStats：done 态下主 stats 的 elapsedMs 已停在迁移结束时刻，
      // 若把 retry 下载字节累加进去会让 totalBytes / elapsedMs 平均速度被人为拉高
      const localStats = ref<MigrateStats>({
        startTime: Date.now(), elapsedMs: 0, processedCount: 0, totalCount: 0, totalBytes: 0,
      });
      await migrateOneItem(items[0], status, targets, config, getMultiUploader(), localCancelled, localPaused, localStats);

      // 现读最新 migrateResult（而非 await 前的闭包快照）——并发重试不会互相覆盖
      const current = migrateResult.value;
      if (!current) return;
      const nextFailures = [...current.failures];
      const idx = nextFailures.findIndex(f => f.historyId === historyId);
      const currentFailure = idx >= 0 ? nextFailures[idx] : failure;
      const wasPartial = currentFailure?.isPartial === true;
      const remainingTargets = remainingPartialTargets(status, currentFailure, targets);
      let nextSnapshot = [...current.itemsSnapshot];
      let nextPartialFailures = current.partialFailures.filter(f => f.historyId !== historyId);
      let successDelta = 0, failedDelta = 0, skippedDelta = 0;

      if (status.status === 'success') {
        if (remainingTargets.length > 0) {
          const nextFailure = makePartialFailure(historyId, status, currentFailure, remainingTargets);
          if (idx >= 0) nextFailures[idx] = nextFailure;
          else nextFailures.push(nextFailure);
          nextPartialFailures = [
            ...nextPartialFailures,
            { historyId, fileName: status.fileName, failedTargets: remainingTargets },
          ];
          if (!wasPartial) { failedDelta = -1; successDelta = 1; }
        } else {
          if (idx >= 0) { nextFailures.splice(idx, 1); if (!wasPartial) failedDelta = -1; }
          if (!wasPartial) successDelta = 1;
        }
      } else if (status.status === 'skipped') {
        // 目标在 DB 中已全部补齐（其它任务先成功或本次命中 needUploadTargets=0）→ 移出失败列表
        if (remainingTargets.length > 0) {
          const nextFailure = makePartialFailure(historyId, status, currentFailure, remainingTargets);
          if (idx >= 0) nextFailures[idx] = nextFailure;
          else nextFailures.push(nextFailure);
          nextPartialFailures = [
            ...nextPartialFailures,
            { historyId, fileName: status.fileName, failedTargets: remainingTargets },
          ];
        } else {
          if (idx >= 0) { nextFailures.splice(idx, 1); if (!wasPartial) failedDelta = -1; }
          if (!wasPartial) skippedDelta = 1;
        }
      } else if (status.status === 'failed') {
        const nextFailure = wasPartial
          ? makePartialFailure(historyId, status, currentFailure, remainingTargets)
          : {
              historyId, fileName: status.fileName,
              error: status.error ?? '', errorType: status.errorType,
              details: status.failureDetails ?? [{ message: status.error ?? '' }],
            };
        if (idx >= 0) nextFailures[idx] = nextFailure;
        if (wasPartial) {
          nextPartialFailures = [
            ...nextPartialFailures,
            { historyId, fileName: status.fileName, failedTargets: remainingTargets },
          ];
        }
      }
      nextSnapshot = (wasPartial || remainingTargets.length > 0)
        ? mergePartialSnapshot(current, historyId, status, remainingTargets)
        : nextSnapshot.map(item => item.historyId === historyId ? { ...status } : item);

      migrateResult.value = {
        ...current,
        failures: nextFailures,
        partialFailures: nextPartialFailures,
        itemsSnapshot: nextSnapshot,
        successCount: Math.max(0, current.successCount + successDelta),
        failedCount: Math.max(0, current.failedCount + failedDelta),
        skippedCount: Math.max(0, current.skippedCount + skippedDelta),
      };
    } catch (e) {
      log.error('单条重试失败', e);
    } finally {
      const next = new Set(retryingIds.value);
      next.delete(historyId);
      retryingIds.value = next;
    }
  }

  async function retryFailed(historyIds: string[]): Promise<void> {
    if (historyIds.length === 0) return;
    const sem = new Semaphore(4);
    await Promise.all(historyIds.map(id => sem.withPermit(() => retrySingleFailed(id))));
  }

  return { retrySingleFailed, retryFailed };
}
