// 全局快捷键管理 - 在任何应用中通过快捷键触发上传

import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { register, unregisterAll, isRegistered, unregister } from '@tauri-apps/plugin-global-shortcut';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { basename, resolveResource } from '@tauri-apps/api/path';

import { configStore } from '../store/instances';
import {
  UserConfig,
  DEFAULT_CONFIG,
  GlobalShortcutConfig,
} from '../config/types';
import type { ServiceType } from '../config/types';
import { MultiServiceUploader, SingleServiceResult } from '../core/MultiServiceUploader';
import { useHistorySaver } from './useHistorySaver';
import { formatLinkWithConfig, getLinkFormatConfig } from './useCopyLink';
import { buildUploadSummaryToast, type UploadCopySummary } from '../utils/uploadSummary';

const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];

const isUploading = ref(false);
let configUnlisten: UnlistenFn | null = null;
const registeredShortcuts = new Set<string>();

async function notify(title: string, body: string) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === 'granted';
    }
    if (granted) {
      const icon = await resolveResource('icons/icon.png');
      sendNotification({ title, body, icon });
    }
  } catch (err) {
    console.error('[全局快捷键] 通知发送失败:', err);
  }
}

async function loadConfig(): Promise<UserConfig> {
  const loaded = await configStore.get<UserConfig>('config', DEFAULT_CONFIG);
  return loaded || DEFAULT_CONFIG;
}

async function getFileName(filePath: string): Promise<string> {
  try {
    return await basename(filePath);
  } catch {
    return filePath.split(/[/\\]/).pop() || '未知文件';
  }
}

/**
 * 后台上传单个文件到所有启用的图床
 */
interface UploadResult {
  primaryUrl: string;
  primaryService: ServiceType;
}

async function uploadFileInBackground(filePath: string, config: UserConfig): Promise<UploadResult | null> {
  const uploader = new MultiServiceUploader();
  const historySaver = useHistorySaver();

  const enabledServices = config.enabledServices || [];
  if (enabledServices.length === 0) {
    await notify('PicNexus', '没有启用任何图床，请先配置');
    return null;
  }

  const historyId = crypto.randomUUID();
  let firstSaved = false;

  const result = await uploader.uploadToMultipleServices(
    filePath,
    enabledServices,
    config,
    undefined,
    async (serviceResult: SingleServiceResult) => {
      if (serviceResult.status === 'success' && !firstSaved) {
        firstSaved = true;
        try {
          await historySaver.saveHistoryItemImmediate(filePath, serviceResult, historyId);
        } catch (err) {
          console.error('[全局快捷键] 保存历史记录失败:', err);
        }
      } else if (serviceResult.status === 'success' && firstSaved) {
        try {
          await historySaver.addResultToHistoryItem(historyId, serviceResult);
        } catch (err) {
          console.error('[全局快捷键] 追加历史记录失败:', err);
        }
      }
    }
  );

  if (!result.primaryUrl) return null;
  return {
    primaryUrl: result.primaryUrl,
    primaryService: result.primaryService as ServiceType,
  };
}

