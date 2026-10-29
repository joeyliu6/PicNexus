import { describe, expect, it } from 'vitest';
import { shortcutLabel, splitMatch } from '@/shell/commandIndex';

describe('commandIndex', () => {
  it('splits a label around the first case-insensitive match', () => {
    expect(splitMatch('架构图-v3.png', '架构')).toEqual(['', '架构', '图-v3.png']);
    expect(splitMatch('IMG_4821.JPG', 'jpg')).toEqual(['IMG_4821.', 'JPG', '']);
    expect(splitMatch('设置', '图库')).toBeNull();
    expect(splitMatch('设置', '  ')).toBeNull();
  });

  // 交接说明 3.3：Windows / Linux 写 Ctrl+2，macOS 写 ⌘2（同设置 › 快捷键、投放区）
  it('writes the shortcut the way the rest of the app does', () => {
    expect(shortcutLabel('Mod 2', false)).toBe('Ctrl+2');
    expect(shortcutLabel('Mod ,', true)).toBe('⌘,');
    expect(shortcutLabel(undefined, true)).toBe('');
  });
});
