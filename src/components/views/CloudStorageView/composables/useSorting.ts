import { ref, computed, type Ref } from 'vue';
import type { StorageObject, SortField, SortDirection } from '../types';

export function useSorting(objects: Ref<StorageObject[]>) {
  const sortField = ref<SortField>('name');
  const sortDirection = ref<SortDirection>('asc');

  const sortedObjects = computed(() => {
    const sorted = [...objects.value];

    sorted.sort((a, b) => {
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;

      const field = sortField.value;
      let aVal: string | number | Date;
      let bVal: string | number | Date;

      if (field === 'name') {
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
      } else if (field === 'size') {
        aVal = a.size;
        bVal = b.size;
      } else {
        aVal = a.lastModified;
        bVal = b.lastModified;
      }

      let comparison = 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        comparison = aVal.localeCompare(bVal);
      } else if (aVal instanceof Date && bVal instanceof Date) {
        comparison = aVal.getTime() - bVal.getTime();
      } else {
        comparison = (aVal as number) - (bVal as number);
      }

      return sortDirection.value === 'asc' ? comparison : -comparison;
    });

    return sorted;
  });

  const toggleSort = (field: SortField) => {
    if (sortField.value === field) {
      sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc';
    } else {
      sortField.value = field;
      sortDirection.value = 'asc';
    }
  };

  return {
    sortField,
    sortDirection,
    sortedObjects,
    toggleSort,
  };
}
