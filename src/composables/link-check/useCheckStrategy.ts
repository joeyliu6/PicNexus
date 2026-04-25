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
  count: number;
  danger?: boolean;
}

const FILTER_LABEL: Record<string, string> = {
  invalid: '重检失效',
  suspicious: '重检可疑',
  timeout: '重检超时',
  unchecked: '开始检测',
};

const FILTER_TOOLTIP: Record<string, (count: string) => string> = {
  invalid: (c) => `重新检测这 ${c} 条失效链接`,
  suspicious: (c) => `重新检测这 ${c} 条可疑链接`,
  timeout: (c) => `重新检测这 ${c} 条超时链接`,
  unchecked: (c) => `开始检测这 ${c} 条未检测链接`,
};

const SCOPE_FILTER_LABEL: Record<string, string> = {
  invalid: '失效',
  suspicious: '可疑',
  timeout: '超时',
  unchecked: '未检测',
  valid: '可用',
};

interface UseCheckStrategyOptions {
  stats: ComputedRef<CheckStatsResult>;
  statusFilter: Ref<StatusFilter>;
}

export function useCheckStrategy({ stats, statusFilter }: UseCheckStrategyOptions) {
  function contextAwareCount(filter: StatusFilter): number {
    return stats.value[filter as 'invalid' | 'suspicious' | 'timeout' | 'unchecked'];
  }

  const smartCheckLabel = computed(() => {
    const filter = statusFilter.value;
    if (filter && CONTEXT_AWARE_FILTERS.has(filter)) {
      const label = FILTER_LABEL[filter];
      if (label && contextAwareCount(filter) > 0) return label;
    }

    const { unchecked, total, problems } = stats.value;
    if (unchecked === total) return '开始检测';
    if (unchecked > 0) return '继续检测';
    if (problems > 0) return '重检问题';
    return '重检全部';
  });

  const smartCheckTooltip = computed(() => {
    const filter = statusFilter.value;
    if (filter && CONTEXT_AWARE_FILTERS.has(filter)) {
      const count = contextAwareCount(filter);
      const tooltipFn = FILTER_TOOLTIP[filter];
      if (tooltipFn && count > 0) return tooltipFn(count.toLocaleString());
    }

    const { unchecked, total, problems } = stats.value;
    if (unchecked === total) return `开始检测全部 ${total.toLocaleString()} 条链接`;
    if (unchecked > 0) return `继续检测剩余 ${unchecked.toLocaleString()} 条链接`;
    if (problems > 0) return `重新检测 ${problems.toLocaleString()} 条问题链接`;
    return `重新检测全部 ${total.toLocaleString()} 条链接`;
  });

  function buildMoreMenuItems(args: {
    mode: 'selection' | 'filter';
    count: number;
  }): MoreMenuItem[] {
    const { mode, count } = args;
    const filter = statusFilter.value;
    const items: MoreMenuItem[] = [];

    items.push({ kind: 'export', label: '导出', icon: 'pi-download', count });

    const allowBulk = mode === 'selection' || filter !== 'all';
    if (!allowBulk) return items;

    items.push({ kind: 'recheck', label: '重新检测', icon: 'pi-refresh', count });
    items.push({ kind: 'copy', label: '复制链接', icon: 'pi-copy', count });
    items.push({ kind: 'delete', label: '删除', icon: 'pi-trash', count, danger: true });

    return items;
  }

  function buildScopeLabel(args: {
    mode: 'selection' | 'filter';
    count: number;
  }): string {
    if (args.mode === 'selection') {
      return `针对已选 ${args.count.toLocaleString()} 条`;
    }
    const filter = statusFilter.value;
    if (!filter || filter === 'all') return '针对全部数据';
    const sub = SCOPE_FILTER_LABEL[filter];
    return sub ? `针对当前筛选 · ${sub}` : '针对当前筛选';
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
    buildScopeLabel,
    resolveSmartCheck,
    statusDotColor,
    errorBadgeClass,
    errorLabel,
    recheckLabel,
    errorTooltip,
  };
}
