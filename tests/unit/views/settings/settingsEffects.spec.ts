import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  patch: vi.fn(),
  toastError: vi.fn(),
  config: { value: { appBehavior: { autoStart: false, minimizeToTrayOnStart: false, closeToTray: true } } },
}));

vi.mock('@/views/settings/useSettingsConfig', () => ({
  useSettingsConfig: () => ({ config: state.config, patch: state.patch, reload: vi.fn(), flashSaved: vi.fn() }),
}));
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ error: state.toastError }) }));
vi.mock('@/composables/useAnalytics', () => ({ useAnalytics: () => ({ enable: vi.fn(), disable: vi.fn() }) }));
vi.mock('@/composables/useTheme', () => ({ useThemeManager: () => ({ setTheme: vi.fn() }) }));

import { useSettingsEffects } from '@/views/settings/settingsEffects';
import { getInvokeMock, resetTauriMocks } from '../../helpers/tauriMock';

describe('settingsEffects · 开机自动启动', () => {
  beforeEach(() => {
    resetTauriMocks();
    state.patch.mockReset().mockResolvedValue(true);
    state.toastError.mockReset();
  });

  it('turns the system autostart on first, then saves the setting', async () => {
    const effects = useSettingsEffects();
    await effects.changeAutoStart(true);
    expect(getInvokeMock()).toHaveBeenCalledWith('plugin:autostart|enable');
    expect(state.patch).toHaveBeenCalledWith('autoStart', expect.any(Function));
    expect(effects.autoStartActual.value).toBe(true);
  });

  it('does not save when the system refuses, and says so in red', async () => {
    getInvokeMock().mockRejectedValueOnce(new Error('拒绝访问'));
    const effects = useSettingsEffects();
    await effects.changeAutoStart(true);
    expect(state.patch).not.toHaveBeenCalled();
    expect(state.toastError).toHaveBeenCalledWith('未能更改开机自动启动', '拒绝访问，请重试');
  });

  it('puts the system back when the setting cannot be saved', async () => {
    state.patch.mockResolvedValueOnce(false);
    const effects = useSettingsEffects();
    effects.autoStartActual.value = false;
    await effects.changeAutoStart(true);
    expect(getInvokeMock()).toHaveBeenNthCalledWith(1, 'plugin:autostart|enable');
    expect(getInvokeMock()).toHaveBeenNthCalledWith(2, 'plugin:autostart|disable');
    expect(effects.autoStartActual.value).toBe(false);
  });
});
