import { computed, type ComputedRef, type Ref } from 'vue';
import type { BatchCheckProgress, LinkCheckRow, StatusFilter } from '../../types/linkCheck';

export interface CheckStatsResult {
  total: number;
  valid: number;
  invalid: number;
  timeout: number;
  suspicious: number;
  unchecked: number;
  checked: number;
  problems: number;
  skipped: number;
}

interface UseCheckStatsOptions {
  scopedRows: ComputedRef<LinkCheckRow[]>;
  checkRows: Ref<LinkCheckRow[]>;
  progress: Ref<BatchCheckProgress | null>;
  statusFilter?: Ref<StatusFilter>;
}

export function useCheckStats({ scopedRows, checkRows, progress, statusFilter }: UseCheckStatsOptions) {
  const stats = computed<CheckStatsResult>(() => {
    const activeRows = scopedRows.value.filter((row) => !row.linkCheckSkip);
    const skipped = scopedRows.value.length - activeRows.length;
    let valid = 0;
    let invalid = 0;
    let timeout = 0;
    let suspicious = 0;
    let unchecked = 0;

    for (const row of activeRows) {
      const result = row.checkResult;
      if (!result) {
        unchecked++;
        continue;
      }
      if (result.is_valid) {
        valid++;
        continue;
      }
      if (result.error_type === 'timeout') {
        timeout++;
      } else if (result.error_type === 'suspicious' || result.browser_might_work) {
        suspicious++;
      } else {
        invalid++;
      }
    }

    const checked = activeRows.length - unchecked;
    return {
      total: activeRows.length,
      valid,
      invalid,
      timeout,
      suspicious,
      unchecked,
      checked,
      problems: invalid + timeout + suspicious,
      skipped,
    };
  });

  const serviceList = computed(() => {
    const currentFilter = statusFilter?.value ?? null;
    const sourceRows = checkRows.value.filter((row) =>
      currentFilter === 'skipped' ? row.linkCheckSkip : !row.linkCheckSkip,
    );
    const map = new Map<string, number>();

    for (const row of sourceRows) {
      map.set(row.serviceId, (map.get(row.serviceId) || 0) + 1);
    }

    return Array.from(map.entries())
      .map(([id, count]) => ({ id, count }))
      .sort((left, right) => right.count - left.count);
  });

  const progressPercent = computed(() => {
    const current = progress.value;
    if (!current || current.total === 0) return 0;
    return Math.min(100, Math.round((current.checked / current.total) * 100));
  });

  const progressTooltip = computed(() => {
    const current = progress.value;
    if (current && current.total > 0) {
      return `本次已检测 ${current.checked.toLocaleString()} / ${current.total.toLocaleString()} 条`;
    }
    return '准备检测...';
  });

  return { stats, serviceList, progressPercent, progressTooltip };
}
