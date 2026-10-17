// 快捷键录制（S03 / S08 / S09）：一次按键算出什么结果、和谁冲突。纯函数，组件与测试共用。
// 输出的是 Tauri 全局快捷键的写法（如 'CommandOrControl+Shift+C'），显示时再按平台换（utils/shortcutText）。
import type { UiPlatform } from '@/utils/platform';

export interface KeyPress {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type RecordResult =
  | { kind: 'cancel' }
  | { kind: 'clear' }
  /** 只按了修饰键：继续等主键 */
  | { kind: 'pending' }
  /** 不收这一下，说明行换成原因 */
  | { kind: 'reject'; reason: string }
  | { kind: 'ok'; accelerator: string };

// 非字母 / 数字 / F 键的 code → Tauri 写法（照 global-hotkey 的 Code 命名）
const CODE_TO_TOKEN: Record<string, string> = {
  Space: 'Space', Tab: 'Tab', Enter: 'Enter',
  Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: 'Minus', Equal: 'Equal',
  BracketLeft: 'BracketLeft', BracketRight: 'BracketRight', Backslash: 'Backslash',
  Semicolon: 'Semicolon', Quote: 'Quote',
  Comma: 'Comma', Period: 'Period', Slash: 'Slash', Backquote: 'Backquote',
};

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'OS']);

function keyToken(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  return CODE_TO_TOKEN[code] ?? null;
}

/** 录制中按下一个键 */
export function recordKey(press: KeyPress, platform: UiPlatform): RecordResult {
  const anyModifier = press.ctrlKey || press.metaKey || press.altKey || press.shiftKey;
  if (press.key === 'Escape' && !anyModifier) return { kind: 'cancel' };
  if ((press.key === 'Backspace' || press.key === 'Delete') && !anyModifier) return { kind: 'clear' };
  if (MODIFIER_KEYS.has(press.key)) return { kind: 'pending' };

  const token = keyToken(press.code);
  if (!token) return { kind: 'reject', reason: '不支持这个按键，请换用字母、数字或 F1–F24' };

  const mac = platform === 'macos';
  // 只按 Shift 加字母会吞掉别的程序里的大写输入：至少要有 Ctrl / Alt / ⌘（F 键可以单按）
  const strong = press.ctrlKey || press.metaKey || press.altKey;
  if (!strong && !/^F\d+$/.test(token)) {
    return { kind: 'reject', reason: mac ? '请同时按住 ⌘、⌃ 或 ⌥' : '请同时按住 Ctrl 或 Alt' };
  }

  const parts: string[] = [];
  if (mac) {
    if (press.metaKey) parts.push('CommandOrControl');
    if (press.ctrlKey) parts.push('Control');
  } else {
    if (press.ctrlKey) parts.push('CommandOrControl');
    if (press.metaKey) parts.push('Super');
  }
  if (press.altKey) parts.push('Alt');
  if (press.shiftKey) parts.push('Shift');
  parts.push(token);
  return { kind: 'ok', accelerator: parts.join('+') };
}

/** 同一个组合键的不同写法（CmdOrCtrl / Ctrl / ⌘、修饰键顺序、大小写）归成一种，用来判断冲突 */
export function canonicalAccelerator(accelerator: string, platform: UiPlatform): string {
  const mods = new Set<string>();
  let key = '';
  for (const raw of accelerator.split('+').map((p) => p.trim()).filter(Boolean)) {
    const part = raw.toLowerCase();
    if (part === 'commandorcontrol' || part === 'cmdorctrl') mods.add(platform === 'macos' ? 'meta' : 'ctrl');
    else if (part === 'control' || part === 'ctrl') mods.add('ctrl');
    else if (['command', 'cmd', 'super', 'meta'].includes(part)) mods.add('meta');
    else if (part === 'alt' || part === 'option') mods.add('alt');
    else if (part === 'shift') mods.add('shift');
    else key = part;
  }
  return [...[...mods].sort(), key].join('+');
}

/** 应用内快捷键（只读列出，S03）：显示用的写法 + 冲突比较用的加速键 */
export interface AppShortcut {
  name: string;
  /** 「Mod」按平台换成 Ctrl+ / ⌘ */
  keys: string;
  accelerators: string[];
}

export const APP_SHORTCUTS: readonly AppShortcut[] = [
  { name: '命令面板', keys: 'Mod K', accelerators: ['CommandOrControl+K'] },
  { name: '粘贴上传', keys: 'Mod V', accelerators: ['CommandOrControl+V'] },
  { name: '选择文件', keys: 'Mod O', accelerators: ['CommandOrControl+O'] },
  { name: '搜索图库', keys: 'Mod F', accelerators: ['CommandOrControl+F'] },
  { name: '快传 / 图库 / 健康 / 图床', keys: 'Mod 1–4', accelerators: ['1', '2', '3', '4'].map((n) => `CommandOrControl+${n}`) },
  { name: '设置', keys: 'Mod ,', accelerators: ['CommandOrControl+Comma'] },
  { name: '收起侧栏', keys: 'Mod \\', accelerators: ['CommandOrControl+Backslash'] },
  { name: '全选', keys: 'Mod A', accelerators: ['CommandOrControl+A'] },
  { name: '大图查看', keys: '空格', accelerators: ['Space'] },
  { name: '关闭浮层', keys: 'Esc', accelerators: [] },
];

/** 「Mod K」→ Windows / Linux「Ctrl+K」，macOS「⌘K」 */
export function appShortcutLabel(keys: string, platform: UiPlatform): string {
  return keys.replace(/^Mod /, platform === 'macos' ? '⌘' : 'Ctrl+');
}

/**
 * 录到的组合键和谁冲突：另一个全局快捷键、应用内快捷键。系统里别的程序占用要试注册才知道（见 useGlobalShortcut）。
 * 返回红字原因；不冲突返回 null。
 */
export function findConflict(
  accelerator: string,
  others: readonly { name: string; accelerator: string }[],
  platform: UiPlatform,
): string | null {
  const target = canonicalAccelerator(accelerator, platform);
  const global = others.find((o) => o.accelerator && canonicalAccelerator(o.accelerator, platform) === target);
  if (global) return `该组合键已用于「${global.name}」，请更换`;
  const app = APP_SHORTCUTS.find((s) => s.accelerators.some((a) => canonicalAccelerator(a, platform) === target));
  if (app) return `该组合键已是应用内快捷键「${app.name}」，请更换`;
  return null;
}

/** 系统注册失败（别的程序占着）时的说法：系统不告诉是谁 */
export const OS_CONFLICT = '该组合键已被其他程序占用，请更换';
