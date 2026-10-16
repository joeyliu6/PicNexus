// 公共图床风险确认（HostsScreen.dc.html dialog=risk，交接说明 8.4）：
// 第一次把公共图床（京东、七鱼、微博等非官方适配）设为启用时问一次，确认过就不再问。

import { DEFAULT_CONFIG } from '@/config/types';
import { useConfigManager } from '@/composables/useConfig';
import { useConfirm } from '@/composables/useConfirm';
import { readFreshConfig } from '@/store/instances';

export const PUBLIC_RISK_COPY = {
  header: '启用公共图床？',
  message: '此类图床为非官方的第三方平台适配，可能违反平台规则或随时失效，相关风险由你自行承担。是否继续？',
  acceptLabel: '我已了解并继续',
  rejectLabel: '取消',
} as const;

export function usePublicRiskConfirm() {
  const configManager = useConfigManager();
  const { confirm } = useConfirm();

  /** 已确认过直接返回 true；否则弹确认框，确认后记下来 */
  async function ensureAccepted(): Promise<boolean> {
    const config = (await readFreshConfig()) ?? DEFAULT_CONFIG;
    if (config.publicServiceRiskAccepted) return true;
    const accepted = await confirm(PUBLIC_RISK_COPY.message, {
      header: PUBLIC_RISK_COPY.header,
      acceptLabel: PUBLIC_RISK_COPY.acceptLabel,
      rejectLabel: PUBLIC_RISK_COPY.rejectLabel,
    });
    if (!accepted) return false;
    const latest = (await readFreshConfig()) ?? config;
    await configManager.saveConfig({ ...latest, publicServiceRiskAccepted: true }, true);
    return true;
  }

  return { ensureAccepted };
}
