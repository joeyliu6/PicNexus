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

  /** 一次选中这些（已选的保留）：Ctrl·⌘ A 全选当前结果 */
  function selectMany(ids: readonly string[]): void {
    const next = new Set(selectedIds.value);
    for (const id of ids) next.add(id);
    selectedIds.value = next;
  }

  function clearSelection(): void {
    selectedIds.value = new Set();
    selectAnchor.value = { lastId: null, wasSelect: true };
  }

  return {
    hasSelection, selectedIdList,
    handleSelectClick, selectMany, clearSelection,
  };
}
