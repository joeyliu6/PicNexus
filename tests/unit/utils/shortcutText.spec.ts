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

  it('writes punctuation and arrow keys as symbols, not their key names', () => {
    expect(formatShortcut('CommandOrControl+Comma', 'windows')).toBe('Ctrl+,');
    expect(formatShortcut('CommandOrControl+Backslash', 'macos')).toBe('⌘\\');
    expect(formatShortcut('Alt+Shift+Up', 'linux')).toBe('Alt+Shift+↑');
  });

  it('calls the Super key Win on Windows and Super on Linux', () => {
    expect(formatShortcut('Super+Shift+C', 'windows')).toBe('Shift+Win+C');
    expect(formatShortcut('Super+Shift+C', 'linux')).toBe('Shift+Super+C');
  });

  it('keeps an empty accelerator empty', () => {
    expect(formatShortcut('', 'windows')).toBe('');
  });
});
