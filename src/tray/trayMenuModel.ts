// 托盘菜单（TrayWindow.dc.html，交接说明 8.6，T01–T08）：由配置、图床、剪贴板与上传进度推出菜单长什么样。
// 纯计算，不碰 Tauri；画成系统原生菜单的是 nativeTray.ts。
// 结构与文案三平台一致：两条动作 →「上传到 / 复制为 / 压缩」带当前值 → 三个勾选开关 → 打开 / 设置 / 退出。
// 不放图片和历史（交接说明第 12 节）。
// 原生菜单做不到的写法（右侧灰字、等宽字、琥珀小点、进度条）见 docs/design/redesign/decisions/tray.md 与 README「平台限制记录」。

import { DEFAULT_CONFIG, type CompressionPreset, type UserConfig } from '@/config/types';
import type { UploadHost } from '@/composables/upload/useUploadController';
import { resolveActivePreset } from '@/composables/image/useImageCompress';
import { FORMAT_NAMES, type LinkFormat } from '@/utils/linkFormatter';
import type { PetalState } from '@/utils/petals';
import type { UiPlatform } from '@/utils/platform';
import { formatShortcut } from '@/utils/shortcutText';

/** 正在进行的上传（状态行与托盘图标用） */
export interface TrayUploadStatus {
  /** 单张写文件名，多张写「N 张」 */
  subject: string;
  /** 单张：已完成的图床数；多张：已传完的张数 */
  done: number;
  total: number;
  /** 一瓣 = 一个图床 */
  petals: PetalState[];
}

export interface TrayMenuInput {
  platform: UiPlatform;
  /** 与首页「上传到」同一份（已添加且已配置的图床） */
  hosts: readonly UploadHost[];
  config: UserConfig;
  /** 剪贴板里有没有图片；null = 不知道（Linux 收不到托盘悬停，第一项一直可点） */
  clipboardHasImage: boolean | null;
  upload: TrayUploadStatus | null;
}

export type TrayAction =
  | { type: 'uploadClipboard' }
  | { type: 'pickFiles' }
  | { type: 'toggleHost'; hostId: string }
  | { type: 'loginHost'; hostId: string }
  | { type: 'manageHosts' }
  | { type: 'setFormat'; format: LinkFormat }
  | { type: 'customFormat' }
  | { type: 'setCompression'; presetId: string | null }
  | { type: 'compressionSettings' }
  | { type: 'toggleAutoCopy' }
  | { type: 'toggleAutoUploadClipboard' }
  | { type: 'toggleGlobalShortcut' }
  | { type: 'open' }
  | { type: 'settings' }
  | { type: 'quit' };

export type TrayRow =
  | { kind: 'separator' }
  /** 上传中那一行：不可点，前面一个花瓣小图标 */
  | { kind: 'status'; text: string; petals: PetalState[] }
  /** accelerator：只在 macOS / Linux 交给系统菜单画（Windows 的快捷键已写进 text 右列） */
  | { kind: 'item'; text: string; enabled: boolean; accelerator?: string; isDefault?: boolean; action: TrayAction }
  | { kind: 'check'; text: string; checked: boolean; enabled: boolean; action: TrayAction }
  | { kind: 'submenu'; text: string; items: TrayRow[] };

/** 「复制为」每种格式长什么样（设计稿用等宽字，原生菜单只能用菜单字体） */
const FORMAT_SAMPLES: Record<Exclude<LinkFormat, 'custom'>, string> = {
  url: 'https://…',
  markdown: '![](…)',
  html: '<img src="…">',
  bbcode: '[img]…[/img]',
};

/** 与 src-tauri/src/commands/tray.rs 兜底菜单的两项一致（前端菜单画好之前用的是那一份） */
const OPEN_LABEL = '打开 PicNexus';
const QUIT_LABEL = '退出 PicNexus';

/** 状态行里的文件名超过这么多字从中间省略 */
const SUBJECT_MAX_CHARS = 24;
/** 图床原因（非登录类）超过这么多字截断 */
const HOST_DETAIL_MAX_CHARS = 16;

