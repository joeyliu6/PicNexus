// 设置页的副作用动作集：主题、系统行为开关、统计开关、缓存清理、备份 WebDAV 测试。
// 这些动作的共性是「改 formData 之外还要碰系统状态或后端」，且都要处理失败回滚/提示；
// 纯表单读写仍归 useSettingsForm，图床连接测试归 useConnectionTest。

import { ref, type Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useToast } from '../useToast';
import { useThemeManager } from '../useTheme';
import { useAnalytics } from '../useAnalytics';
import { useConfigManager } from '../useConfig';
import { TOAST_MESSAGES } from '../../constants';
import { WebDAVClient } from '../../utils/webdav';
import type { ThemeMode } from '../../config/types';
import type { SettingsFormData } from './settingsFormTypes';

interface UseSettingsActionsOptions {
  formData: Ref<SettingsFormData>;
  saveSettings: () => Promise<boolean>;
  cancelDebouncedSave: () => void;
}

export function useSettingsActions(options: UseSettingsActionsOptions) {
  const { formData, saveSettings, cancelDebouncedSave } = options;
  const toast = useToast();
  const analytics = useAnalytics();
  const configManager = useConfigManager();
  const { setTheme } = useThemeManager();

  const isClearingCache = ref(false);
  const webdavTesting = ref(false);

  async function handleThemeChange(mode: ThemeMode) {
    try { await setTheme(mode); }
    catch (e) { toast.showConfig('error', TOAST_MESSAGES.config.saveFailed(String(e))); }
  }

  async function handleAutoStartChange(enabled: boolean) {
    // Why: OS 侧（autostart 插件）与磁盘配置必须同步落地。旧逻辑把 saveSettings 放在
    //   try/catch 外，invoke 成功但 saveSettings 失败时会出现"OS 已改、disk 未改"漂移，
    //   重启后 initialize 读旧 config 又尝试改 OS 状态，形成二次不一致。
    // saveSettings 内部吞异常，以 boolean 返回成败；所以这里用返回值而非 try/catch。
    const prev = formData.value.appBehavior.autoStart;
    formData.value.appBehavior.autoStart = enabled;
    try {
      await invoke(enabled ? 'plugin:autostart|enable' : 'plugin:autostart|disable');
    } catch (e) {
      toast.showConfig('error', TOAST_MESSAGES.config.saveFailed(String(e)));
      formData.value.appBehavior.autoStart = prev;
      return;
    }
    const saved = await saveSettings();
    if (!saved) {
      // 磁盘写入失败：回滚 OS 状态以保持一致（saveSettings 已 toast 过错误原因）
      try {
        await invoke(prev ? 'plugin:autostart|enable' : 'plugin:autostart|disable');
      } catch (e) {
        // 回滚也失败 → OS 与磁盘配置已不一致，必须告知用户
        // Why: 静默吞异常会让用户后续重启时遇到"我明明关了为什么还自启"的迷惑
        toast.showConfig('error', {
          summary: '自启动状态不一致',
          detail: `操作系统与配置文件状态可能不同步：${String(e)}。建议重启应用后手动调整。`,
          life: 8000,
        });
      }
      formData.value.appBehavior.autoStart = prev;
    }
  }

  async function handleCloseToTrayChange(enabled: boolean) {
    formData.value.appBehavior.closeToTray = enabled;
    await invoke('set_close_to_tray', { enabled });
    saveSettings();
  }

  async function handleAnalyticsToggle() {
    const enabled = formData.value.analyticsEnabled;
    if (enabled) {
      await analytics.enable();
    } else {
      await analytics.disable();
    }

    // 快速连续切换时，旧操作不得用过期状态覆盖最后一次选择。
    if (formData.value.analyticsEnabled === enabled) {
      await saveSettings();
    }
  }

  async function handleClearAppCache() {
    isClearingCache.value = true;
    try {
      await getCurrentWebview().clearAllBrowsingData();
      toast.showConfig('success', TOAST_MESSAGES.cache.clearSuccess);
    } catch (error) {
      toast.showConfig('error', TOAST_MESSAGES.cache.clearFailed(String(error)));
    } finally { isClearingCache.value = false; }
  }

  async function handleWebDAVTest() {
    const webdav = formData.value.webdav;
    const profile = webdav.profiles.find(p => p.id === webdav.activeId);
    if (!profile) return;

    // 备份密码在 formData 里是密文（老配置可能还留着明文），两者有其一就算填过了
    if (!profile.url || !profile.username || !(profile.password || profile.passwordEncrypted)) {
      toast.showConfig('error', TOAST_MESSAGES.auth.failed('WebDAV', '请先补全服务器 URL、用户名和密码'));
      return;
    }

    // 这里绕开了 fromEncryptedConfig，得自己把密文解开——testWebDAVConnection 要的是明文
    let password = profile.password || '';
    if (profile.passwordEncrypted) {
      password = await WebDAVClient.decryptPassword(profile.passwordEncrypted);
      if (!password) {
        toast.showConfig('error', TOAST_MESSAGES.auth.failed('WebDAV', '密码解密失败，请重新输入密码后再测试'));
        return;
      }
    }

    cancelDebouncedSave();
    webdavTesting.value = true;
    try {
      const result = await configManager.testWebDAVConnection({
        url: profile.url,
        username: profile.username,
        password,
        remotePath: profile.remotePath || '/PicNexus/',
      });

      const currentWebDAV = formData.value.webdav;
      formData.value.webdav = {
        ...currentWebDAV,
        profiles: currentWebDAV.profiles.map(p => p.id === profile.id
          ? {
              ...p,
              connectionStatus: result.success ? 'success' : 'failed',
              lastTestedAt: Date.now(),
              lastError: result.success ? undefined : result.message,
            }
          : p),
      };

      toast.showConfig(
        result.success ? 'success' : 'error',
        result.success
          ? TOAST_MESSAGES.auth.success('WebDAV')
          : TOAST_MESSAGES.auth.failed('WebDAV', result.message)
      );

      await saveSettings();
    } finally {
      webdavTesting.value = false;
    }
  }

  return {
    isClearingCache,
    webdavTesting,
    handleThemeChange,
    handleAutoStartChange,
    handleCloseToTrayChange,
    handleAnalyticsToggle,
    handleClearAppCache,
    handleWebDAVTest,
  };
}
