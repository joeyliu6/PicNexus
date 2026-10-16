// 批量操作（导出 / 移除记录 / 撤销移除）从 useHistory.ts 抽离，降低主文件体积

import type { Ref } from 'vue';
import type { HistoryItem } from '@/config/types';
import { historyDB } from '@/services/database';
import { useToast } from '@/composables/useToast';
import { TOAST_MESSAGES } from '@/constants';
import { emitHistoryDeleted, emitHistoryUpdated } from '@/events/cacheEvents';
import { createLogger } from '@/utils/logger';
import { exportTextFile } from '@/utils/userFiles';
import type { useImageDetailCache } from '@/composables/image/useImageDetailCache';

const log = createLogger('History');

export interface BulkOpsContext {
  totalCount: Ref<number>;
  dataVersion: Ref<number>;
  detailCache: ReturnType<typeof useImageDetailCache>;
  removeFavoritesFromIds: (ids: string[]) => void;
  refreshServiceCounts: () => Promise<void>;
  refreshTimePeriodStats: () => Promise<void>;
}

export function createBulkOps(ctx: BulkOpsContext) {
  const toast = useToast();

  async function bulkExportJSON(selectedIds: string[]): Promise<void> {
    try {
      if (selectedIds.length === 0) {
        toast.showConfig('warn', TOAST_MESSAGES.common.noSelection);
        return;
      }
      // 一次批量取回：未命中缓存的部分合并成一条 IN 查询，不再逐条 IPC 往返。
      // DB 出错时直接抛给外层 catch 走「导出失败」toast——半份 JSON 比报错更坑。
      const details = await ctx.detailCache.getDetails(selectedIds);
      const missingCount = details.filter(d => d === null).length;
      if (missingCount > 0) {
        log.warn(`[批量操作] 跳过 ${missingCount} 条查不到的记录`);
      }
      const selectedItems = details.filter((d): d is HistoryItem => d !== null);
      if (selectedItems.length === 0) {
        toast.showConfig('warn', TOAST_MESSAGES.history.noLoadableData);
        return;
      }
      const jsonContent = JSON.stringify(selectedItems, null, 2);
      const filePath = await exportTextFile(
        `picnexus-history-${Date.now()}.json`,
        [{ name: 'JSON', extensions: ['json'] }],
        jsonContent,
      );
      if (!filePath) return;
      toast.showConfig('success', TOAST_MESSAGES.common.exportSuccess(selectedItems.length));
    } catch (error) {
      log.error('[批量操作] 导出失败:', error);
      toast.showConfig('error', TOAST_MESSAGES.common.exportFailed(error instanceof Error ? error.message : String(error)));
    }
  }

  /**
   * 移除记录、不再确认（图库「移除记录」靠通知里的「撤销」反悔，交接说明第 4 节）
   *
   * 删之前先把完整记录取回来交给调用方：撤销时原样插回（含收藏、检测结果）。
   * 只删本地记录，图床上的图片不动。
   * @returns 真正删掉的那些记录；出错时弹通知并返回空数组
   */
  async function removeRecords(ids: string[]): Promise<HistoryItem[]> {
    if (ids.length === 0) return [];
    try {
      const snapshot = (await ctx.detailCache.getDetails(ids)).filter((d): d is HistoryItem => d !== null);
      const deletedIds = await historyDB.deleteMany(ids);
      ids.forEach(id => ctx.detailCache.removeDetail(id));
      if (deletedIds.length > 0) {
        ctx.totalCount.value = Math.max(0, ctx.totalCount.value - deletedIds.length);
        ctx.removeFavoritesFromIds(deletedIds);
        await ctx.refreshServiceCounts();
        void ctx.refreshTimePeriodStats();
        ctx.dataVersion.value++;
        emitHistoryDeleted(deletedIds).catch(e => {
          log.warn('[历史记录] 跨窗口通知失败:', e);
        });
      }
      const deleted = new Set(deletedIds);
      return snapshot.filter(item => deleted.has(item.id));
    } catch (error) {
      log.error('[批量操作] 移除记录失败:', error);
      toast.error('移除记录失败', `${error instanceof Error ? error.message : String(error)}，请稍后重试`);
      return [];
    }
  }

  /** 撤销「移除记录」：原样插回，再广播 history-updated，计数、收藏与各视图跟着重查 */
  async function restoreRecords(items: HistoryItem[]): Promise<void> {
    if (items.length === 0) return;
    try {
      for (const item of items) await historyDB.insertOrIgnore(item);
      await emitHistoryUpdated(items.map(item => item.id));
    } catch (error) {
      log.error('[批量操作] 恢复记录失败:', error);
      toast.error('恢复记录失败', `${error instanceof Error ? error.message : String(error)}，请稍后重试`);
    }
  }

  return { bulkExportJSON, removeRecords, restoreRecords };
}
