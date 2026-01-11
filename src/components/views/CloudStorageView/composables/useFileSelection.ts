// src/components/views/CloudStorageView/composables/useFileSelection.ts
// 文件选择逻辑

import { ref, computed, type Ref } from 'vue';
import type { StorageObject } from '../types';

export interface FileSelectionOptions {
  /** 对象列表引用 */
  objects: Ref<StorageObject[]>;
}

export interface FileSelectionReturn {
  /** 选中的对象列表 */
  selectedItems: Ref<StorageObject[]>;
  /** 选中的 key 集合 */
  selectedKeys: Ref<Set<string>>;
  /** 是否全选 */
  isAllSelected: Ref<boolean>;
  /** 是否部分选中 */
  isIndeterminate: Ref<boolean>;
  /** 切换选中状态 */
  toggleSelect: (item: StorageObject, event?: MouseEvent) => void;
  /** 全选/取消全选 */
  toggleSelectAll: () => void;
  /** 清空选择 */
  clearSelection: () => void;
  /** 选中指定项 */
  selectItems: (items: StorageObject[]) => void;
  /** 检查是否选中 */
  isSelected: (item: StorageObject) => boolean;
}

export function useFileSelection(options: FileSelectionOptions): FileSelectionReturn {
  const { objects } = options;

  // 选中项的 key 集合
  const selectedKeys = ref<Set<string>>(new Set());

  // 最后选中的索引（用于 Shift 选择）
  let lastSelectedIndex = -1;

  // 选中的对象列表
  const selectedItems = computed(() =>
    objects.value.filter((obj) => selectedKeys.value.has(obj.key))
  );

  // 是否全选
  const isAllSelected = computed(() =>
    objects.value.length > 0 && objects.value.every((obj) => selectedKeys.value.has(obj.key))
  );

  // 是否部分选中
  const isIndeterminate = computed(
    () => selectedKeys.value.size > 0 && !isAllSelected.value
  );

  // 切换选中状态
  function toggleSelect(item: StorageObject, event?: MouseEvent) {
    const index = objects.value.findIndex((obj) => obj.key === item.key);

    if (event?.shiftKey && lastSelectedIndex >= 0) {
      // Shift + 点击：范围选择
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);

      for (let i = start; i <= end; i++) {
        selectedKeys.value.add(objects.value[i].key);
      }
      // 触发响应式更新
      selectedKeys.value = new Set(selectedKeys.value);
    } else if (event?.ctrlKey || event?.metaKey) {
      // Ctrl/Cmd + 点击：多选
      if (selectedKeys.value.has(item.key)) {
        selectedKeys.value.delete(item.key);
      } else {
        selectedKeys.value.add(item.key);
      }
      selectedKeys.value = new Set(selectedKeys.value);
    } else {
      // 普通点击：单选/取消
      if (selectedKeys.value.has(item.key) && selectedKeys.value.size === 1) {
        selectedKeys.value.clear();
      } else {
        selectedKeys.value.clear();
        selectedKeys.value.add(item.key);
      }
      selectedKeys.value = new Set(selectedKeys.value);
    }

    lastSelectedIndex = index;
  }

  // 全选/取消全选
  function toggleSelectAll() {
    if (isAllSelected.value) {
      selectedKeys.value = new Set();
    } else {
      selectedKeys.value = new Set(objects.value.map((obj) => obj.key));
    }
  }

  // 清空选择
  function clearSelection() {
    selectedKeys.value = new Set();
    lastSelectedIndex = -1;
  }

  // 选中指定项
  function selectItems(items: StorageObject[]) {
    items.forEach((item) => selectedKeys.value.add(item.key));
    selectedKeys.value = new Set(selectedKeys.value);
  }

  // 检查是否选中
  function isSelected(item: StorageObject): boolean {
    return selectedKeys.value.has(item.key);
  }

  return {
    selectedItems,
    selectedKeys,
    isAllSelected,
    isIndeterminate,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    selectItems,
    isSelected,
  };
}
