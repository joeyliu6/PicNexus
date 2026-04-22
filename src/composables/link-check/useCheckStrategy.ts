import { computed, type ComputedRef, type Ref } from 'vue';
import type { CheckLinkResult, LinkCheckRow, StatusFilter } from '../../types/linkCheck';
import { statusTooltip as baseStatusTooltip } from '../useLinkStatusDisplay';
import type { CheckStatsResult } from './useCheckStats';

const CONTEXT_AWARE_FILTERS = new Set<StatusFilter>(['invalid', 'suspicious', 'timeout', 'unchecked']);

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

  const showDropdownArrow = computed(() => {
    if (statusFilter.value && CONTEXT_AWARE_FILTERS.has(statusFilter.value)) return true;
    if (stats.value.unchecked === stats.value.total) return false;
    if (stats.value.unchecked === 0 && stats.value.problems === 0) return false;
    return true;
  });

  function buildDropdownItems(): Array<{
    label: string;
    desc: string;
    icon: string;
    action: 'check-all' | 'check-subset';
    filter?: string;
  }> {
    const items: Array<{
      label: string;
      desc: string;
      icon: string;
      action: 'check-all' | 'check-subset';
      filter?: string;
    }> = [];
    const { total, unchecked, problems } = stats.value;
    const filter = statusFilter.value;

    items.push({
      label: `检测全部 (${total.toLocaleString()})`,
      desc: '包括已经检测过的链接',
      icon: 'pi-play',
      action: 'check-all',
    });

    if (unchecked > 0 && unchecked < total && filter !== 'unchecked') {
      items.push({
        label: `仅未检测 (${unchecked.toLocaleString()})`,
        desc: '跳过已有结果的链接',
        icon: 'pi-clock',
        action: 'check-subset',
        filter: 'unchecked',
      });
    }

    if (problems > 0 && filter !== 'invalid' && filter !== 'timeout' && filter !== 'suspicious') {
      items.push({
        label: `重检问题链接 (${problems.toLocaleString()})`,
        desc: '重新验证失效、超时和可疑链接',
        icon: 'pi-exclamation-triangle',
        action: 'check-subset',
        filter: 'problems',
      });
    }

    if ((filter === 'invalid' || filter === 'suspicious' || filter === 'timeout') && problems > 0) {
      const currentCount = filter === 'invalid'
        ? stats.value.invalid
        : stats.value[filter as 'suspicious' | 'timeout'];
      if (problems !== currentCount) {
        items.push({
          label: `重检全部问题链接 (${problems.toLocaleString()})`,
          desc: '包括失效、超时和可疑链接',
          icon: 'pi-exclamation-triangle',
          action: 'check-subset',
          filter: 'problems',
        });
      }
    }

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
    if (row.linkCheckSkip && !row.recheckResult) {
      return 'var(--warning)';
    }

    const result = row.recheckResult ?? row.checkResult;
    if (!result) return 'var(--text-tertiary)';
    if (result.is_valid) return 'var(--success)';
    if (result.error_type === 'timeout') return 'var(--warning)';
    if (result.error_type === 'suspicious' || result.browser_might_work) return 'var(--pending)';
    return 'var(--error)';
  }

  function getErrorStatus(result: CheckLinkResult | null, row: LinkCheckRow): string {
    if (row.linkCheckSkip && !row.recheckResult) return 'skipped';
    if (!result) return 'unchecked';
    if (result.is_valid) return 'success';
    if (result.error_type === 'timeout') return 'warning';
    if (result.error_type === 'suspicious' || result.browser_might_work) return 'suspicious';
    return 'error';
  }

  function errorBadgeClass(row: LinkCheckRow): string {
    const result = row.recheckResult ?? row.checkResult ?? null;
    return `error-badge--${getErrorStatus(result, row)}`;
  }

  function errorLabel(row: LinkCheckRow): string {
    if (row.linkCheckSkip && !row.recheckResult) return '跳过';

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
    if (row.linkCheckSkip && !row.recheckResult) {
      return '已标记为不再检测，可在“已跳过”标签中恢复。';
    }
    return baseStatusTooltip(row.checkResult ?? null);
  }

  return {
    smartCheckLabel,
    smartCheckTooltip,
    showDropdownArrow,
    buildDropdownItems,
    resolveSmartCheck,
    statusDotColor,
    errorBadgeClass,
    errorLabel,
    recheckLabel,
    errorTooltip,
  };
}
