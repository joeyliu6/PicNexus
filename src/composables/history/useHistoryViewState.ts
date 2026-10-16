// 图库的多选状态：Ctrl·⌘ 单击 / 选择框切换一张，Shift 连选一段（按页面上的顺序）。
// 选中后的批量操作（复制、补充备份、移除记录……）在 views/gallery/useGalleryActions.ts。
import { ref, shallowRef, computed } from 'vue';
import { shiftSelect, type ShiftSelectAnchor } from '@/utils/shiftSelect';

export function useHistoryViewState() {
  const selectedIds = shallowRef(new Set<string>());
  const selectAnchor = ref<ShiftSelectAnchor>({ lastId: null, wasSelect: true });

  const hasSelection = computed(() => selectedIds.value.size > 0);
  const selectedIdList = computed(() => Array.from(selectedIds.value));

  function handleSelectClick(id: string, event: MouseEvent, orderedIds: string[]): void {
    const result = shiftSelect(id, event.shiftKey, orderedIds, selectedIds.value, selectAnchor.value);
    selectedIds.value = result.nextSet;
    selectAnchor.value = result.anchor;
  }

  function select(id: string): void {
    if (selectedIds.value.has(id)) return;
    selectedIds.value = new Set(selectedIds.value).add(id);
  }

  function clearSelection(): void {
    selectedIds.value = new Set();
    selectAnchor.value = { lastId: null, wasSelect: true };
  }

  return {
    hasSelection, selectedIdList,
    handleSelectClick, select, clearSelection,
  };
}
