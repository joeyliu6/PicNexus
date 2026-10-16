// 快捷键写法（交接说明 3.3 / 第 9 节）：Windows / Linux 写 Ctrl+Shift+C；macOS 按系统顺序写 ⇧⌘C。
// 输入是 Tauri 的加速键格式（如 'CommandOrControl+Shift+C'）。
import type { UiPlatform } from './platform';

/** macOS 修饰键的系统顺序：⌃ ⌥ ⇧ ⌘ */
const MAC_ORDER = ['Control', 'Alt', 'Shift', 'Command'] as const;
const MAC_SYMBOL: Record<string, string> = { Control: '⌃', Alt: '⌥', Shift: '⇧', Command: '⌘' };

function normalizeModifier(part: string, platform: UiPlatform): string | null {
  const key = part.toLowerCase();
  if (key === 'commandorcontrol' || key === 'cmdorctrl') return platform === 'macos' ? 'Command' : 'Control';
  if (key === 'command' || key === 'cmd' || key === 'super' || key === 'meta') return 'Command';
  if (key === 'control' || key === 'ctrl') return 'Control';
  if (key === 'alt' || key === 'option') return 'Alt';
  if (key === 'shift') return 'Shift';
  return null;
}

export function formatShortcut(accelerator: string, platform: UiPlatform): string {
  if (!accelerator) return '';
  const parts = accelerator.split('+').map((p) => p.trim()).filter(Boolean);
  const modifiers = new Set<string>();
  let key = '';
  for (const part of parts) {
    const modifier = normalizeModifier(part, platform);
    if (modifier) modifiers.add(modifier);
    else key = part.length === 1 ? part.toUpperCase() : part;
  }
  if (platform === 'macos') {
    return MAC_ORDER.filter((m) => modifiers.has(m)).map((m) => MAC_SYMBOL[m]).join('') + key;
  }
  const label: Record<string, string> = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Command: 'Win' };
  return [...['Control', 'Alt', 'Shift', 'Command'].filter((m) => modifiers.has(m)).map((m) => label[m]), key].join('+');
}
