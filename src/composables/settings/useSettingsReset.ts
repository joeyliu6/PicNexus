import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '../useToast';
import { useConfirm } from '../useConfirm';
import { useThemeManager } from '../useTheme';
import { useAnalytics } from '../useAnalytics';
import { DEFAULT_CONFIG } from '../../config/types';
import type { EditorServerConfig, UserConfig } from '../../config/types';

type AppBehaviorState = NonNullable<UserConfig['appBehavior']>;

interface ResetFormRef {
  value: {
    appBehavior: AppBehaviorState;
  };
}

interface UseSettingsResetOptions {
  formData: ResetFormRef;
  cancelDebouncedSave: () => void;
  resetToDefaultSettings: (config?: UserConfig) => Promise<boolean>;
  loadSettings: () => Promise<void>;
  errorToString: (error: unknown) => string;
  applyEditorServer: (config: EditorServerConfig, options?: { force?: boolean }) => Promise<boolean>;
}

function isMissingAutostartEntry(error: unknown, errorToString: (error: unknown) => string): boolean {
  const message = errorToString(error);
  return message.includes('os error 2') || message.includes('系统找不到指定的文件');
}

async function applyAppBehaviorSideEffects(
  target: AppBehaviorState,
  previous: AppBehaviorState | null,
  errorToString: (error: unknown) => string,
) {
  if (!previous || target.autoStart !== previous.autoStart) {
    try {
      await invoke(target.autoStart ? 'plugin:autostart|enable' : 'plugin:autostart|disable');
    } catch (error) {
      if (target.autoStart || !isMissingAutostartEntry(error, errorToString)) throw error;
    }
  }

  if (!previous || target.closeToTray !== previous.closeToTray) {
    await invoke('set_close_to_tray', { enabled: target.closeToTray });
  }
}

function createDefaultResetConfig(): UserConfig {
  const defaultConfig = structuredClone(DEFAULT_CONFIG);
  defaultConfig.onboardingCompleted = false;
  return defaultConfig;
}

export function useSettingsReset(options: UseSettingsResetOptions) {
  const toast = useToast();
  const analytics = useAnalytics();
  const { confirm: confirmDialog } = useConfirm();
  const { updateConfig: updateThemeConfig } = useThemeManager();
  const isResettingDefaults = ref(false);

  async function handleResetDefaults() {
    const confirmed = await confirmDialog(
      '将恢复所有应用配置为默认值，并清空图床密钥、Cookie、WebDAV、快捷键、主题、压缩和链接输出等设置。上传历史记录和应用缓存会保留。',
      {
        header: '恢复默认设置',
        acceptLabel: '恢复默认',
        acceptClass: 'p-button-warning',
      }
    );
    if (!confirmed) return;

    const previousAppBehavior = { ...options.formData.value.appBehavior };
    const defaultConfig = createDefaultResetConfig();
    const defaultAppBehavior = defaultConfig.appBehavior ?? DEFAULT_CONFIG.appBehavior!;

    options.cancelDebouncedSave();
    isResettingDefaults.value = true;

    try {
      try {
        await applyAppBehaviorSideEffects(defaultAppBehavior, previousAppBehavior, options.errorToString);
      } catch (error) {
        try {
          await applyAppBehaviorSideEffects(previousAppBehavior, defaultAppBehavior, options.errorToString);
        } catch (rollbackError) {
          toast.showConfig('warn', {
            summary: '外部状态回滚失败',
            detail: options.errorToString(rollbackError),
          });
        }
        throw error;
      }

      const resetOk = await options.resetToDefaultSettings(defaultConfig);
      if (!resetOk) {
        try {
          await applyAppBehaviorSideEffects(previousAppBehavior, defaultAppBehavior, options.errorToString);
          await options.loadSettings();
        } catch (rollbackError) {
          toast.showConfig('warn', {
            summary: '外部状态回滚失败',
            detail: options.errorToString(rollbackError),
          });
        }
        return;
      }

      updateThemeConfig(defaultConfig);
      if (defaultConfig.analytics?.enabled === false) await analytics.disable();
      else await analytics.enable();

      const editorApplied = await options.applyEditorServer(
        defaultConfig.editorServer ?? DEFAULT_CONFIG.editorServer!,
        { force: true },
      );
      if (editorApplied === false) {
        toast.showConfig('warn', {
          summary: '默认设置已恢复',
          detail: '编辑器集成状态同步失败，请稍后在高级设置中检查。',
        });
        return;
      }

      toast.showConfig('success', {
        summary: '已恢复默认设置',
        detail: '应用配置已恢复为初始状态，上传历史记录和缓存已保留。',
      });
    } catch (error) {
      toast.showConfig('error', {
        summary: '恢复默认设置失败',
        detail: options.errorToString(error),
      });
    } finally {
      isResettingDefaults.value = false;
    }
  }

  return {
    isResettingDefaults,
    handleResetDefaults,
  };
}
