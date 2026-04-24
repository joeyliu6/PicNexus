// 按图床结果粒度删除（链接监控专用）：
// 一条 HistoryItem 可能挂了多个图床上传结果；这里提供"只摘除其中一项"的能力。
// 被摘除者若恰为 primaryService，会从剩余 success 结果里补选；若结果数归零，则降级为整条删除。

import type { Ref } from 'vue';
import type { HistoryItem } from '../../config/types';
import { historyDB } from '../../services/HistoryDatabase';
import { useConfirm } from '../useConfirm';
import { useToast } from '../useToast';
import { TOAST_MESSAGES } from '../../constants';
import {
  emitHistoryDeleted,
  emitHistoryUpdated,
} from '../../events/cacheEvents';
import { createLogger } from '../../utils/logger';
import type { useImageDetailCache } from '../useImageDetailCache';

const log = createLogger('History');

export interface ResultOpsContext {
  totalCount: Ref<number>;
  dataVersion: Ref<number>;
  detailCache: ReturnType<typeof useImageDetailCache>;
  removeFavoritesFromIds: (ids: string[]) => void;
}

export interface ResultDeleteTarget {
  historyId: string;
  serviceId: string;
}

export type ResultDeleteOutcome = 'deleted' | 'updated' | false;

function stripServiceFromItem(
  item: HistoryItem,
  serviceId: string,
): { nextItem: HistoryItem | null; matched: boolean } {
  const nextResults = item.results.filter((r) => r.serviceId !== serviceId);
  const matched = nextResults.length !== item.results.length;
  if (!matched) return { nextItem: item, matched: false };

  if (nextResults.length === 0) {
    return { nextItem: null, matched: true };
  }

  const nextStatus = item.linkCheckStatus ? { ...item.linkCheckStatus } : undefined;
  if (nextStatus) delete nextStatus[serviceId];

  // summary 只统计 success 上传（与 linkCheckPersistence 构造 summary 时的口径一致，
  // 否则 failed 上传会被算成 unchecked，造成"未检测"数量虚增）
  const successResults = nextResults.filter((r) => r.status === 'success' && r.result?.url);
  const total = successResults.length;
  let valid = 0;
  let invalid = 0;
  let unchecked = 0;
  if (nextStatus) {
    for (const r of successResults) {
      const s = nextStatus[r.serviceId];
      if (!s) { unchecked += 1; continue; }
      if (s.errorType === 'pending') { unchecked += 1; continue; }
      if (s.isValid) valid += 1;
      else invalid += 1;
    }
  } else {
    unchecked = total;
  }

  const nextSummary = item.linkCheckSummary
    ? {
        ...item.linkCheckSummary,
        totalLinks: total,
        validLinks: valid,
        invalidLinks: invalid,
        uncheckedLinks: unchecked,
      }
    : undefined;

  let nextPrimary = item.primaryService;
  let nextGeneratedLink = item.generatedLink;
  if (item.primaryService === serviceId) {
    const nextPrimaryResult = nextResults.find((r) => r.status === 'success' && r.result?.url);
    // 剥完没有任何可用的 success 镜像 → 整条删除，避免留下 generatedLink='' 的孤儿记录
    if (!nextPrimaryResult) {
      return { nextItem: null, matched: true };
    }
    nextPrimary = nextPrimaryResult.serviceId;
    nextGeneratedLink = nextPrimaryResult.result!.url!;
  }

  const nextItem: HistoryItem = {
    ...item,
    results: nextResults,
    linkCheckStatus: nextStatus,
    linkCheckSummary: nextSummary,
    primaryService: nextPrimary,
    generatedLink: nextGeneratedLink,
  };
  return { nextItem, matched: true };
}

