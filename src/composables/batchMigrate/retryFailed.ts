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

export interface RetryDeps {
  migrateResult: Ref<MigrateResult | null>;
  retryingIds: Ref<Set<string>>;
  getOrCacheConfig: () => Promise<UserConfig>;
  getMultiUploader: () => MultiServiceUploader;
  getRetryTargets?: () => string[];
}

export function createRetry(deps: RetryDeps) {
  const { migrateResult, retryingIds, getOrCacheConfig, getMultiUploader, getRetryTargets } = deps;

  async function retrySingleFailed(historyId: string): Promise<void> {
    if (!migrateResult.value) return;
    if (retryingIds.value.has(historyId)) return;
    const targets = getRetryTargets?.() ?? migrateResult.value.targetServiceIds;
    if (targets.length === 0) return;
    if (migrateResult.value.failures.findIndex(f => f.historyId === historyId) < 0) return;

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
      const nextSnapshot = [...current.itemsSnapshot];
      const idx = nextFailures.findIndex(f => f.historyId === historyId);
      const snapIdx = nextSnapshot.findIndex(s => s.historyId === historyId);
      let successDelta = 0, failedDelta = 0, skippedDelta = 0;

      if (status.status === 'success') {
        if (idx >= 0) { nextFailures.splice(idx, 1); failedDelta = -1; }
        successDelta = 1;
      } else if (status.status === 'skipped') {
        // 目标在 DB 中已全部补齐（其它任务先成功或本次命中 needUploadTargets=0）→ 移出失败列表
        if (idx >= 0) { nextFailures.splice(idx, 1); failedDelta = -1; }
        skippedDelta = 1;
      } else if (status.status === 'failed') {
        if (idx >= 0) nextFailures[idx] = {
          historyId, fileName: status.fileName,
          error: status.error ?? '', errorType: status.errorType,
          details: status.failureDetails ?? [{ message: status.error ?? '' }],
        };
      }
      if (snapIdx >= 0) nextSnapshot[snapIdx] = { ...status };

      migrateResult.value = {
        ...current,
        failures: nextFailures,
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
