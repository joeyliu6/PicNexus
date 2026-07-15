import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initLoginTheme } from '@/composables/useLoginTheme';

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

function setSearch(search: string) {
  window.history.replaceState(null, '', search ? `/${search}` : '/');
}

describe('initLoginTheme', () => {
  beforeEach(() => {
    setSearch('');
    document.documentElement.classList.remove('dark-theme', 'light-theme');
  });

  it('无 theme 参数 + 系统深色 → dark', async () => {
    mockMatchMedia(true);
    expect(await initLoginTheme()).toBe('dark');
    expect(document.documentElement.classList.contains('dark-theme')).toBe(true);
  });

  it('无 theme 参数 + 系统浅色 → light', async () => {
    mockMatchMedia(false);
    expect(await initLoginTheme()).toBe('light');
    expect(document.documentElement.classList.contains('light-theme')).toBe(true);
  });

  it('theme=light 固定 light', async () => {
    setSearch('?theme=light');
    mockMatchMedia(true);
    expect(await initLoginTheme()).toBe('light');
  });

  it('theme=dark 固定 dark', async () => {
    setSearch('?theme=dark');
    mockMatchMedia(false);
    expect(await initLoginTheme()).toBe('dark');
  });

  it('非法 theme 参数 → 回退 matchMedia', async () => {
    setSearch('?theme=../../dark');
    mockMatchMedia(true);
    expect(await initLoginTheme()).toBe('dark');
    expect(document.documentElement.classList.contains('dark-theme')).toBe(true);
  });

  it('theme=auto → 按系统主题处理', async () => {
    setSearch('?theme=auto');
    mockMatchMedia(false);
    expect(await initLoginTheme()).toBe('light');
  });
});
