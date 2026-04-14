import { ref, shallowRef, computed, triggerRef } from 'vue';
import type { ServiceType } from '../config/types';
import { useHistoryManager } from './useHistory';
import { useToast } from './useToast';
import { useCopyLink, type CopyLinkItem } from './useCopyLink';
export type { LinkFormat } from '../utils/linkFormatter';

export function useHistoryViewState() {
  const historyManager = useHistoryManager();
  const toast = useToast();
  const { copyLinks } = useCopyLink();

  const selectedIds = shallowRef(new Set<string>());
  const currentFilter = ref<ServiceType | 'all'>('all');
  const searchTerm = ref('');

  function updateSelection(fn: (set: Set<string>) => void): void {
    const newSet = new Set(selectedIds.value);
    fn(newSet);
    selectedIds.value = newSet;
    triggerRef(selectedIds);
  }

  const filteredMetas = computed(() => {
    let metas = historyManager.imageMetas.value;

    if (currentFilter.value !== 'all') {
      metas = metas.filter(meta => meta.primaryService === currentFilter.value);
    }

    if (searchTerm.value.trim()) {
      const term = searchTerm.value.toLowerCase().trim();
      metas = metas.filter(meta =>
        meta.localFileName.toLowerCase().includes(term)
      );
    }

    return metas;
  });

  const isAllSelected = computed(() => {
    const metas = filteredMetas.value;
    return metas.length > 0 && metas.every(meta => selectedIds.value.has(meta.id));
  });

  const isSomeSelected = computed(() => {
    const metas = filteredMetas.value;
    if (metas.length === 0) return false;
    const count = metas.filter(meta => selectedIds.value.has(meta.id)).length;
    return count > 0 && count < metas.length;
  });

  const hasSelection = computed(() => selectedIds.value.size > 0);
  const selectedIdList = computed(() => Array.from(selectedIds.value));

  function toggleSelection(id: string): void {
    updateSelection(set => set.has(id) ? set.delete(id) : set.add(id));
  }

  function select(id: string): void {
    if (!selectedIds.value.has(id)) updateSelection(set => set.add(id));
  }

  function deselect(id: string): void {
    if (selectedIds.value.has(id)) updateSelection(set => set.delete(id));
  }

  function toggleSelectAll(checked: boolean): void {
    selectedIds.value = checked
      ? new Set(filteredMetas.value.map(m => m.id))
      : new Set();
    triggerRef(selectedIds);
  }

  function clearSelection(): void {
    selectedIds.value = new Set();
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
    if (ids.length === 0) {
      toast.warn('未选择项目', '请先选择要复制的项目');
      return;
    }

    const idSet = new Set(ids);
    const metas = historyManager.imageMetas.value.filter(meta => idSet.has(meta.id));

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

      await copyLinks(items, { format });

      // 有项目被跳过时给出提示，避免用户误以为全部复制成功
      const skippedCount = ids.length - items.length;
      if (skippedCount > 0) {
        toast.warn(`已跳过 ${skippedCount} 张`, `这 ${skippedCount} 张图片无该图床链接`);
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

      await copyLinks(items, { format });
    }
  }

  async function bulkExport(): Promise<void> {
    await historyManager.bulkExportJSON(selectedIdList.value);
  }

  async function bulkDelete(): Promise<void> {
    const ids = selectedIdList.value;
    if (ids.length === 0) {
      toast.warn('未选择项目', '请先选择要删除的项目');
      return;
    }

    await historyManager.bulkDeleteRecords(ids);
    clearSelection();
  }

  function reset(): void {
    selectedIds.value = new Set();
    currentFilter.value = 'all';
    searchTerm.value = '';
  }

  return {
    selectedIds, currentFilter, searchTerm, filteredMetas,
    isAllSelected, isSomeSelected, hasSelection, selectedIdList,
    toggleSelection, select, deselect, toggleSelectAll, clearSelection, isSelected,
    setFilter, setSearchTerm,
    bulkCopyFormatted, bulkExport, bulkDelete, reset,
    loadHistory: historyManager.loadHistory,
    loadPageByNumber: historyManager.loadPageByNumber,
    searchHistory: historyManager.searchHistory,
    deleteHistoryItem: historyManager.deleteHistoryItem,
    imageMetas: historyManager.imageMetas,
    isLoading: historyManager.isLoading,
    totalCount: historyManager.totalCount,
    detailCache: historyManager.detailCache,
  };
}
