// 批量操作（导出/删除）从 useHistory.ts 抽离，降低主文件体积

import type { Ref } from 'vue';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import type { HistoryItem } from '../../config/types';
import { historyDB } from '../../services/HistoryDatabase';
import type { ImageMeta } from '../../types/image-meta';
import { useToast } from '../useToast';
import { useConfirm } from '../useConfirm';
import { TOAST_MESSAGES } from '../../constants';
import { emitHistoryDeleted } from '../../events/cacheEvents';
import { createLogger } from '../../utils/logger';
import type { useImageDetailCache } from '../useImageDetailCache';

const log = createLogger('History');

export interface BulkOpsContext {
  imageMetas: Ref<ImageMeta[]>;
  totalCount: Ref<number>;
  isDataLoaded: Ref<boolean>;
  dataVersion: Ref<number>;
  detailCache: ReturnType<typeof useImageDetailCache>;
  removeFavoritesFromIds: (ids: string[]) => void;
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
      const details = await Promise.all(
        selectedIds.map(id =>
          ctx.detailCache.getDetail(id).catch(e => {
            log.warn(`[批量操作] 跳过无效记录: ${id}`, e);
            return null;
          }),
        ),
      );
      const selectedItems = details.filter((d): d is HistoryItem => d !== null);
      if (selectedItems.length === 0) {
        toast.showConfig('warn', TOAST_MESSAGES.history.noLoadableData);
        return;
      }
      const jsonContent = JSON.stringify(selectedItems, null, 2);
      const filePath = await saveDialog({
        defaultPath: `picnexus-history-${Date.now()}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!filePath) return;
      await writeTextFile(filePath, jsonContent);
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

      await historyDB.deleteMany(selectedIds);
      toast.showConfig('success', TOAST_MESSAGES.common.deleteSuccess(selectedIds.length));

      if (ctx.isDataLoaded.value) {
        const selectedIdSet = new Set(selectedIds);
        ctx.imageMetas.value = ctx.imageMetas.value.filter(meta => !selectedIdSet.has(meta.id));
      }
      ctx.totalCount.value = Math.max(0, ctx.totalCount.value - selectedIds.length);
      ctx.removeFavoritesFromIds(selectedIds);
      ctx.dataVersion.value++;

      selectedIds.forEach(id => ctx.detailCache.removeDetail(id));
      emitHistoryDeleted(selectedIds).catch(e => {
        log.warn('[历史记录] 跨窗口通知失败:', e);
      });
      return true;
    } catch (error) {
      log.error('[批量操作] 删除失败:', error);
      toast.showConfig('error', TOAST_MESSAGES.common.deleteFailed(error instanceof Error ? error.message : String(error)));
      return false;
    }
  }

  return { bulkExportJSON, bulkDeleteRecords };
}
