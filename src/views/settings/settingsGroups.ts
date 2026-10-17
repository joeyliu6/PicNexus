// 设置页的 7 个分组（SettingsScreen.dc.html 二级栏）与外部跳转的去向。
// 每一行有个 id：命令面板跳到那一项时，页面切到所在分组并把这一行高亮一下。
import type { IconName } from '@/components/pn/icons';

export type SettingsGroupId = 'general' | 'upload' | 'shortcut' | 'editor' | 'backup' | 'privacy' | 'about';

export interface SettingsGroup {
  id: SettingsGroupId;
  name: string;
  /** 页标题下的一句话 */
  sub: string;
  icon: IconName;
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: 'general', name: '通用', sub: '外观与启动方式', icon: 'sliders' },
  { id: 'upload', name: '上传与链接', sub: '链接格式、自动复制与压缩', icon: 'link' },
  { id: 'shortcut', name: '快捷键', sub: '全局快捷键与应用内快捷键', icon: 'keyboard' },
  { id: 'editor', name: '编辑器与命令行', sub: '在 Typora、Obsidian 和命令行里直接上传', icon: 'terminal' },
  { id: 'backup', name: '备份与同步', sub: '在新设备上恢复全部配置与记录', icon: 'cloud' },
  { id: 'privacy', name: '数据与隐私', sub: '统计、缓存与重置', icon: 'shield' },
  { id: 'about', name: '关于', sub: '版本、更新与反馈', icon: 'infoRound' },
];

/** 每一行的 id → 所在分组（命令面板的设置项、托盘与首页的跳转都用它） */
export const SETTING_ROWS = {
  theme: 'general',
  homeDecor: 'general',
  autoStart: 'general',
  silentStart: 'general',
  closeToTray: 'general',
  defaultFormat: 'upload',
  customTemplate: 'upload',
  autoCopy: 'upload',
  autoUploadClipboard: 'upload',
  compression: 'upload',
  globalShortcut: 'shortcut',
  shortcutClipboard: 'shortcut',
  shortcutFile: 'shortcut',
  appShortcuts: 'shortcut',
  typora: 'editor',
  obsidian: 'editor',
  cli: 'editor',
  cloudSync: 'backup',
  backupPassword: 'backup',
  manualBackup: 'backup',
  analytics: 'privacy',
  dataDir: 'privacy',
  cache: 'privacy',
  clearRecords: 'privacy',
  resetDefaults: 'privacy',
  update: 'about',
  autoUpdate: 'about',
  onboarding: 'about',
} as const satisfies Record<string, SettingsGroupId>;

export type SettingRowId = keyof typeof SETTING_ROWS;

/**
 * 外部跳转带来的 tab 名 → 分组。旧设置页的 tab（general / advanced / compression / backup / about）
 * 托盘、首页、命令面板还在用，照旧认；新分组名原样认。
 */
const LEGACY_TABS: Record<string, SettingsGroupId> = {
  advanced: 'upload',
  compression: 'upload',
};

export function groupForTab(tab: string | null | undefined): SettingsGroupId | null {
  if (!tab) return null;
  if (tab in LEGACY_TABS) return LEGACY_TABS[tab];
  return SETTINGS_GROUPS.some((g) => g.id === tab) ? (tab as SettingsGroupId) : null;
}

/** 外部跳转带来的 section：新的行 id 原样认；旧写法 imageCompression 指压缩 */
export function rowForSection(section: string | null | undefined): SettingRowId | null {
  if (!section) return null;
  if (section === 'imageCompression') return 'compression';
  return section in SETTING_ROWS ? (section as SettingRowId) : null;
}
