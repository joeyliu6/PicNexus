// 命令面板（HomeScreen.dc.html H15 / H16）的静态条目：页面跳转、常用动作、可直接跳到的设置项。
// 设置项的去向是当前设置页的分组；设置页按新设计重写后改成新的 7 个分组并高亮那一项。

import type { IconName } from '@/components/pn/icons';
import type { NavigatePayload } from './navigatePayload';

export interface StaticCommand {
  id: string;
  label: string;
  icon: IconName;
  /** 右侧快捷键（不分平台的写法，显示时再按平台换） */
  shortcut?: string;
  sub?: string;
}

export const PAGE_COMMANDS: (StaticCommand & { path: string })[] = [
  { id: 'page:home', label: '快传', icon: 'upload', shortcut: 'Mod 1', path: '/home' },
  { id: 'page:gallery', label: '图库', icon: 'arrowRight', shortcut: 'Mod 2', path: '/gallery' },
  { id: 'page:health', label: '链接健康', icon: 'health', shortcut: 'Mod 3', path: '/health' },
  { id: 'page:hosts', label: '图床', icon: 'hosts', shortcut: 'Mod 4', path: '/hosts' },
  { id: 'page:settings', label: '设置', icon: 'settings', shortcut: 'Mod ,', path: '/settings' },
];

/** 空输入时「跳转」组只给这三项（设计稿） */
export const DEFAULT_JUMPS = ['page:gallery', 'page:health', 'page:settings'];

export type ActionId = 'paste' | 'pick' | 'url' | 'check' | 'theme';

export const ACTION_COMMANDS: (StaticCommand & { action: ActionId })[] = [
  { id: 'action:paste', label: '上传剪贴板图片', icon: 'clipboard', shortcut: 'Mod V', action: 'paste' },
  { id: 'action:pick', label: '选择文件上传', icon: 'file', shortcut: 'Mod O', action: 'pick' },
  { id: 'action:url', label: '从 URL 下载', icon: 'link', action: 'url' },
  { id: 'action:check', label: '开始链接检测', icon: 'health', action: 'check' },
  // 深色时写「切换到浅色」（useCommandPalette 按当前深浅色换），搜索也按显示的这句匹配
  { id: 'action:theme', label: '切换到深色', icon: 'moon', action: 'theme' },
];

export const SETTING_COMMANDS: (StaticCommand & { target: NavigatePayload })[] = [
  { id: 'setting:format', label: '复制为（默认链接格式）', icon: 'settings', sub: '设置 › 上传与链接', target: { view: 'settings', tab: 'general' } },
  { id: 'setting:auto-copy', label: '自动复制链接', icon: 'settings', sub: '设置 › 上传与链接', target: { view: 'settings', tab: 'general' } },
  { id: 'setting:compression', label: '图片压缩', icon: 'settings', sub: '设置 › 上传与链接', target: { view: 'settings', tab: 'compression', section: 'imageCompression' } },
  { id: 'setting:shortcut', label: '全局快捷键', icon: 'settings', sub: '设置 › 快捷键', target: { view: 'settings', tab: 'general' } },
  { id: 'setting:theme', label: '外观（浅色 / 深色 / 跟随系统）', icon: 'settings', sub: '设置 › 通用', target: { view: 'settings', tab: 'general' } },
  { id: 'setting:autostart', label: '开机自动启动', icon: 'settings', sub: '设置 › 通用', target: { view: 'settings', tab: 'general' } },
  { id: 'setting:editor', label: '编辑器与命令行', icon: 'settings', sub: '设置 › 编辑器与命令行', target: { view: 'settings', tab: 'editor' } },
  { id: 'setting:backup', label: '备份与同步', icon: 'settings', sub: '设置 › 备份与同步', target: { view: 'settings', tab: 'backup' } },
  { id: 'setting:update', label: '检查更新', icon: 'settings', sub: '设置 › 关于', target: { view: 'settings', tab: 'about' } },
];

/** 不区分大小写地找到第一处命中，返回 [前, 命中, 后]；没命中返回 null */
export function splitMatch(text: string, query: string): [string, string, string] | null {
  const q = query.trim();
  if (!q) return null;
  const index = text.toLowerCase().indexOf(q.toLowerCase());
  if (index < 0) return null;
  return [text.slice(0, index), text.slice(index, index + q.length), text.slice(index + q.length)];
}

/** 「Mod 1」→ Windows / Linux「Ctrl 1」，macOS「⌘ 1」 */
export function shortcutLabel(shortcut: string | undefined, mac: boolean): string {
  return shortcut ? shortcut.replace('Mod', mac ? '⌘' : 'Ctrl') : '';
}
