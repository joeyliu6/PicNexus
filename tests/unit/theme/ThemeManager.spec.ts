import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeManager } from '@/theme/ThemeManager';
import type { Store } from '@/store';
import type { UserConfig } from '@/config/types';

function makeStore(): Store {
  return { set: vi.fn().mockResolvedValue(undefined), save: vi.fn().mockResolvedValue(undefined) } as unknown as Store;
}

describe('ThemeManager', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it('marks the root with data-theme so --pn-* tokens follow the theme', async () => {
    const manager = new ThemeManager({ theme: { mode: 'dark' } } as UserConfig, makeStore());
    manager.initialize();
    expect(document.documentElement.dataset.theme).toBe('dark');

    await manager.setTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    manager.destroy();
  });

  it('pauses every transition for the frame the theme changes in, so all colours switch together', async () => {
    // 带颜色过渡的元素会慢半拍（深色第一帧侧栏字还是深灰、压在深底上看不见），切主题那一帧全应用不放过渡
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const manager = new ThemeManager({ theme: { mode: 'light' } } as UserConfig, makeStore());
    manager.initialize();
    await nextFrame();
    expect(document.documentElement.classList.contains('pn-theme-switching')).toBe(false);

    await manager.setTheme('dark');
    expect(document.documentElement.classList.contains('pn-theme-switching')).toBe(true);
    await nextFrame();
    expect(document.documentElement.classList.contains('pn-theme-switching')).toBe(false);
    manager.destroy();
  });

  it('writes the theme onto the latest saved config, not the copy it was created with', async () => {
    // 云同步、导入配置直接写 store、不发 config-updated：手里那份是启动时的旧副本，整份写回会把它们盖掉
    const fresh = { theme: { mode: 'dark', enableTransitions: false }, enabledServices: ['jd', 'r2'] } as unknown as UserConfig;
    const store = { ...makeStore(), get: vi.fn().mockResolvedValue(fresh) } as unknown as Store;
    const manager = new ThemeManager({ theme: { mode: 'dark' }, enabledServices: ['jd'] } as UserConfig, store);
    manager.initialize();

    await manager.setTheme('light');

    const written = (store.set as ReturnType<typeof vi.fn>).mock.calls[0][1] as UserConfig;
    expect(written.enabledServices).toEqual(['jd', 'r2']);
    expect(written.theme?.mode).toBe('light');
    expect(written.theme?.enableTransitions).toBe(false);
    manager.destroy();
  });
});
