// 自动检测（交接说明 8.3 第三张工具卡）：开着、且距上一次全量检测满 N 天，就在后台跑一次全量检测，不弹通知；
// 查出失效只在侧栏「链接健康」上点琥珀点。只在应用开着时跑：启动后 30 秒判一次，之后每小时判一次。
// 从没检测过不自动开始：第一次全量检测要十几分钟网络请求，由用户点。

import { computed } from 'vue';
import { DEFAULT_CONFIG, type LinkHealthConfig, type UserConfig } from '@/config/types';
import { useConfigManager } from '@/composables/useConfig';
import { useLinkCheckManager } from '@/composables/link-check/useLinkCheck';
import { createLogger } from '@/utils/logger';
import { repairState } from './useLinkHealth';
import { useSupplementBackup } from './useSupplementBackup';

const log = createLogger('AutoCheck');

const FIRST_DELAY_MS = 30_000;
const INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** 「更改」与「⋯ › 自动检测」子菜单的选项（值 = 天数，0 = 关闭） */
export const AUTO_CHECK_OPTIONS = [
  { value: '1', label: '每天' },
  { value: '3', label: '每 3 天' },
  { value: '7', label: '每 7 天' },
  { value: '30', label: '每 30 天' },
  { value: '0', label: '关闭' },
] as const;

export function autoCheckLabel(settings: LinkHealthConfig['autoCheck']): string {
  if (!settings.enabled) return '已关闭';
  return settings.intervalDays === 1 ? '每天' : `每 ${settings.intervalDays} 天`;
}

/** 当前设置与改动（改动即保存，交接说明第 4 节规则 10） */
export function useAutoCheckSetting() {
  const { config, loadConfig, saveConfig } = useConfigManager();
  const settings = computed(() => autoCheckSettings(config.value));
  /** 选项值：天数，「0」= 关闭 */
  const value = computed(() => (settings.value.enabled ? String(settings.value.intervalDays) : '0'));
  async function set(next: string): Promise<void> {
    const latest = await loadConfig();
    const days = Number(next);
    const autoCheck = days > 0 ? { enabled: true, intervalDays: days } : { ...autoCheckSettings(latest), enabled: false };
    await saveConfig({ ...latest, linkHealth: { ...DEFAULT_CONFIG.linkHealth!, ...latest.linkHealth, autoCheck } }, true);
  }
  return { settings, value, label: computed(() => autoCheckLabel(settings.value)), set };
}

export function autoCheckSettings(config: UserConfig | undefined): LinkHealthConfig['autoCheck'] {
  return { ...DEFAULT_CONFIG.linkHealth!.autoCheck, ...config?.linkHealth?.autoCheck };
}

/** 下次检测的时间；关着或从没检测过返回 null */
export function nextCheckAt(settings: LinkHealthConfig['autoCheck'], lastFullCheckAt: number | null): number | null {
  if (!settings.enabled || lastFullCheckAt === null) return null;
  return lastFullCheckAt + settings.intervalDays * DAY_MS;
}

export function isAutoCheckDue(settings: LinkHealthConfig['autoCheck'], lastFullCheckAt: number | null, now: number): boolean {
  const next = nextCheckAt(settings, lastFullCheckAt);
  return next !== null && now >= next;
}

/**
 * 上一次全量检测的时间：全部检测结果里最旧的那条（不另存）。单行重试只查几份，不推迟自动检测；
 * 全量检测中途取消的，留下的旧结果让它很快再次到期
 */
export function lastFullCheckAt(rows: ReadonlyArray<{ checkedAt?: number; checkResult?: unknown }>): number | null {
  let oldest: number | null = null;
  for (const row of rows) if (row.checkResult && row.checkedAt !== undefined && (oldest === null || row.checkedAt < oldest)) oldest = row.checkedAt;
  return oldest;
}

/** 在外壳里装一次；返回卸载函数 */
export function installAutoCheck(): () => void {
  const linkCheck = useLinkCheckManager();
  const { loadConfig } = useConfigManager();
  const backup = useSupplementBackup();

  async function tick(): Promise<void> {
    try {
      const settings = autoCheckSettings(await loadConfig());
      if (!settings.enabled) return;
      // 正在检测 / 修复 / 补充备份：跳过这一次
      if (linkCheck.isChecking.value || repairState.running || backup.state.phase === 'running' || backup.state.phase === 'paused') return;
      await linkCheck.loadHistoryRows();
      if (!isAutoCheckDue(settings, lastFullCheckAt(linkCheck.checkRows.value), Date.now())) return;
      log.info('自动检测到期，开始后台检测');
      await linkCheck.checkAllHistoryLinks();
    } catch (error) {
      log.warn('自动检测失败', error);
    }
  }

  const first = setTimeout(() => void tick(), FIRST_DELAY_MS);
  const every = setInterval(() => void tick(), INTERVAL_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
