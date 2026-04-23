import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../store/instances', () => ({
  configStore: { get: vi.fn() },
  syncStatusStore: { get: vi.fn(), set: vi.fn(), save: vi.fn() },
}));

import { configStore } from '../../../store/instances';
import { initLoginTheme } from '../../../composables/useLoginTheme';

const configStoreMock = vi.mocked(configStore);

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

describe('initLoginTheme', () => {
  beforeEach(() => {
    (configStoreMock.get as any).mockReset();
    document.documentElement.classList.remove('dark-theme', 'light-theme');
  });

  it('mode=auto + 系统深色 → dark', async () => {
    (configStoreMock.get as any).mockResolvedValue({ theme: { mode: 'auto' } });
    mockMatchMedia(true);
    expect(await initLoginTheme()).toBe('dark');
    expect(document.documentElement.classList.contains('dark-theme')).toBe(true);
  });

  it('mode=auto + 系统浅色 → light', async () => {
    (configStoreMock.get as any).mockResolvedValue({ theme: { mode: 'auto' } });
    mockMatchMedia(false);
    expect(await initLoginTheme()).toBe('light');
    expect(document.documentElement.classList.contains('light-theme')).toBe(true);
  });

  it('mode=light 固定 light', async () => {
    (configStoreMock.get as any).mockResolvedValue({ theme: { mode: 'light' } });
    mockMatchMedia(true);
    expect(await initLoginTheme()).toBe('light');
  });

  it('mode=dark 固定 dark', async () => {
    (configStoreMock.get as any).mockResolvedValue({ theme: { mode: 'dark' } });
    mockMatchMedia(false);
    expect(await initLoginTheme()).toBe('dark');
  });

  it('configStore 读取失败 → 回退 matchMedia', async () => {
    (configStoreMock.get as any).mockRejectedValue(new Error('store gone'));
    mockMatchMedia(true);
    expect(await initLoginTheme()).toBe('dark');
    expect(document.documentElement.classList.contains('dark-theme')).toBe(true);
  });

  it('config 无 theme 字段 → 按 auto 处理', async () => {
    (configStoreMock.get as any).mockResolvedValue({});
    mockMatchMedia(false);
    expect(await initLoginTheme()).toBe('light');
  });

  it('config 为空 → 按 auto 处理', async () => {
    (configStoreMock.get as any).mockResolvedValue(null);
    mockMatchMedia(true);
    expect(await initLoginTheme()).toBe('dark');
  });
});
