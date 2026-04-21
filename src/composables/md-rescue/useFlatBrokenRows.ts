// 失效链接行列表的展平、筛选、分组逻辑
// 抽离自 RescueBrokenGroups.vue，让组件主文件保持在 500 行硬门禁内

import { ref, computed, type Ref } from 'vue';
import type { MdImageLinkWithFile } from '../useMdRescue';

export interface FlatRow {
  link: MdImageLinkWithFile;
  firstOfFile: boolean;
  status: 'rescuable' | 'manual' | 'replaced';
}

export interface GroupedFile {
  filePath: string;
  fileName: string;
  directory: string;
  rows: FlatRow[];
}

const ROW_DISPLAY_LIMIT = 200;
const ROW_DISPLAY_STEP = 200;

function getFileDirectory(fullPath: string): string {
  const parts = fullPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length < 2 ? '' : parts[parts.length - 2];
}

export function useFlatBrokenRows(
  imageLinks: Ref<MdImageLinkWithFile[]>,
  isRepaired: Ref<boolean>,
) {
  const activeFilter = ref<'all' | 'rescuable' | 'manual'>('all');
  const displayRowLimit = ref(ROW_DISPLAY_LIMIT);

  const flatBrokenData = computed(() => {
    const rows: FlatRow[] = [];
    let manual = 0, rescuable = 0;
    for (const l of imageLinks.value) {
      if (!l.checkResult || l.checkResult.is_valid) continue;
      const hasValidBackup = l.backupLinks?.some((b) => b.checkResult?.is_valid) ?? false;
      let status: FlatRow['status'];
      if (isRepaired.value && l.selectedBackup) status = 'replaced';
      else if (hasValidBackup) status = 'rescuable';
      else status = 'manual';
      if (status === 'manual') manual++;
      else rescuable++;
      rows.push({ link: l, firstOfFile: false, status });
    }
    return { rows, counts: { all: rows.length, rescuable, manual } };
  });

  const flatBrokenLinks = computed(() => flatBrokenData.value.rows);
  const filterCounts = computed(() => flatBrokenData.value.counts);

  const filteredRows = computed<FlatRow[]>(() => {
    const all = flatBrokenLinks.value;
    const filter = activeFilter.value;
    const result: FlatRow[] = [];
    let prevFile = '';
    for (let i = 0; i < all.length; i++) {
      const r = all[i];
      if (filter === 'rescuable' && r.status === 'manual') continue;
      if (filter === 'manual' && r.status !== 'manual') continue;
      result.push({
        link: r.link,
        status: r.status,
        firstOfFile: r.link.sourceFile !== prevFile,
      });
      prevFile = r.link.sourceFile;
    }
    return result;
  });

  const rescuableChipLabel = computed(() => (isRepaired.value ? '已修复' : '可修复'));

  const groupedRows = computed<GroupedFile[]>(() => {
    const map = new Map<string, GroupedFile>();
    for (const r of filteredRows.value) {
      const key = r.link.sourceFile;
      let entry = map.get(key);
      if (!entry) {
        entry = {
          filePath: key,
          fileName: r.link.sourceFileName,
          directory: getFileDirectory(key),
          rows: [],
        };
        map.set(key, entry);
      }
      entry.rows.push(r);
    }
    return Array.from(map.values());
  });

  const totalFilteredRowCount = computed(() => filteredRows.value.length);

  const visibleGroupedRows = computed<GroupedFile[]>(() => {
    const limit = displayRowLimit.value;
    const all = groupedRows.value;
    if (totalFilteredRowCount.value <= limit) return all;
    const result: GroupedFile[] = [];
    let count = 0;
    for (const group of all) {
      if (count >= limit) break;
      const remaining = limit - count;
      if (group.rows.length <= remaining) {
        result.push(group);
        count += group.rows.length;
      } else {
        result.push({ ...group, rows: group.rows.slice(0, remaining) });
        count += remaining;
      }
    }
    return result;
  });

  const collapsedGroups = ref<Set<string>>(new Set());

  function toggleGroupCollapse(filePath: string): void {
    const next = new Set(collapsedGroups.value);
    if (next.has(filePath)) next.delete(filePath);
    else next.add(filePath);
    collapsedGroups.value = next;
  }

  function selectFilter(f: 'all' | 'rescuable' | 'manual'): void {
    if (activeFilter.value === f) return;
    activeFilter.value = f;
    displayRowLimit.value = ROW_DISPLAY_LIMIT;
  }

  function loadMoreRows(): void {
    displayRowLimit.value += ROW_DISPLAY_STEP;
  }

  return {
    activeFilter,
    displayRowLimit,
    flatBrokenLinks,
    filterCounts,
    filteredRows,
    rescuableChipLabel,
    groupedRows,
    visibleGroupedRows,
    totalFilteredRowCount,
    collapsedGroups,
    toggleGroupCollapse,
    selectFilter,
    loadMoreRows,
  };
}