async function withUploadGuard(label: string, fn: () => Promise<void>) {
  if (isUploading.value) {
    await notify('PicNexus', '正在上传中，请稍候...');
    return;
  }
  isUploading.value = true;
  try {
    await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[全局快捷键] ${label}失败:`, err);
    await notify('上传失败', msg);
  } finally {
    isUploading.value = false;
  }
}

async function formatLinkForShortcut(
  primaryUrl: string,
  filePath: string,
  config: UserConfig,
  serviceId?: ServiceType
): Promise<string> {
  const fileName = await getFileName(filePath);
  return formatLinkWithConfig({ url: primaryUrl, fileName, serviceId }, config);
}

function createShortcutCopySummary(config: UserConfig, autoCopyEnabled: boolean): UploadCopySummary {
  const { format } = getLinkFormatConfig(config);
  return {
    autoCopyEnabled,
    copiedCount: 0,
    format,
    copyFailed: false,
  };
}

async function notifyUploadSummary(total: number, success: number, copy: UploadCopySummary): Promise<void> {
  const payload = buildUploadSummaryToast({
    total,
    success,
    failed: Math.max(0, total - success),
  }, copy);
  if (!payload) return;
  await notify(payload.summary, payload.detail);
}

const handleClipboardUpload = () => withUploadGuard('剪贴板上传', async () => {
  const hasImage = await invoke<boolean>('clipboard_has_image');
  if (!hasImage) {
    await notify('PicNexus', '剪贴板中没有图片');
    return;
  }

  const tempFilePath = await invoke<string>('read_clipboard_image');
  const config = await loadConfig();
  const uploadResult = await uploadFileInBackground(tempFilePath, config);
  if (!uploadResult) return;

  const linkOutput = config.linkOutput || DEFAULT_CONFIG.linkOutput!;
  const autoCopyEnabled = linkOutput.autoCopy !== false;
  const copySummary = createShortcutCopySummary(config, autoCopyEnabled);
  const formatted = await formatLinkForShortcut(uploadResult.primaryUrl, tempFilePath, config, uploadResult.primaryService);
  if (autoCopyEnabled) {
    try {
      await writeText(formatted);
      copySummary.copiedCount = 1;
    } catch (err) {
      copySummary.copyFailed = true;
      console.error('[全局快捷键] 自动复制失败:', err);
    }
  }
  await notifyUploadSummary(1, 1, copySummary);
});

const handleFileSelectUpload = () => withUploadGuard('文件选择上传', async () => {
  const selected = await dialogOpen({
    multiple: true,
    filters: [{ name: '图片', extensions: ALLOWED_EXTENSIONS }],
  });

  const filePaths = Array.isArray(selected) ? selected : selected ? [selected] : [];
  if (filePaths.length === 0) return;

  const config = await loadConfig();
  const linkOutput = config.linkOutput || DEFAULT_CONFIG.linkOutput!;
  const autoCopyEnabled = linkOutput.autoCopy !== false;
  const copySummary = createShortcutCopySummary(config, autoCopyEnabled);
  const allLinks: string[] = [];

  for (const filePath of filePaths) {
    try {
      const uploadResult = await uploadFileInBackground(filePath, config);
      if (uploadResult) {
        const formatted = await formatLinkForShortcut(
          uploadResult.primaryUrl, filePath, config, uploadResult.primaryService
        );
        allLinks.push(formatted);
      }
    } catch (err) {
      console.error(`[全局快捷键] 文件上传失败: ${filePath}`, err);
    }
  }

  if (allLinks.length > 0 && autoCopyEnabled) {
    try {
      await writeText(allLinks.join('\n'));
      copySummary.copiedCount = allLinks.length;
    } catch (err) {
      copySummary.copyFailed = true;
      console.error('[全局快捷键] 自动复制失败:', err);
    }
  }

  if (allLinks.length === 0) {
    await notify('上传失败', '所有文件上传均失败');
    return;
  }

  await notifyUploadSummary(filePaths.length, allLinks.length, copySummary);
});

/**
 * 注册全局快捷键
 */
async function registerShortcuts(shortcutConfig: GlobalShortcutConfig) {
  if (!shortcutConfig.enabled) return;

  const shortcuts = [
    { key: shortcutConfig.uploadClipboard, handler: handleClipboardUpload, name: '剪贴板上传' },
    { key: shortcutConfig.uploadFromFile, handler: handleFileSelectUpload, name: '文件选择上传' },
  ];

  for (const shortcut of shortcuts) {
    if (!shortcut.key) continue;

    try {
      const alreadyRegistered = await isRegistered(shortcut.key);
      if (alreadyRegistered) {
        await unregister(shortcut.key);
      }
      await register(shortcut.key, (event) => {
        if (event.state === 'Pressed') {
          shortcut.handler();
        }
      });
      registeredShortcuts.add(shortcut.key);
      console.log(`[全局快捷键] ${shortcut.name} 已注册: ${shortcut.key}`);
    } catch (err) {
      console.error(`[全局快捷键] ${shortcut.name} 注册失败:`, err);
      await notify('PicNexus', `快捷键 ${shortcut.key} 注册失败，可能与其他应用冲突`);
    }
  }
}

/**
 * 注销所有已注册的快捷键
 */
async function unregisterAllShortcuts() {
  try {
    await unregisterAll();
    registeredShortcuts.clear();
    console.log('[全局快捷键] 所有快捷键已注销');
  } catch (err) {
    console.error('[全局快捷键] 注销失败:', err);
  }
}

/**
 * 全局快捷键 Composable
 */
export function useGlobalShortcut() {
  /**
   * 初始化全局快捷键（App.vue onMounted 调用）
   */
  async function initGlobalShortcuts() {
    try {
      const config = await loadConfig();
      const shortcutConfig = config.globalShortcut || DEFAULT_CONFIG.globalShortcut!;

      await registerShortcuts(shortcutConfig);

      // 监听配置更新事件，动态重新注册
      configUnlisten = await listen('config-updated', async () => {
        console.log('[全局快捷键] 配置已更新，重新注册快捷键...');
        await unregisterAllShortcuts();
        const newConfig = await loadConfig();
        const newShortcutConfig = newConfig.globalShortcut || DEFAULT_CONFIG.globalShortcut!;
        await registerShortcuts(newShortcutConfig);
      });

      console.log('[全局快捷键] 初始化完成');
    } catch (err) {
      console.error('[全局快捷键] 初始化失败:', err);
    }
  }

  /**
   * 清理（App.vue onUnmounted 调用）
   */
  async function cleanup() {
    if (configUnlisten) {
      configUnlisten();
      configUnlisten = null;
    }
    await unregisterAllShortcuts();
  }

  return {
    initGlobalShortcuts,
    cleanup,
    isUploading,
  };
}
