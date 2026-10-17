// 设置里那些「改了还要动系统状态」的项：先改系统，成功了才写配置；写配置失败再把系统改回去。
// 系统那一步失败时开关弹回、红色通知，不写配置（否则下次启动会按配置再去改系统，两边一直对不上）。
import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { ThemeMode } from '@/config/types';
import { useAnalytics } from '@/composables/useAnalytics';
import { useThemeManager } from '@/composables/useTheme';
import { useToast } from '@/composables/useToast';
import { getErrorMessage } from '@/types/errors';
import { createLogger } from '@/utils/logger';
import { useSettingsConfig } from './useSettingsConfig';

const log = createLogger('SettingsEffects');

/** 开机自启的真实状态以系统为准（用户可能在系统设置里关过），进入设置页时读一次 */
const autoStartActual = ref<boolean | null>(null);

async function setAutostart(enabled: boolean): Promise<void> {
  await invoke(enabled ? 'plugin:autostart|enable' : 'plugin:autostart|disable');
}

export function useSettingsEffects() {
  const settings = useSettingsConfig();
  const toast = useToast();

  async function readAutoStart(): Promise<void> {
    try {
      autoStartActual.value = await invoke<boolean>('plugin:autostart|is_enabled');
    } catch (error) {
      log.warn('读取开机自启状态失败，按配置显示', error);
      autoStartActual.value = null;
    }
  }

  async function changeAutoStart(enabled: boolean): Promise<void> {
    const previous = autoStartActual.value ?? settings.config.value.appBehavior?.autoStart ?? false;
    try {
      await setAutostart(enabled);
    } catch (error) {
      toast.error('未能更改开机自动启动', `${getErrorMessage(error) || '系统拒绝了这次更改'}，请重试`);
      return;
    }
    autoStartActual.value = enabled;
    const ok = await settings.patch('autoStart', (c) => { c.appBehavior = { ...defaultsOf(c), autoStart: enabled }; });
    if (ok) return;
    try {
      await setAutostart(previous);
      autoStartActual.value = previous;
    } catch (error) {
      log.error('开机自启回滚失败，系统与配置不一致', error);
    }
  }

  async function changeCloseToTray(enabled: boolean): Promise<void> {
    try {
      await invoke('set_close_to_tray', { enabled });
    } catch (error) {
      toast.error('未能更改关闭窗口时的行为', `${getErrorMessage(error) || '系统拒绝了这次更改'}，请重试`);
      return;
    }
    const ok = await settings.patch('closeToTray', (c) => { c.appBehavior = { ...defaultsOf(c), closeToTray: enabled }; });
    if (!ok) await invoke('set_close_to_tray', { enabled: !enabled }).catch((error) => log.warn('关闭到托盘回滚失败', error));
  }

  async function changeAnalytics(enabled: boolean): Promise<void> {
    const analytics = useAnalytics();
    try {
      if (enabled) await analytics.enable();
      else await analytics.disable();
    } catch (error) {
      log.warn('切换统计失败', error);
    }
    await settings.patch('analytics', (c) => { c.analytics = { enabled }; });
  }

  async function changeTheme(mode: ThemeMode): Promise<void> {
    // 主题由 ThemeManager 自己落盘（读最新配置、只改 theme），再刷新这一页手里的配置
    await useThemeManager().setTheme(mode);
    await settings.reload();
    if (settings.config.value.theme?.mode === mode) settings.flashSaved('theme');
  }

  return { autoStartActual, readAutoStart, changeAutoStart, changeCloseToTray, changeAnalytics, changeTheme };
}

function defaultsOf(c: { appBehavior?: { autoStart: boolean; minimizeToTrayOnStart: boolean; closeToTray: boolean } }) {
  return c.appBehavior ?? { autoStart: false, minimizeToTrayOnStart: false, closeToTray: true };
}
