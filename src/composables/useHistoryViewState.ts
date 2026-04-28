import { ref, shallowRef, computed, triggerRef } from 'vue';
import type { ServiceType } from '../config/types';
import { useHistoryManager } from './useHistory';
import { useToast } from './useToast';
import { useCopyLink, type CopyLinkItem } from './useCopyLink';
import { shiftSelect, type ShiftSelectAnchor } from '../utils/shiftSelect';
import { historyDB } from '../services/HistoryDatabase';
export type { LinkFormat } from '../utils/linkFormatter';

export function useHistoryViewState() {
  const historyManager = useHistoryManager();
  const toast = useToast();
  const { copyLinks } = useCopyLink();

  const selectedIds = shallowRef(new Set<string>());
  const selectAnchor = ref<ShiftSelectAnchor>({ lastId: null, wasSelect: true });
  const currentFilter = ref<ServiceType | 'all'>('all');
  const searchTerm = ref('');

  function updateSelection(fn: (set: Set<string>) => void): void {
    const newSet = new Set(selectedIds.value);
    fn(newSet);
    selectedIds.value = newSet;
    triggerRef(selectedIds);
  }

  const hasSelection = computed(() => selectedIds.value.size > 0);
  const selectedIdList = computed(() => Array.from(selectedIds.value));

  function toggleSelection(id: string): void {
    updateSelection(set => set.has(id) ? set.delete(id) : set.add(id));
  }

  function handleSelectClick(id: string, event: MouseEvent, orderedIds: string[]): void {
    const result = shiftSelect(id, event.shiftKey, orderedIds, selectedIds.value, selectAnchor.value);
    selectedIds.value = result.nextSet;
    selectAnchor.value = result.anchor;
    triggerRef(selectedIds);
  }

  function select(id: string): void {
    if (!selectedIds.value.has(id)) updateSelection(set => set.add(id));
  }

  function deselect(id: string): void {
    if (selectedIds.value.has(id)) updateSelection(set => set.delete(id));
  }

  function clearSelection(): void {
    selectedIds.value = new Set();
    selectAnchor.value = { lastId: null, wasSelect: true };
    triggerRef(selectedIds);
  }

  function isSelected(id: string): boolean {
    return selectedIds.value.has(id);
  }

  function setFilter(filter: ServiceType | 'all'): void {
    currentFilter.value = filter;
    clearSelection();
  }

  function setSearchTerm(term: string): void {
    searchTerm.value = term;
    clearSelection();
  }

  async function bulkCopyFormatted(format?: import('../utils/linkFormatter').LinkFormat, serviceId?: string): Promise<void> {
    const ids = selectedIdList.value;
    if (ids.length === 0) return;

    const metas = await historyDB.getMetasByIds(ids);

    let items: CopyLinkItem[];

    if (serviceId) {
      const details = await Promise.all(
        metas.map(meta => historyManager.detailCache.getDetail(meta.id).catch(() => null))
      );
      items = [];
      for (const detail of details) {
        if (!detail) continue;
        const result = detail.results?.find(
          r => r.serviceId === serviceId && r.status === 'success'
        );
        if (!result?.result?.url) continue;
        items.push({
          url: result.result.url,
          fileName: detail.localFileName,
          serviceId,
        });
      }

      if (items.length === 0) {
        toast.warn('无可用链接', `所选 ${ids.length} 张图片均无该图床链接`);
        return;
      }

      const copyResult = await copyLinks(items, { format, showSuccessToast: false });
      if (!copyResult.ok) return;

      // 成功+跳过合并为一条 toast，避免两条弹窗
      const skippedCount = ids.length - items.length;
      if (skippedCount > 0) {
        toast.warn(
          `已复制 ${items.length} 张（跳过 ${skippedCount} 张）`,
          `${skippedCount} 张图片无该图床链接`
        );
      } else {
        toast.success(`已复制 ${items.length} 张`, '链接已复制到剪贴板');
      }
    } else {
      items = metas
        .filter(meta => !!meta.primaryUrl)
        .map(meta => ({
          url: meta.primaryUrl,
          fileName: meta.localFileName,
          serviceId: meta.primaryService,
        }));

      if (items.length === 0) {
        toast.warn('无可用链接', '选中的项目没有可用链接');
        return;
      }

      const copyResult = await copyLinks(items, { format, showSuccessToast: false });
      if (!copyResult.ok) return;

      // 成功+跳过合并为一条 toast（部分图片无 primaryUrl 时会被跳过）
      const skippedCount = metas.length - items.length;
      if (skippedCount > 0) {
        toast.warn(
          `已复制 ${items.length} 张（跳过 ${skippedCount} 张）`,
          `${skippedCount} 张图片无可用链接`
        );
      } else {
        toast.success(`已复制 ${items.length} 张`, '链接已复制到剪贴板');
      }
    }
  }

  async function bulkExport(): Promise<void> {
    await historyManager.bulkExportJSON(selectedIdList.value);
  }

  async function bulkDelete(): Promise<void> {
    const ids = selectedIdList.value;
    if (ids.length === 0) return;

    const deleted = await historyManager.bulkDeleteRecords(ids);
    if (deleted) clearSelection();
  }

  function reset(): void {
    selectedIds.value = new Set();
    selectAnchor.value = { lastId: null, wasSelect: true };
    currentFilter.value = 'all';
    searchTerm.value = '';
  }

  return {
    selectedIds, currentFilter, searchTerm,
    hasSelection, selectedIdList,
    toggleSelection, handleSelectClick, select, deselect, clearSelection, isSelected,
    setFilter, setSearchTerm,
    bulkCopyFormatted, bulkExport, bulkDelete, reset,
    deleteHistoryItem: historyManager.deleteHistoryItem,
    totalCount: historyManager.totalCount,
    detailCache: historyManager.detailCache,
  };
}
