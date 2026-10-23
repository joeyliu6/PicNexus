// 命令面板（HomeScreen.dc.html H15 / H16）的静态条目：页面跳转、常用动作、可直接跳到的设置项。
// 设置项跳到设置页那一组并高亮那一行（行 id 见 src/views/settings/settingsGroups.ts 的 SETTING_ROWS）。

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

/** 设置的每一项（交接说明 8.5：设置页不放搜索框，命令面板能搜到每一项）；Enter 跳到那一组并高亮这一行 */
const SETTING_ROWS: [section: string, label: string, group: string][] = [
  ['theme', '外观（浅色 / 深色 / 跟随系统）', '通用'],
  ['autoStart', '开机自动启动', '通用'],
  ['silentStart', '静默启动', '通用'],
  ['closeToTray', '关闭窗口时最小化到托盘', '通用'],
  ['defaultFormat', '默认复制为', '上传与链接'],
  ['customTemplate', '自定义模板', '上传与链接'],
  ['autoCopy', '自动复制链接', '上传与链接'],
  ['autoUploadClipboard', '自动上传剪贴板', '上传与链接'],
  ['compression', '图片压缩', '上传与链接'],
  ['globalShortcut', '全局快捷键', '快捷键'],
  ['appShortcuts', '应用内快捷键', '快捷键'],
  ['typora', 'Typora', '编辑器与命令行'],
  ['obsidian', 'Obsidian', '编辑器与命令行'],
  ['cli', '命令行 CLI', '编辑器与命令行'],
  ['cloudSync', '云同步', '备份与同步'],
  ['backupPassword', '备份密码', '备份与同步'],
  ['manualBackup', '导出 / 导入配置与上传记录', '备份与同步'],
  ['analytics', '匿名使用统计', '数据与隐私'],
  ['dataDir', '数据位置', '数据与隐私'],
  ['cache', '清理应用缓存', '数据与隐私'],
  ['clearRecords', '清空全部记录', '数据与隐私'],
  ['resetDefaults', '恢复默认设置', '数据与隐私'],
  ['update', '检查更新', '关于'],
  ['autoUpdate', '自动更新', '关于'],
  ['onboarding', '重新查看新手引导', '关于'],
];

export const SETTING_COMMANDS: (StaticCommand & { target: NavigatePayload })[] = SETTING_ROWS.map(([section, label, group]) => ({
  id: `setting:${section}`,
  label,
  icon: 'settings',
  sub: `设置 › ${group}`,
  target: { view: 'settings', section },
}));

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
