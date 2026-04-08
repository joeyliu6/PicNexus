/**
 * useCheckStrategy — 链接监控面板的智能检测策略 + 状态展示
 * 从 HistoryCheckPanel.vue 提取
 */
import { computed, type Ref, type ComputedRef } from 'vue';
import type { StatusFilter, LinkCheckRow, CheckLinkResult } from '../../types/linkCheck';
import { statusTooltip as baseStatusTooltip } from '../useLinkStatusDisplay';
import type { CheckStatsResult } from './useCheckStats';

// 需要感知上下文的标签
const CONTEXT_AWARE_FILTERS = new Set(['invalid', 'suspicious', 'timeout', 'unchecked']);

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
  // ---- 智能检测按钮标签 ----
  const smartCheckLabel = computed(() => {
    const sf = statusFilter.value;
    if (sf && CONTEXT_AWARE_FILTERS.has(sf)) {
      const label = FILTER_LABEL[sf];
      const count = sf === 'invalid' ? stats.value.invalid : stats.value[sf as keyof CheckStatsResult] as number;
      if (label && count > 0) return `${label} (${count.toLocaleString()})`;
    }
    if (stats.value.unchecked === stats.value.total) return '开始检测';
    if (stats.value.unchecked > 0) return '继续检测';
    if (stats.value.problems > 0) return `重检问题链接 (${stats.value.problems})`;
    return '重新检测全部';
  });

  const smartCheckTooltip = computed(() => {
    const sf = statusFilter.value;
    if (sf && CONTEXT_AWARE_FILTERS.has(sf)) {
      const count = sf === 'invalid' ? stats.value.invalid : stats.value[sf as keyof CheckStatsResult] as number;
      const tip = FILTER_TOOLTIP[sf];
      if (tip && count > 0) return `${tip} (${count.toLocaleString()} 条)`;
    }
    const { unchecked, total, problems } = stats.value;
    if (unchecked === total) return `检测全部 ${total.toLocaleString()} 条链接`;
    if (unchecked > 0) return `检测尚未验证的 ${unchecked.toLocaleString()} 条链接`;
    if (problems > 0) return `重新验证 ${problems} 条问题链接`;
    return `重新检测全部 ${total.toLocaleString()} 条链接`;
  });

  const showDropdownArrow = computed(() => {
    if (statusFilter.value && CONTEXT_AWARE_FILTERS.has(statusFilter.value)) return true;
    if (stats.value.unchecked === stats.value.total) return false;
    if (stats.value.unchecked === 0 && stats.value.problems === 0) return false;
    return true;
  });

  /** 构建下拉菜单选项（不含 emit，返回 action 描述符供组件调用） */
  function buildDropdownItems(): Array<{ label: string; desc: string; icon: string; action: 'check-all' | 'check-subset'; filter?: string }> {
    const items: Array<{ label: string; desc: string; icon: string; action: 'check-all' | 'check-subset'; filter?: string }> = [];
    const { total, unchecked, problems } = stats.value;
    const sf = statusFilter.value;

    items.push({
      label: `检测全部 (${total.toLocaleString()})`,
      desc: '包括已检测的链接',
      icon: 'pi-play',
      action: 'check-all',
    });

    if (unchecked > 0 && unchecked < total && sf !== 'unchecked') {
      items.push({
        label: `仅未检测 (${unchecked.toLocaleString()})`,
        desc: '跳过已有结果的链接',
        icon: 'pi-clock',
        action: 'check-subset',
        filter: 'unchecked',
      });
    }

    if (problems > 0 && sf !== 'invalid' && sf !== 'timeout' && sf !== 'suspicious') {
      items.push({
        label: `重检问题链接 (${problems})`,
        desc: '重新验证失效、超时、可疑链接',
        icon: 'pi-exclamation-triangle',
        action: 'check-subset',
        filter: 'problems',
      });
    }

    if ((sf === 'invalid' || sf === 'suspicious' || sf === 'timeout') && problems > 0) {
      const currentCount = sf === 'invalid' ? stats.value.invalid : stats.value[sf as keyof CheckStatsResult] as number;
      if (problems !== currentCount) {
        items.push({
          label: `重检全部问题链接 (${problems})`,
          desc: '包括失效、超时、可疑链接',
          icon: 'pi-exclamation-triangle',
          action: 'check-subset',
          filter: 'problems',
        });
      }
    }

    return items;
  }

  /** 智能检测：返回应触发的 action 描述符 */
  function resolveSmartCheck(): { action: 'check-all' | 'check-subset'; filter?: string } {
    const sf = statusFilter.value;
    if (sf && CONTEXT_AWARE_FILTERS.has(sf)) {
      return { action: 'check-subset', filter: sf };
    }
    const { unchecked, total, problems } = stats.value;
    if (unchecked === total) return { action: 'check-all' };
    if (unchecked > 0) return { action: 'check-subset', filter: 'unchecked' };
    if (problems > 0) return { action: 'check-subset', filter: 'problems' };
    return { action: 'check-all' };
  }

  // ---- 行状态展示（recheckResult 优先） ----

  function statusDotColor(row: LinkCheckRow): string {
    const r = row.recheckResult ?? row.checkResult;
    if (!r) return 'var(--text-tertiary)';
    if (r.is_valid) return 'var(--success)';
    if (r.error_type === 'timeout') return 'var(--warning)';
    if (r.error_type === 'suspicious' || r.browser_might_work) return 'var(--pending)';
    return 'var(--error)';
  }

  function getErrorStatus(r: CheckLinkResult | null): string {
    if (!r) return 'unchecked';
    if (r.is_valid) return 'success';
    if (r.error_type === 'timeout') return 'warning';
    if (r.error_type === 'suspicious' || r.browser_might_work) return 'suspicious';
    return 'error';
  }

  function errorBadgeClass(row: LinkCheckRow): string {
    const r = row.recheckResult ?? row.checkResult ?? null;
    return `error-badge--${getErrorStatus(r)}`;
  }

  function errorLabel(row: LinkCheckRow): string {
    const r = row.recheckResult ?? row.checkResult;
    if (!r) return '—';
    if (r.is_valid) return r.status_code ? String(r.status_code) : '200';
    if (r.status_code) return String(r.status_code);
    if (r.error_type === 'timeout') return '超时';
    if (r.error_type === 'network') return '网络';
    if (r.error_type === 'suspicious' || r.browser_might_work) return '疑似';
    return '失效';
  }

  function recheckLabel(result: CheckLinkResult): string {
    if (result.is_valid) return '可用';
    if (result.error_type === 'timeout') return '超时';
    if (result.error_type === 'network') return '断连';
    if (result.error_type === 'suspicious' || result.browser_might_work) return '疑似';
    return '失效';
  }

  function errorTooltip(row: LinkCheckRow): string {
    return baseStatusTooltip(row.checkResult ?? null);
  }

  return {
    // 智能检测
    smartCheckLabel,
    smartCheckTooltip,
    showDropdownArrow,
    buildDropdownItems,
    resolveSmartCheck,
    // 行状态展示
    statusDotColor,
    errorBadgeClass,
    errorLabel,
    recheckLabel,
    errorTooltip,
  };
}
