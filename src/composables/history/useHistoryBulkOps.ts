// 批量操作（导出/删除）从 useHistory.ts 抽离，降低主文件体积

import type { Ref } from 'vue';
import type { HistoryItem } from '@/config/types';
import { historyDB } from '@/services/HistoryDatabase';
import { useToast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';
import { TOAST_MESSAGES } from '@/constants';
import { emitHistoryDeleted } from '@/events/cacheEvents';
import { createLogger } from '@/utils/logger';
import { exportTextFile } from '@/utils/userFiles';
import type { useImageDetailCache } from '@/composables/useImageDetailCache';

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
  const { confirm } = useConfirm();

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

  async function bulkDeleteRecords(selectedIds: string[]): Promise<boolean> {
    try {
      if (selectedIds.length === 0) {
        toast.showConfig('warn', TOAST_MESSAGES.common.noSelection);
        return false;
      }
      const confirmed = await confirm(
        `确定要删除选中的 ${selectedIds.length} 条历史记录吗？此操作不可撤销。`,
        { header: '批量删除确认', acceptLabel: '删除', acceptClass: 'p-button-danger' },
      );
      if (!confirmed) return false;

      const deletedIds = await historyDB.deleteMany(selectedIds);

      // 详情缓存对所有选中目标清理：陈旧目标的记录同样已不在库里
      selectedIds.forEach(id => ctx.detailCache.removeDetail(id));

      // 陈旧目标（已被别处删除）不计数、不弹 toast、不广播——真正删它的那次操作
      // 已经做过这些，重播会让其他窗口重复扣减（与 bulkDeleteHistoryResults 口径一致）
      if (deletedIds.length < selectedIds.length) {
        log.warn(`[批量操作] ${selectedIds.length - deletedIds.length} 条目标已不存在，仅移除视图行`);
      }
      if (deletedIds.length > 0) {
        toast.showConfig('success', TOAST_MESSAGES.common.deleteSuccess(deletedIds.length));

        ctx.totalCount.value = Math.max(0, ctx.totalCount.value - deletedIds.length);
        ctx.removeFavoritesFromIds(deletedIds);
        await ctx.refreshServiceCounts();
        void ctx.refreshTimePeriodStats();
        ctx.dataVersion.value++;

        emitHistoryDeleted(deletedIds).catch(e => {
          log.warn('[历史记录] 跨窗口通知失败:', e);
        });
      }
      return true;
    } catch (error) {
      log.error('[批量操作] 删除失败:', error);
      toast.showConfig('error', TOAST_MESSAGES.common.deleteFailed(error instanceof Error ? error.message : String(error)));
      return false;
    }
  }

  return { bulkExportJSON, bulkDeleteRecords };
}
