import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  patch: vi.fn(),
  toastError: vi.fn(),
  applyEditor: vi.fn(),
  updateTheme: vi.fn(),
  config: { value: { appBehavior: { autoStart: false, minimizeToTrayOnStart: false, closeToTray: true } } },
}));

vi.mock('@/views/settings/useSettingsConfig', () => ({
  useSettingsConfig: () => ({ config: state.config, patch: state.patch, reload: vi.fn(), flashSaved: vi.fn() }),
}));
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ error: state.toastError }) }));
vi.mock('@/composables/useAnalytics', () => ({ useAnalytics: () => ({ enable: vi.fn(async () => undefined), disable: vi.fn(async () => undefined) }) }));
vi.mock('@/composables/useTheme', () => ({ useThemeManager: () => ({ setTheme: vi.fn(), updateConfig: state.updateTheme }) }));
vi.mock('@/composables/settings/editorSync', () => ({ applyEditorConfig: state.applyEditor }));
vi.mock('@/store/instances', () => ({ readFreshConfig: vi.fn(async () => ({ theme: { mode: 'auto' } })) }));

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

describe('settingsEffects · 恢复默认设置', () => {
  beforeEach(() => {
    resetTauriMocks();
    state.patch.mockReset().mockResolvedValue(true);
    state.applyEditor.mockReset().mockResolvedValue({ ok: true });
    state.updateTheme.mockReset();
  });

  it('先写回默认偏好，再让系统跟上：开机自启原来开着就关掉，关闭到托盘、主题、编辑器服务重新下发', async () => {
    const effects = useSettingsEffects();
    effects.autoStartActual.value = true;
    await expect(effects.resetAll()).resolves.toBe(true);
    expect(state.patch).toHaveBeenCalledWith('resetDefaults', expect.any(Function));
    expect(getInvokeMock()).toHaveBeenCalledWith('plugin:autostart|disable');
    expect(effects.autoStartActual.value).toBe(false);
    expect(getInvokeMock()).toHaveBeenCalledWith('set_close_to_tray', { enabled: true });
    expect(state.updateTheme).toHaveBeenCalled();
    expect(state.applyEditor).toHaveBeenCalled();
  });

  it('开机自启本来就是关的：不去动系统的启动项', async () => {
    const effects = useSettingsEffects();
    effects.autoStartActual.value = false;
    await effects.resetAll();
    expect(getInvokeMock()).not.toHaveBeenCalledWith('plugin:autostart|disable');
  });

  it('系统那一步失败不算恢复失败（默认偏好已经写进去了）', async () => {
    getInvokeMock().mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin:autostart|disable') throw new Error('启动项不存在');
      return undefined;
    });
    const effects = useSettingsEffects();
    effects.autoStartActual.value = true;
    await expect(effects.resetAll()).resolves.toBe(true);
    expect(state.applyEditor).toHaveBeenCalled();
  });

  it('默认偏好没写进去：系统一样都不动', async () => {
    state.patch.mockResolvedValueOnce(false);
    const effects = useSettingsEffects();
    effects.autoStartActual.value = true;
    await expect(effects.resetAll()).resolves.toBe(false);
    expect(getInvokeMock()).not.toHaveBeenCalled();
    expect(state.applyEditor).not.toHaveBeenCalled();
  });
});
