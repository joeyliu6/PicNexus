import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeManager } from '@/theme/ThemeManager';
import type { Store } from '@/store';
import type { UserConfig } from '@/config/types';

function makeStore(): Store {
  return { set: vi.fn().mockResolvedValue(undefined), save: vi.fn().mockResolvedValue(undefined) } as unknown as Store;
}

describe('ThemeManager', () => {
  afterEach(() => {
    const root = document.documentElement;
    root.classList.remove('dark-theme', 'light-theme');
    delete root.dataset.theme;
  });

  it('marks the root with data-theme so --pn-* tokens follow the theme', async () => {
    const manager = new ThemeManager({ theme: { mode: 'dark' } } as UserConfig, makeStore());
    manager.initialize();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark-theme')).toBe(true);

    await manager.setTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.classList.contains('light-theme')).toBe(true);
    manager.destroy();
  });
});
