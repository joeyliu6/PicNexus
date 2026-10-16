import { describe, expect, it } from 'vitest';
import { shortcutLabel, splitMatch } from '@/shell/commandIndex';

describe('commandIndex', () => {
  it('splits a label around the first case-insensitive match', () => {
    expect(splitMatch('架构图-v3.png', '架构')).toEqual(['', '架构', '图-v3.png']);
    expect(splitMatch('IMG_4821.JPG', 'jpg')).toEqual(['IMG_4821.', 'JPG', '']);
    expect(splitMatch('设置', '图库')).toBeNull();
    expect(splitMatch('设置', '  ')).toBeNull();
  });

  it('writes the modifier per platform', () => {
    expect(shortcutLabel('Mod 2', false)).toBe('Ctrl 2');
    expect(shortcutLabel('Mod ,', true)).toBe('⌘ ,');
    expect(shortcutLabel(undefined, true)).toBe('');
  });
});
