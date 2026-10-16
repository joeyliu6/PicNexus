// 应用级 Cookie 登录（交接说明 8.1 / 8.6 / 8.7）
// 首页「重新登录」、图床页、托盘都能打开独立的登录小窗；登录窗口发来 cookie-updated 后
// 在这里统一保存进配置（不依赖设置页是否打开过），再通知等着它的地方（如自动重试这张的微博）。

import type { UnlistenFn } from '@tauri-apps/api/event';
import type { ServiceType, UserConfig } from '@/config/types';
import { DEFAULT_CONFIG } from '@/config/types';
import { useConfigManager } from '@/composables/useConfig';
import { readFreshConfig } from '@/store/instances';
import { createLogger } from '@/utils/logger';

const log = createLogger('CookieLogin');

type LoggedInHandler = () => void | Promise<void>;

/** 登录成功后要做的事（按图床）；做完即清 */
const waiters = new Map<string, LoggedInHandler[]>();
let unlisten: UnlistenFn | null = null;

/** 把登录窗口拿到的 Cookie 写进配置；微博是 services.weibo，其余 Cookie 图床同名 */
export function applyCookie(config: UserConfig, serviceId: string, cookie: string): UserConfig {
  const services = { ...(config.services ?? {}) } as Record<string, Record<string, unknown> | undefined>;
  const current = services[serviceId] ?? {};
  services[serviceId] = serviceId === 'weibo' ? { ...current, enabled: true, cookie } : { ...current, cookie };
  return { ...config, services: services as UserConfig['services'] };
}

export function useCookieLogin() {
  const configManager = useConfigManager();

  async function save(serviceId: string, cookie: string): Promise<void> {
    const config = (await readFreshConfig()) ?? DEFAULT_CONFIG;
    await configManager.saveConfig(applyCookie(config, serviceId, cookie), true);
    const handlers = waiters.get(serviceId) ?? [];
    waiters.delete(serviceId);
    for (const handler of handlers) {
      try {
        await handler();
      } catch (error) {
        log.warn(`${serviceId} 登录后的后续操作失败`, error);
      }
    }
  }

  /** 在应用外壳里装一次；返回卸载函数 */
  async function install(): Promise<UnlistenFn> {
    if (!unlisten) unlisten = await configManager.setupCookieListener(save);
    return () => {
      unlisten?.();
      unlisten = null;
    };
  }

  /** 打开登录小窗；onLoggedIn 在拿到并保存好新 Cookie 之后调用 */
  async function login(serviceId: string, onLoggedIn?: LoggedInHandler): Promise<void> {
    if (onLoggedIn) waiters.set(serviceId, [...(waiters.get(serviceId) ?? []), onLoggedIn]);
    await configManager.openCookieWebView(serviceId as ServiceType);
  }

  return { install, login };
}

export function __resetCookieLoginForTests(): void {
  waiters.clear();
  unlisten = null;
}
