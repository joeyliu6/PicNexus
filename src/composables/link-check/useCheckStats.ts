/**
 * useCheckStats — 链接监控面板的统计计算
 * 从 HistoryCheckPanel.vue 提取
 */
import { computed, type Ref, type ComputedRef } from 'vue';
import type { LinkCheckRow, BatchCheckProgress } from '../../types/linkCheck';

export interface CheckStatsResult {
  total: number;
  valid: number;
  invalid: number;
  timeout: number;
  suspicious: number;
  unchecked: number;
  checked: number;
  problems: number;
}

interface UseCheckStatsOptions {
  scopedRows: ComputedRef<LinkCheckRow[]>;
  checkRows: Ref<LinkCheckRow[]>;
  progress: Ref<BatchCheckProgress | null>;
}

export function useCheckStats({ scopedRows, checkRows, progress }: UseCheckStatsOptions) {
  const stats = computed<CheckStatsResult>(() => {
    const rows = scopedRows.value;
    let valid = 0, invalid = 0, timeout = 0, suspicious = 0, unchecked = 0;
    for (const r of rows) {
      const cr = r.checkResult;
      if (!cr) { unchecked++; continue; }
      if (cr.is_valid) { valid++; continue; }
      if (cr.error_type === 'timeout') { timeout++; }
      else if (cr.error_type === 'suspicious' || cr.browser_might_work) { suspicious++; }
      else { invalid++; }
    }
    const checked = rows.length - unchecked;
    return { total: rows.length, valid, invalid, timeout, suspicious, unchecked, checked, problems: invalid + timeout + suspicious };
  });

  const serviceList = computed(() => {
    const map = new Map<string, number>();
    for (const row of checkRows.value) {
      map.set(row.serviceId, (map.get(row.serviceId) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count);
  });

  const progressPercent = computed(() => {
    const p = progress.value;
    if (!p || p.total === 0) return 0;
    return Math.min(100, Math.round((p.checked / p.total) * 100));
  });

  const progressTooltip = computed(() => {
    const p = progress.value;
    if (p && p.total > 0) {
      return `本次已检测 ${p.checked.toLocaleString()} / ${p.total.toLocaleString()} 条`;
    }
    return '准备检测...';
  });

  return { stats, serviceList, progressPercent, progressTooltip };
}
