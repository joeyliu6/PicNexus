import { nextTick, type Ref } from 'vue';
import { DEFAULT_CONFIG } from '@/config/types';
import type { SettingsFormData } from './settingsFormTypes';
import type { UserConfig } from '@/config/types';

interface ApplyConfigToFormOptions {
  formData: Ref<SettingsFormData>;
}

/** 恢复默认设置后把配置灌回设置页表单（图床部分不在表单里，图床页自己跟着配置变化） */
export async function applyConfigToForm(
  config: UserConfig,
  options: ApplyConfigToFormOptions,
): Promise<void> {
  const { formData } = options;
  formData.value.webdav = structuredClone(config.webdav || { profiles: [], activeId: null });
  formData.value.linkOutput = {
    ...DEFAULT_CONFIG.linkOutput!,
    ...(config.linkOutput || {}),
  };
  formData.value.analyticsEnabled = config.analytics?.enabled ?? DEFAULT_CONFIG.analytics?.enabled ?? true;
  formData.value.appBehavior = {
    ...(DEFAULT_CONFIG.appBehavior ?? { autoStart: false, minimizeToTrayOnStart: false, closeToTray: true }),
    ...(config.appBehavior || {}),
  };
  if (formData.value.appBehavior.closeToTray === undefined) formData.value.appBehavior.closeToTray = true;
  formData.value.autoUpdateEnabled = config.autoUpdate?.enabled ?? DEFAULT_CONFIG.autoUpdate?.enabled ?? true;
  formData.value.imageCompression = structuredClone(config.imageCompression ?? DEFAULT_CONFIG.imageCompression!);
  formData.value.editorServer = {
    ...structuredClone(DEFAULT_CONFIG.editorServer!),
    ...(config.editorServer || {}),
  };
  formData.value.globalShortcut = {
    ...structuredClone(DEFAULT_CONFIG.globalShortcut!),
    ...(config.globalShortcut || {}),
  };
  await nextTick();
}
