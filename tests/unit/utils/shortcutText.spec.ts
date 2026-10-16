import { describe, expect, it } from 'vitest';
import { formatShortcut } from '@/utils/shortcutText';

describe('formatShortcut', () => {
  it('writes Ctrl+Shift+C on Windows and Linux', () => {
    expect(formatShortcut('CommandOrControl+Shift+C', 'windows')).toBe('Ctrl+Shift+C');
    expect(formatShortcut('CommandOrControl+Shift+O', 'linux')).toBe('Ctrl+Shift+O');
  });

  it('writes the macOS symbols in system order', () => {
    expect(formatShortcut('CommandOrControl+Shift+C', 'macos')).toBe('⇧⌘C');
    expect(formatShortcut('Alt+CommandOrControl+k', 'macos')).toBe('⌥⌘K');
  });

  it('keeps an empty accelerator empty', () => {
    expect(formatShortcut('', 'windows')).toBe('');
  });
});
