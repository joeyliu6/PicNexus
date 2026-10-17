import { isHttpDomainConfirmed, isLoopbackHost } from '@/security/networkPolicy';
import type { HttpDomainConfirmable } from '@/config/types';

/**
 * 这份配置是否正卡在「公开域名是明文 HTTP、但用户还没确认」这一档
 *
 * 供「测试连接」判断该弹逃生舱还是照常报错——两者的处理方式完全不同：
 * 前者是等用户拍板，后者是配置真的填错了。
 */
export function needsHttpDomainConsent(config: Record<string, unknown>): boolean {
  const raw = config.publicDomain;
  if (typeof raw !== 'string' || !raw.trim()) return false;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:') return false;
    if (isLoopbackHost(url.hostname)) return false;  // 回环本来就放行，不需要确认
    return !isHttpDomainConfirmed(config as HttpDomainConfirmable, raw);
  } catch {
    return false;  // 连 URL 都不合法：交给测试连接去报格式错
  }
}
