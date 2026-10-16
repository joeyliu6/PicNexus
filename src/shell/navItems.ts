// 主导航：四个页面 + 底部设置。文案、图标照设计稿（HomeScreen.dc.html 侧栏）。
import type { IconName } from '@/components/pn/icons';

export type PageKey = 'home' | 'gallery' | 'health' | 'hosts' | 'settings';

export interface NavItem {
  key: PageKey;
  label: string;
  icon: IconName;
  path: string;
}

export const MAIN_NAV: readonly NavItem[] = [
  { key: 'home', label: '快传', icon: 'upload', path: '/home' },
  { key: 'gallery', label: '图库', icon: 'gallery', path: '/gallery' },
  { key: 'health', label: '链接健康', icon: 'health', path: '/health' },
  { key: 'hosts', label: '图床', icon: 'hosts', path: '/hosts' },
];

export const SETTINGS_NAV: NavItem = { key: 'settings', label: '设置', icon: 'settings', path: '/settings' };

/** 侧栏提示点：琥珀 = 需要留意（链接健康有失效图片）；品牌蓝 = 有新版本 */
export type NavBadge = 'warning' | 'brand';
