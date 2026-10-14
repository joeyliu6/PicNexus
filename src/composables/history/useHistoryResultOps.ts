// 按图床结果粒度删除（链接检测专用）：
// 一条 HistoryItem 可能挂了多个图床上传结果；这里提供"只摘除其中几项"的能力。
// 被摘除者若恰为 primaryService，会从剩余 success 结果里补选；若结果数归零，则降级为整条删除。

import type { Ref } from 'vue';
import type { HistoryItem } from '@/config/types';
import { historyDB } from '@/services/database';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { TOAST_MESSAGES } from '@/constants';
import {
  emitHistoryDeleted,
  emitHistoryUpdated,
} from '@/events/cacheEvents';
import { createLogger } from '@/utils/logger';
import { isUsableMirror } from '@/utils/historyResults';
import { recomputeLinkCheckSummary } from '@/types/linkCheckSummary';
import type { useImageDetailCache } from '@/composables/image/useImageDetailCache';

const log = createLogger('History');

export interface ResultOpsContext {
  totalCount: Ref<number>;
  dataVersion: Ref<number>;
  detailCache: ReturnType<typeof useImageDetailCache>;
  removeFavoritesFromIds: (ids: string[]) => void;
  refreshServiceCounts: () => Promise<void>;
  refreshTimePeriodStats: () => Promise<void>;
}

export interface ResultDeleteTarget {
  historyId: string;
  serviceId: string;
}

/**
 * 批量移除确认框的文案，调用方可整套换掉
 *
 * 默认按「N 条链接」说；链接检测按图片列表，它会换成「移除这张图」「移除 N 张找不回的图片」。
 * 换文案时 message 里同样要讲清「图床上的文件不受影响」与「无法撤销」。
 */
export interface BulkDeleteConfirmCopy {
  header: string;
  message: string;
  acceptLabel: string;
}

/** 批量删除的执行报告：只有走到执行阶段才会返回（未确认/空选/全非法时返回 false） */
export interface BulkResultDeleteReport {
  /** 实际从记录中抹除的选中链接条数（含随整条记录一起消失的）；已不存在的目标不计入 */
  removedCount: number;
  /**
   * 选中行已处理完毕的记录 id，视图据此移除对应行。
   * 包含三类：整条删除、部分剥离，以及"目标本就不存在"（记录已被别处删掉、
   * 或该 serviceId 已不在记录上）——最后一类没有写库，但行已无对应数据，同样该消失。
   */
  resolvedHistoryIds: string[];
  /** 处理中途抛错的记录 id——DB 未改动，对应行应保留供重试 */
  failedHistoryIds: string[];
}

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

  const nextSummary = recomputeLinkCheckSummary(nextResults, nextStatus, item.linkCheckSummary);

  let nextPrimary = item.primaryService;
  let nextGeneratedLink = item.generatedLink;
  if (item.primaryService === serviceId) {
    const nextPrimaryResult = nextResults.find(isUsableMirror);
    // 剥完没有任何可用镜像 → 整条删除，避免留下 generatedLink='' 的孤儿记录
    if (!nextPrimaryResult) {
      return { nextItem: null, matched: true };
    }
    nextPrimary = nextPrimaryResult.serviceId;
    nextGeneratedLink = nextPrimaryResult.result.url;
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
      await ctx.refreshServiceCounts();
      ctx.dataVersion.value += 1;
    }
    if (deletedItemIds.length > 0) {
      // 整条记录被删会改变时间轴的月份统计；仅剥离镜像不动 timestamp，无需刷新
      void ctx.refreshTimePeriodStats();
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

  /**
   * 批量删除图床链接（按记录隔离失败）
   *
   * 底层是逐条写库、无法回滚（tauri-plugin-sql 连接池不保证跨语句事务），
   * 所以这里不追求原子性，而是把"部分失败"做成明确契约：
   * - 每条记录独立 try/catch，一条抛错不拖累其余记录；
   * - applyChanges 只对真落库的部分生效，内存计数/事件与 DB 实际状态一致；
   * - toast 报实际抹除条数，部分失败时另给可重试提示；
   * - 返回报告标明哪些记录动了、哪些失败，调用方据此只移除对应的行。
   */
  async function bulkDeleteHistoryResults(
    targets: ResultDeleteTarget[],
    copy?: BulkDeleteConfirmCopy,
  ): Promise<BulkResultDeleteReport | false> {
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
        copy?.message
          ?? `将从 PicNexus 的记录里移除 ${targets.length} 条图床链接，图床上的文件不会被删除；只剩这些链接的图片会从历史记录里消失。移除后无法撤销。`,
        {
          header: copy?.header ?? `移除 ${targets.length} 条链接？`,
          acceptLabel: copy?.acceptLabel ?? `移除 ${targets.length} 条`,
          acceptClass: 'p-button-danger',
        },
      );
      if (!confirmed) return false;

      const deletedItemIds: string[] = [];
      const updatedItemIds: string[] = [];
      const staleHistoryIds: string[] = [];
      const failedHistoryIds: string[] = [];
      let removedCount = 0;
      let failedLinkCount = 0;
      let firstErrorMsg = '';

      for (const [historyId, serviceSet] of grouped) {
        try {
          const existing = await historyDB.getById(historyId);
          // 记录已被别处删掉：不算失败也不计数，但行已无对应数据，标记为可移除
          if (!existing) {
            staleHistoryIds.push(historyId);
            continue;
          }

          // 实际生效条数 = 选中且真实存在于该记录上的 serviceId 数。
          // 整条删除时未逐个剥到的选中链接也随记录一起消失，同样计入。
          const presentIds = new Set(existing.results.map((r) => r.serviceId));
          const effectiveCount = [...serviceSet].filter((id) => presentIds.has(id)).length;
          // 选中的链接都已不在记录上（比如别的窗口先剥掉了）：同上，行可移除
          if (effectiveCount === 0) {
            staleHistoryIds.push(historyId);
            continue;
          }

          let current: HistoryItem | null = existing;
          for (const serviceId of serviceSet) {
            if (!current) break;
            current = stripServiceFromItem(current, serviceId).nextItem;
          }

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
          removedCount += effectiveCount;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (!firstErrorMsg) firstErrorMsg = msg;
          failedHistoryIds.push(historyId);
          failedLinkCount += serviceSet.size;
          log.error('[历史记录] 批量删除中单条记录处理失败:', { historyId, error });
        }
      }

      // applyChanges 只对真落库的部分生效；「目标本就不存在」的记录没有写库，
      // 不减计数、不广播（真正删它的那次操作已经广播过了）
      if (deletedItemIds.length + updatedItemIds.length > 0) {
        await applyChanges(deletedItemIds, updatedItemIds);
      }

      if (failedHistoryIds.length === 0) {
        // 全是陈旧目标时静默：没有真删任何东西，行消失本身就是反馈
        if (removedCount > 0) {
          toast.showConfig('success', TOAST_MESSAGES.common.deleteSuccess(removedCount));
        }
      } else if (removedCount > 0) {
        toast.showConfig('warn', TOAST_MESSAGES.common.deletePartial(removedCount, failedLinkCount));
      } else {
        toast.showConfig('error', TOAST_MESSAGES.common.deleteFailed(firstErrorMsg));
      }

      return {
        removedCount,
        resolvedHistoryIds: [...deletedItemIds, ...updatedItemIds, ...staleHistoryIds],
        failedHistoryIds,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error('[历史记录] 批量删除图床结果失败:', error);
      toast.showConfig('error', TOAST_MESSAGES.common.deleteFailed(msg));
      return false;
    }
  }

  return { bulkDeleteHistoryResults };
}
