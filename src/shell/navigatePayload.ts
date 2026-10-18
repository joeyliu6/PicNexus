// 「navigate-to」事件 → 路由
// 托盘、macOS 应用菜单和应用内各处仍按旧的视图名发事件：
//   'upload' | 'history' | 'link-check' | 'settings'，或 { view, tab?, section? }
// 这里统一翻译成新的页面路径；设置页的二级定位（tab / section）照旧透传。

export interface NavigateTarget {
  path: string;
  settingsTab?: string;
  settingsSection?: string;
}

export type NavigatePayload = string | { view?: unknown; tab?: unknown; section?: unknown } | null | undefined;

const VIEW_PATHS: Record<string, string> = {
  upload: '/home',
  history: '/gallery',
  'link-check': '/health',
  settings: '/settings',
};

export function resolveNavigateTarget(payload: NavigatePayload): NavigateTarget | null {
  if (typeof payload === 'string') {
    const path = VIEW_PATHS[payload];
    return path ? { path } : null;
  }
  if (!payload || typeof payload !== 'object' || typeof payload.view !== 'string') return null;

  const path = VIEW_PATHS[payload.view];
  if (!path) return null;
  const tab = typeof payload.tab === 'string' ? payload.tab : undefined;
  const section = typeof payload.section === 'string' ? payload.section : undefined;

  if (payload.view === 'settings') {
    // 图床已从设置里搬出来单独成页
    if (tab === 'hosting') return { path: '/hosts', settingsSection: section };
    return { path, settingsTab: tab, settingsSection: section };
  }
  return { path };
}