export function createResultOps(ctx: ResultOpsContext) {
  const toast = useToast();
  const { confirm } = useConfirm();

  async function applyChanges(
    deletedItemIds: string[],
    updatedItemIds: string[],
  ): Promise<void> {
    if (deletedItemIds.length > 0) {
      ctx.totalCount.value = Math.max(0, ctx.totalCount.value - deletedItemIds.length);
      ctx.removeFavoritesFromIds(deletedItemIds);
      deletedItemIds.forEach((id) => ctx.detailCache.removeDetail(id));
    }
    if (updatedItemIds.length > 0) {
      updatedItemIds.forEach((id) => ctx.detailCache.removeDetail(id));
    }
    if (deletedItemIds.length + updatedItemIds.length > 0) {
      ctx.dataVersion.value += 1;
    }

    if (deletedItemIds.length > 0) {
      emitHistoryDeleted(deletedItemIds).catch((e) => {
        log.warn('[历史记录] 跨窗口通知失败(deleted):', e);
      });
    }
    if (updatedItemIds.length > 0) {
      emitHistoryUpdated(updatedItemIds).catch((e) => {
        log.warn('[历史记录] 跨窗口通知失败(updated):', e);
      });
    }
  }

  async function deleteHistoryResult(
    historyId: string,
    serviceId: string,
  ): Promise<ResultDeleteOutcome> {
    try {
      if (!historyId || !serviceId) {
        toast.showConfig('error', TOAST_MESSAGES.history.invalidId);
        return false;
      }

      const existing = await historyDB.getById(historyId);
      if (!existing) {
        toast.showConfig('error', TOAST_MESSAGES.history.invalidId);
        return false;
      }

      const isLast = existing.results.length <= 1;
      const confirmMsg = isLast
        ? '这是该图片的最后一个图床链接，删除后整条历史记录会被一起移除。此操作不可撤销，是否继续？'
        : '仅删除此图床的这条链接，图片的其他图床结果会保留。此操作不可撤销，是否继续？';

      const confirmed = await confirm(confirmMsg, {
        header: isLast ? '确认删除整条记录' : '确认删除链接',
        acceptLabel: '删除',
        acceptClass: 'p-button-danger',
      });
      if (!confirmed) return false;

      const { nextItem, matched } = stripServiceFromItem(existing, serviceId);
      if (!matched) {
        log.warn('[历史记录] 目标图床不存在，跳过删除', { historyId, serviceId });
        return false;
      }

      if (nextItem === null) {
        await historyDB.delete(historyId);
        await applyChanges([historyId], []);
        toast.showConfig('success', TOAST_MESSAGES.common.deleteSuccess(1));
        return 'deleted';
      }

      await historyDB.update(historyId, {
        results: nextItem.results,
        linkCheckStatus: nextItem.linkCheckStatus,
        linkCheckSummary: nextItem.linkCheckSummary,
        primaryService: nextItem.primaryService,
        generatedLink: nextItem.generatedLink,
      });
      await applyChanges([], [historyId]);
      toast.showConfig('success', TOAST_MESSAGES.common.deleteSuccess(1));
      return 'updated';
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error('[历史记录] 删除图床结果失败:', error);
      toast.showConfig('error', TOAST_MESSAGES.common.deleteFailed(msg));
      return false;
    }
  }

  async function bulkDeleteHistoryResults(
    targets: ResultDeleteTarget[],
  ): Promise<boolean> {
    try {
      if (targets.length === 0) {
        toast.showConfig('warn', TOAST_MESSAGES.common.noSelection);
        return false;
      }

      const grouped = new Map<string, Set<string>>();
      for (const t of targets) {
        if (!t.historyId || !t.serviceId) continue;
        const set = grouped.get(t.historyId) ?? new Set<string>();
        set.add(t.serviceId);
        grouped.set(t.historyId, set);
      }
      if (grouped.size === 0) return false;

      const confirmed = await confirm(
        `将删除选中的 ${targets.length} 条图床链接，部分图片可能因此整条被移除。此操作不可撤销，是否继续？`,
        {
          header: '批量删除链接',
          acceptLabel: `删除 ${targets.length} 条`,
          acceptClass: 'p-button-danger',
        },
      );
      if (!confirmed) return false;

      const deletedItemIds: string[] = [];
      const updatedItemIds: string[] = [];

      for (const [historyId, serviceSet] of grouped) {
        const existing = await historyDB.getById(historyId);
        if (!existing) continue;

        let current: HistoryItem | null = existing;
        let anyMatched = false;
        for (const serviceId of serviceSet) {
          if (!current) break;
          const { nextItem, matched } = stripServiceFromItem(current, serviceId);
          if (matched) anyMatched = true;
          current = nextItem;
        }
        if (!anyMatched) continue;

        if (current === null) {
          await historyDB.delete(historyId);
          deletedItemIds.push(historyId);
        } else {
          await historyDB.update(historyId, {
            results: current.results,
            linkCheckStatus: current.linkCheckStatus,
            linkCheckSummary: current.linkCheckSummary,
            primaryService: current.primaryService,
            generatedLink: current.generatedLink,
          });
          updatedItemIds.push(historyId);
        }
      }

      const totalTouched = deletedItemIds.length + updatedItemIds.length;
      if (totalTouched === 0) return false;

      await applyChanges(deletedItemIds, updatedItemIds);
      toast.showConfig('success', TOAST_MESSAGES.common.deleteSuccess(targets.length));
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error('[历史记录] 批量删除图床结果失败:', error);
      toast.showConfig('error', TOAST_MESSAGES.common.deleteFailed(msg));
      return false;
    }
  }

  return { deleteHistoryResult, bulkDeleteHistoryResults };
}
