import { describe, expect, it } from 'vitest';
import { appShortcutLabel, canonicalAccelerator, findConflict, recordKey, type KeyPress } from '@/views/settings/shortcutRecording';

const press = (key: string, code: string, mods: Partial<KeyPress> = {}): KeyPress =>
  ({ key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe('recordKey', () => {
  it('Esc cancels and Backspace clears (S08)', () => {
    expect(recordKey(press('Escape', 'Escape'), 'windows')).toEqual({ kind: 'cancel' });
    expect(recordKey(press('Backspace', 'Backspace'), 'windows')).toEqual({ kind: 'clear' });
  });

  it('waits while only modifiers are held', () => {
    expect(recordKey(press('Control', 'ControlLeft', { ctrlKey: true }), 'windows')).toEqual({ kind: 'pending' });
  });

  it('records Ctrl+Shift+C on Windows and ⇧⌘C on macOS as CommandOrControl', () => {
    expect(recordKey(press('C', 'KeyC', { ctrlKey: true, shiftKey: true }), 'windows')).toEqual({ kind: 'ok', accelerator: 'CommandOrControl+Shift+C' });
    expect(recordKey(press('c', 'KeyC', { metaKey: true, shiftKey: true }), 'macos')).toEqual({ kind: 'ok', accelerator: 'CommandOrControl+Shift+C' });
    expect(recordKey(press('c', 'KeyC', { ctrlKey: true }), 'macos')).toEqual({ kind: 'ok', accelerator: 'Control+C' });
  });

  it('refuses Shift+letter alone and keys the global shortcut cannot register', () => {
    expect(recordKey(press('C', 'KeyC', { shiftKey: true }), 'windows')).toMatchObject({ kind: 'reject', reason: '请同时按住 Ctrl 或 Alt' });
    expect(recordKey(press('Unidentified', 'IntlRo', { ctrlKey: true }), 'windows')).toMatchObject({ kind: 'reject' });
    expect(recordKey(press('F8', 'F8'), 'windows')).toEqual({ kind: 'ok', accelerator: 'F8' });
  });
});

describe('findConflict', () => {
  const others = [{ name: '选择文件上传', accelerator: 'CommandOrControl+Shift+O' }];

  it('names the other global shortcut that already uses it, whatever the spelling', () => {
    expect(findConflict('Shift+Ctrl+o', others, 'windows')).toBe('该组合键已用于「选择文件上传」，请更换');
  });

  it('names the in-app shortcut it would shadow', () => {
    expect(findConflict('CommandOrControl+K', others, 'windows')).toBe('该组合键已是应用内快捷键「命令面板」，请更换');
    expect(findConflict('CommandOrControl+3', others, 'macos')).toBe('该组合键已是应用内快捷键「快传 / 图库 / 健康 / 图床」，请更换');
  });

  it('lets a free combination through; Ctrl and ⌘ are different keys on macOS', () => {
    expect(findConflict('CommandOrControl+Shift+C', others, 'windows')).toBeNull();
    expect(findConflict('Control+K', others, 'macos')).toBeNull();
    expect(canonicalAccelerator('Control+K', 'windows')).toBe(canonicalAccelerator('CommandOrControl+K', 'windows'));
  });
});

describe('appShortcutLabel', () => {
  it('writes Ctrl+ on Windows / Linux and ⌘ on macOS', () => {
    expect(appShortcutLabel('Mod 1–4', 'windows')).toBe('Ctrl+1–4');
    expect(appShortcutLabel('Mod K', 'macos')).toBe('⌘K');
    expect(appShortcutLabel('Esc', 'macos')).toBe('Esc');
  });
});
