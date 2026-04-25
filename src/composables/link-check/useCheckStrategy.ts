import { computed, type ComputedRef, type Ref } from 'vue';
import type { CheckLinkResult, LinkCheckRow, StatusFilter } from '../../types/linkCheck';
import { statusTooltip as baseStatusTooltip } from '../useLinkStatusDisplay';
import type { CheckStatsResult } from './useCheckStats';

const CONTEXT_AWARE_FILTERS = new Set<StatusFilter>(['invalid', 'suspicious', 'timeout', 'unchecked']);

export type MoreMenuKind = 'export' | 'recheck' | 'copy' | 'delete';

export interface MoreMenuItem {
  kind: MoreMenuKind;
  label: string;
  icon: string;
  danger?: boolean;
}

const FILTER_LABEL: Record<string, string> = {
  invalid: '重检失效链接',
  suspicious: '重检可疑链接',
  timeout: '重检超时链接',
  unchecked: '检测未检测',
};

const FILTER_TOOLTIP: Record<string, string> = {
  invalid: '重新检测当前筛选的失效链接',
  suspicious: '重新检测当前筛选的可疑链接',
  timeout: '重新检测当前筛选的超时链接',
  unchecked: '检测尚未验证的链接',
};

interface UseCheckStrategyOptions {
  stats: ComputedRef<CheckStatsResult>;
  statusFilter: Ref<StatusFilter>;
}

export function useCheckStrategy({ stats, statusFilter }: UseCheckStrategyOptions) {
  const smartCheckLabel = computed(() => {
    const filter = statusFilter.value;
    if (filter && CONTEXT_AWARE_FILTERS.has(filter)) {
      const label = FILTER_LABEL[filter];
      const count = filter === 'invalid'
        ? stats.value.invalid
        : stats.value[filter as 'suspicious' | 'timeout' | 'unchecked'];
      if (label && count > 0) return `${label} (${count.toLocaleString()})`;
    }

    if (stats.value.unchecked === stats.value.total) return '开始检测';
    if (stats.value.unchecked > 0) return '继续检测';
    if (stats.value.problems > 0) return `重检问题链接 (${stats.value.problems})`;
    return '重新检测全部';
  });

  const smartCheckTooltip = computed(() => {
    const filter = statusFilter.value;
    if (filter && CONTEXT_AWARE_FILTERS.has(filter)) {
      const count = filter === 'invalid'
        ? stats.value.invalid
        : stats.value[filter as 'suspicious' | 'timeout' | 'unchecked'];
      const tooltip = FILTER_TOOLTIP[filter];
      if (tooltip && count > 0) return `${tooltip} (${count.toLocaleString()} 条)`;
    }

    const { unchecked, total, problems } = stats.value;
    if (unchecked === total) return `检测全部 ${total.toLocaleString()} 条链接`;
    if (unchecked > 0) return `检测尚未验证的 ${unchecked.toLocaleString()} 条链接`;
    if (problems > 0) return `重新验证 ${problems.toLocaleString()} 条问题链接`;
    return `重新检测全部 ${total.toLocaleString()} 条链接`;
  });

  function buildMoreMenuItems(args: {
    mode: 'selection' | 'filter';
    count: number;
  }): MoreMenuItem[] {
    const { mode, count } = args;
    const filter = statusFilter.value;
    const countLabel = count.toLocaleString();
    const items: MoreMenuItem[] = [];

    items.push({
      kind: 'export',
      label: mode === 'selection'
        ? `导出选中 ${countLabel} 条`
        : filter === 'all'
          ? '导出全部'
          : '导出当前筛选',
      icon: 'pi-download',
    });

    const allowBulk = mode === 'selection' || filter !== 'all';
    if (!allowBulk) return items;

    items.push({
      kind: 'recheck',
      label: `重检这 ${countLabel} 条`,
      icon: 'pi-refresh',
    });

    items.push({
      kind: 'copy',
      label: `复制这 ${countLabel} 条链接`,
      icon: 'pi-copy',
    });

    items.push({
      kind: 'delete',
      label: `删除这 ${countLabel} 条`,
      icon: 'pi-trash',
      danger: true,
    });

    return items;
  }

  function resolveSmartCheck(): { action: 'check-all' | 'check-subset'; filter?: string } {
    const filter = statusFilter.value;
    if (filter && CONTEXT_AWARE_FILTERS.has(filter)) {
      return { action: 'check-subset', filter };
    }

    const { unchecked, total, problems } = stats.value;
    if (unchecked === total) return { action: 'check-all' };
    if (unchecked > 0) return { action: 'check-subset', filter: 'unchecked' };
    if (problems > 0) return { action: 'check-subset', filter: 'problems' };
    return { action: 'check-all' };
  }

  function statusDotColor(row: LinkCheckRow): string {
    const result = row.recheckResult ?? row.checkResult;
    if (!result) return 'var(--text-tertiary)';
    if (result.is_valid) return 'var(--success)';
    if (result.error_type === 'timeout') return 'var(--warning)';
    if (result.error_type === 'suspicious' || result.browser_might_work) return 'var(--pending)';
    return 'var(--error)';
  }

  function getErrorStatus(result: CheckLinkResult | null): string {
    if (!result) return 'unchecked';
    if (result.is_valid) return 'success';
    if (result.error_type === 'timeout') return 'warning';
    if (result.error_type === 'suspicious' || result.browser_might_work) return 'suspicious';
    return 'error';
  }

  function errorBadgeClass(row: LinkCheckRow): string {
    const result = row.recheckResult ?? row.checkResult ?? null;
    return `error-badge--${getErrorStatus(result)}`;
  }

  function errorLabel(row: LinkCheckRow): string {
    const result = row.recheckResult ?? row.checkResult;
    if (!result) return '—';
    if (result.is_valid) return result.status_code ? String(result.status_code) : '200';
    if (result.status_code) return String(result.status_code);
    if (result.error_type === 'timeout') return '超时';
    if (result.error_type === 'network') return '网络';
    if (result.error_type === 'suspicious' || result.browser_might_work) return '可疑';
    return '失效';
  }

  function recheckLabel(result: CheckLinkResult): string {
    if (result.is_valid) return '可用';
    if (result.error_type === 'timeout') return '超时';
    if (result.error_type === 'network') return '断连';
    if (result.error_type === 'suspicious' || result.browser_might_work) return '可疑';
    return '失效';
  }

  function errorTooltip(row: LinkCheckRow): string {
    return baseStatusTooltip(row.checkResult ?? null);
  }

  return {
    smartCheckLabel,
    smartCheckTooltip,
    buildMoreMenuItems,
    resolveSmartCheck,
    statusDotColor,
    errorBadgeClass,
    errorLabel,
    recheckLabel,
    errorTooltip,
  };
}
