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

  it('writes the theme onto the latest saved config, not the copy it was created with', async () => {
    // 云同步、导入配置直接写 store、不发 config-updated：手里那份是启动时的旧副本，整份写回会把它们盖掉
    const fresh = { theme: { mode: 'dark', homeDecor: false }, enabledServices: ['jd', 'r2'] } as unknown as UserConfig;
    const store = { ...makeStore(), get: vi.fn().mockResolvedValue(fresh) } as unknown as Store;
    const manager = new ThemeManager({ theme: { mode: 'dark' }, enabledServices: ['jd'] } as UserConfig, store);
    manager.initialize();

    await manager.setTheme('light');

    const written = (store.set as ReturnType<typeof vi.fn>).mock.calls[0][1] as UserConfig & { theme: { homeDecor?: boolean } };
    expect(written.enabledServices).toEqual(['jd', 'r2']);
    expect(written.theme.mode).toBe('light');
    expect(written.theme.homeDecor).toBe(false);
    manager.destroy();
  });
});
