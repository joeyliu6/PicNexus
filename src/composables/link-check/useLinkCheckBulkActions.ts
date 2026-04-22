import { ref } from 'vue';
import { emitHistoryUpdated } from '../../events/cacheEvents';
import { historyDB } from '../../services/HistoryDatabase';
import type { LinkCheckRow } from '../../types/linkCheck';
import { useConfirm } from '../useConfirm';
import { useToast } from '../useToast';

const ROW_FADE_MS = 380;
const COPY_LIMIT = 1000;

interface UseLinkCheckBulkActionsOptions {
  recheckRows: (ids: string[]) => Promise<void>;
  deleteRows: (ids: string[]) => Promise<boolean>;
  setFadingOut: (ids: string[], value: boolean) => void;
  applySkipState: (ids: string[], skip: boolean) => void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueHistoryIds(rows: LinkCheckRow[]): string[] {
  return [...new Set(rows.map((row) => row.historyId))];
}

function uniqueUrls(rows: LinkCheckRow[]): string[] {
  return [...new Set(rows.map((row) => row.url).filter(Boolean))];
}

export function useLinkCheckBulkActions(options: UseLinkCheckBulkActionsOptions) {
  const { confirm } = useConfirm();
  const toast = useToast();
  const isBulkActing = ref(false);

  async function bulkRecheck(rows: LinkCheckRow[]): Promise<void> {
    const ids = uniqueHistoryIds(rows);
    if (ids.length === 0) return;

    isBulkActing.value = true;
    try {
      await options.recheckRows(ids);
    } finally {
      isBulkActing.value = false;
    }
  }

  async function bulkMarkSkip(rows: LinkCheckRow[]): Promise<void> {
    const ids = uniqueHistoryIds(rows);
    if (ids.length === 0) return;

    const confirmed = await confirm(
      `当前筛选结果中的 ${rows.length} 条链接将不再参与后续监控。\n\n记录会保留，你可以在“已跳过”标签中逐条恢复。`,
      {
        header: '标记为“不再检测”',
        acceptLabel: `确认标记 ${rows.length} 条`,
        acceptClass: 'p-button-warning',
      },
    );
    if (!confirmed) return;

    isBulkActing.value = true;
    try {
      await historyDB.setLinkCheckSkip(ids, true);
      options.setFadingOut(ids, true);
      await delay(ROW_FADE_MS);
      options.applySkipState(ids, true);
      options.setFadingOut(ids, false);
      await emitHistoryUpdated(ids);
      toast.success('已标记为不再检测', `${rows.length} 条链接已移入“已跳过”`);
    } catch (error) {
      options.setFadingOut(ids, false);
      toast.error('标记失败', error instanceof Error ? error.message : String(error));
    } finally {
      isBulkActing.value = false;
    }
  }

  async function restoreSkipped(rows: LinkCheckRow[]): Promise<void> {
    const ids = uniqueHistoryIds(rows);
    if (ids.length === 0) return;

    isBulkActing.value = true;
    try {
      await historyDB.setLinkCheckSkip(ids, false);
      options.setFadingOut(ids, true);
      await delay(ROW_FADE_MS);
      options.applySkipState(ids, false);
      options.setFadingOut(ids, false);
      await emitHistoryUpdated(ids);
      toast.success('已恢复检测', `${rows.length} 条链接会重新参与后续监控`);
    } catch (error) {
      options.setFadingOut(ids, false);
      toast.error('恢复失败', error instanceof Error ? error.message : String(error));
    } finally {
      isBulkActing.value = false;
    }
  }

  async function bulkCopyUrls(rows: LinkCheckRow[]): Promise<void> {
    const urls = uniqueUrls(rows);
    if (urls.length === 0) {
      toast.warn('没有可复制的链接');
      return;
    }

    const copiedUrls = urls.slice(0, COPY_LIMIT);

    try {
      await navigator.clipboard.writeText(copiedUrls.join('\n'));
      if (copiedUrls.length < urls.length) {
        toast.warn('复制数量已截断', `为避免剪贴板过大，仅复制前 ${COPY_LIMIT} 条链接`);
      } else {
        toast.success('已复制链接', `${copiedUrls.length} 条链接已写入剪贴板`);
      }
    } catch (error) {
      toast.error('复制失败', error instanceof Error ? error.message : String(error));
    }
  }

  async function bulkDelete(rows: LinkCheckRow[]): Promise<void> {
    const ids = uniqueHistoryIds(rows);
    if (ids.length === 0) return;

    isBulkActing.value = true;
    try {
      await options.deleteRows(ids);
    } finally {
      isBulkActing.value = false;
    }
  }

  return {
    isBulkActing,
    bulkRecheck,
    bulkMarkSkip,
    restoreSkipped,
    bulkCopyUrls,
    bulkDelete,
  };
}