const SEPARATOR: TrayRow = { kind: 'separator' };

/** 「&」在三个平台的系统菜单里都表示快捷字母，要写成「&&」才显示「&」 */
export function escapeMnemonic(text: string): string {
  return text.replace(/&/g, '&&');
}

/**
 * 一行的文字：名字 + 右侧说明。Windows 菜单在制表符后面另起右对齐的一列；
 * macOS / Linux 菜单没有这一列，写在名字后面用「 · 」隔开。
 */
export function menuText(label: string, detail: string, platform: UiPlatform): string {
  const name = escapeMnemonic(label);
  if (!detail) return name;
  return platform === 'windows' ? `${name}\t${escapeMnemonic(detail)}` : `${name} · ${escapeMnemonic(detail)}`;
}

/** 从中间省略，留住开头和扩展名 */
export function truncateMiddle(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  const tail = Math.floor((max - 1) / 2);
  const head = max - 1 - tail;
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - tail).join('')}`;
}

function truncateEnd(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

/** 「上传到」的当前值：没选写「未选择」，选了一个写图床名，多个写「N 个图床」 */
export function uploadToSummary(hosts: readonly UploadHost[]): string {
  const selected = hosts.filter((host) => host.selected);
  if (selected.length === 0) return '未选择';
  if (selected.length === 1) return selected[0].name;
  return `${selected.length} 个图床`;
}

/** 子项右侧的原因：Cookie 图床统一写「登录失效」（T03），其余用检测给出的原因 */
function hostDetail(host: UploadHost): string {
  if (!host.warning) return '';
  return host.cookieLogin ? '登录失效' : truncateEnd(host.warning, HOST_DETAIL_MAX_CHARS);
}

function hostRows(hosts: readonly UploadHost[], platform: UiPlatform): TrayRow[] {
  const rows: TrayRow[] = hosts.map((host) => ({
    kind: 'check',
    text: menuText(host.name, hostDetail(host), platform),
    checked: host.selected,
    enabled: true,
    // 登录失效的图床：点击打开登录窗口，不改勾选（T03）
    action: host.warning && host.cookieLogin ? { type: 'loginHost', hostId: host.id } : { type: 'toggleHost', hostId: host.id },
  }));
  if (rows.length > 0) rows.push(SEPARATOR);
  rows.push({ kind: 'item', text: '管理图床…', enabled: true, action: { type: 'manageHosts' } });
  return rows;
}

function formatRows(format: LinkFormat, platform: UiPlatform): TrayRow[] {
  const builtin = (Object.keys(FORMAT_SAMPLES) as Exclude<LinkFormat, 'custom'>[]).map<TrayRow>((value) => ({
    kind: 'check',
    text: menuText(FORMAT_NAMES[value], FORMAT_SAMPLES[value], platform),
    checked: format === value,
    enabled: true,
    action: { type: 'setFormat', format: value },
  }));
  return [
    ...builtin,
    SEPARATOR,
    { kind: 'check', text: '自定义格式…', checked: format === 'custom', enabled: true, action: { type: 'customFormat' } },
  ];
}

function compressionRows(enabled: boolean, active: CompressionPreset, presets: readonly CompressionPreset[]): TrayRow[] {
  return [
    { kind: 'check', text: '关', checked: !enabled, enabled: true, action: { type: 'setCompression', presetId: null } },
    ...presets.map<TrayRow>((preset) => ({
      kind: 'check',
      text: escapeMnemonic(preset.name),
      checked: enabled && preset.id === active.id,
      enabled: true,
      action: { type: 'setCompression', presetId: preset.id },
    })),
    SEPARATOR,
    { kind: 'item', text: '压缩设置与预览…', enabled: true, action: { type: 'compressionSettings' } },
  ];
}

/** 动作行：Windows 把说明与快捷键都放进右列；macOS / Linux 的快捷键交给系统菜单 */
function actionRow(
  label: string,
  options: { detail?: string; shortcut?: string; enabled?: boolean; isDefault?: boolean; action: TrayAction },
  platform: UiPlatform,
): TrayRow {
  const detail = options.detail ?? '';
  const shortcut = options.shortcut ?? '';
  const windows = platform === 'windows';
  const right = windows ? [detail, shortcut && formatShortcut(shortcut, platform)].filter(Boolean).join('  ') : detail;
  return {
    kind: 'item',
    text: menuText(label, right, platform),
    enabled: options.enabled ?? true,
    ...(!windows && shortcut ? { accelerator: shortcut } : {}),
    ...(options.isDefault ? { isDefault: true } : {}),
    action: options.action,
  };
}

export function buildTrayMenu(input: TrayMenuInput): TrayRow[] {
  const { platform, hosts, config, upload } = input;
  const linkOutput = { ...DEFAULT_CONFIG.linkOutput!, ...(config.linkOutput ?? {}) };
  const shortcuts = { ...DEFAULT_CONFIG.globalShortcut!, ...(config.globalShortcut ?? {}) };
  const compression = config.imageCompression ?? DEFAULT_CONFIG.imageCompression!;
  const activePreset = resolveActivePreset(compression);
  const format = linkOutput.defaultFormat;
  const mac = platform === 'macos';
  // 关闭全局快捷键：菜单里的快捷键提示随之消失（T07）
  const keyOf = (accelerator: string) => (shortcuts.enabled ? accelerator : '');
  const noClip = input.clipboardHasImage === false;
  const hostWarning = hosts.some((host) => host.selected && host.warning);

  const rows: TrayRow[] = [];
  if (upload) {
    rows.push(
      {
        kind: 'status',
        text: menuText(`正在上传 ${truncateMiddle(upload.subject, SUBJECT_MAX_CHARS)}`, `${upload.done} / ${upload.total}`, platform),
        petals: upload.petals,
      },
      SEPARATOR,
    );
  }
  rows.push(
    actionRow('上传剪贴板图片', {
      detail: noClip ? '剪贴板无图片' : '',
      shortcut: keyOf(shortcuts.uploadClipboard),
      enabled: !noClip,
      action: { type: 'uploadClipboard' },
    }, platform),
    actionRow('选择文件上传…', { shortcut: keyOf(shortcuts.uploadFromFile), action: { type: 'pickFiles' } }, platform),
    SEPARATOR,
    // 有勾选的图床需要处理：父项提示「这里有事」（设计稿是琥珀小点，原生菜单只能写 ⚠）
    { kind: 'submenu', text: menuText('上传到', `${hostWarning ? '⚠ ' : ''}${uploadToSummary(hosts)}`, platform), items: hostRows(hosts, platform) },
    { kind: 'submenu', text: menuText('复制为', FORMAT_NAMES[format], platform), items: formatRows(format, platform) },
    {
      kind: 'submenu',
      text: menuText('压缩', compression.enabled ? activePreset.name : '关', platform),
      items: compressionRows(compression.enabled, activePreset, compression.presets ?? []),
    },
    SEPARATOR,
    { kind: 'check', text: '自动复制链接', checked: linkOutput.autoCopy !== false, enabled: true, action: { type: 'toggleAutoCopy' } },
    { kind: 'check', text: '自动上传剪贴板', checked: config.appBehavior?.autoUploadClipboard === true, enabled: true, action: { type: 'toggleAutoUploadClipboard' } },
    { kind: 'check', text: '全局快捷键', checked: shortcuts.enabled, enabled: true, action: { type: 'toggleGlobalShortcut' } },
    SEPARATOR,
    // Windows 上「打开 PicNexus」是默认项（加粗，双击图标做的就是它）
    actionRow(OPEN_LABEL, { isDefault: platform === 'windows', action: { type: 'open' } }, platform),
    actionRow('设置…', { shortcut: mac ? 'CmdOrCtrl+,' : '', action: { type: 'settings' } }, platform),
    actionRow(QUIT_LABEL, { shortcut: mac ? 'CmdOrCtrl+Q' : '', action: { type: 'quit' } }, platform),
  );
  return rows;
}
