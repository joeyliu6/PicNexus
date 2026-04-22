import { ref, shallowRef, watch } from 'vue';
import type { ComputedRef } from 'vue';
import { watchDebounced } from '@vueuse/core';
import { getServiceDisplayName } from '../../../../../constants/serviceNames';
import type { MigrateRowItem } from '../components/MigrateItemRow.vue';

export interface SourceServiceOption {
  serviceId: string;
  label: string;
  count: number;
}

export function useFilterBar(rawList: ComputedRef<MigrateRowItem[]>) {
  const searchInput = ref('');
  const searchQuery = ref('');
  const selectedSourceServiceId = ref<string | null>(null);
  const showServiceMenu = ref(false);

  watchDebounced(searchInput, v => {
    searchQuery.value = v.trim().toLowerCase();
  }, { debounce: 200 });

  // 仅在菜单打开时重算，避免 migrating 阶段随列表每帧更新触发 O(N·S) 遍历
  const sourceServiceOptions = shallowRef<SourceServiceOption[]>([]);

  function buildServiceOptions(items: MigrateRowItem[]): SourceServiceOption[] {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const sid of item.existingServiceIds ?? []) {
        counts.set(sid, (counts.get(sid) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([serviceId, count]) => ({
        serviceId,
        label: getServiceDisplayName(serviceId) || serviceId,
        count,
      }));
  }

  // 菜单展开时同步最新数据
  watch(showServiceMenu, (open) => {
    if (open) sourceServiceOptions.value = buildServiceOptions(rawList.value);
  });

  // rawList 首次填充时初始化（保证过滤芯片可见性正确），之后由菜单展开触发
  watch(rawList, (items) => {
    if (sourceServiceOptions.value.length === 0 && items.length > 0) {
      sourceServiceOptions.value = buildServiceOptions(items);
    }
  }, { immediate: true });

  function applyFilters(items: MigrateRowItem[]): MigrateRowItem[] {
    if (selectedSourceServiceId.value) {
      const sid = selectedSourceServiceId.value;
      items = items.filter(s => s.existingServiceIds?.includes(sid));
    }
    if (searchQuery.value) {
      const q = searchQuery.value;
      items = items.filter(s => s.fileName.toLowerCase().includes(q));
    }
    return items;
  }

  function resetFilters() {
    searchInput.value = '';
    searchQuery.value = '';
    selectedSourceServiceId.value = null;
    showServiceMenu.value = false;
  }

  return {
    searchInput,
    searchQuery,
    selectedSourceServiceId,
    showServiceMenu,
    sourceServiceOptions,
    applyFilters,
    resetFilters,
  };
}
