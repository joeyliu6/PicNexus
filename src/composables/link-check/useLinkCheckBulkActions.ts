import { ref } from 'vue';
import type { LinkCheckRow } from '../../types/linkCheck';
import { useToast } from '../useToast';

const COPY_LIMIT = 1000;

interface UseLinkCheckBulkActionsOptions {
  recheckRows: (ids: string[]) => Promise<void>;
  deleteRows: (rows: LinkCheckRow[]) => Promise<boolean>;
}

function uniqueHistoryIds(rows: LinkCheckRow[]): string[] {
  return [...new Set(rows.map((row) => row.historyId))];
}

function uniqueUrls(rows: LinkCheckRow[]): string[] {
  return [...new Set(rows.map((row) => row.url).filter(Boolean))];
}

export function useLinkCheckBulkActions(options: UseLinkCheckBulkActionsOptions) {
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
    if (rows.length === 0) return;

    isBulkActing.value = true;
    try {
      await options.deleteRows(rows);
    } finally {
      isBulkActing.value = false;
    }
  }

  return {
    isBulkActing,
    bulkRecheck,
    bulkCopyUrls,
    bulkDelete,
  };
}
