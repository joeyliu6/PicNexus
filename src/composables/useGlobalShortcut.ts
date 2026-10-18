// 全局快捷键：在任何程序里按下组合键上传剪贴板图片 / 选择文件上传。
// 上传走应用级上传控制器（与首页、托盘同一条路）：进度在托盘与首页都看得到，复制规则一致；
// 主窗口不在屏时结果由系统通知告知（useToast → appPresence）。

import { register, unregisterAll, isRegistered, unregister } from '@tauri-apps/plugin-global-shortcut';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { listen } from '@tauri-apps/api/event';

import { readFreshConfig } from '@/store/instances';
import { DEFAULT_CONFIG, type GlobalShortcutConfig, type UserConfig } from '@/config/types';
import { useUploadController } from '@/composables/upload/useUploadController';
import { useToast } from '@/composables/useToast';
import { createLogger } from '@/utils/logger';
import { uiPlatform } from '@/utils/platform';
import { formatShortcut } from '@/utils/shortcutText';

const log = createLogger('GlobalShortcut');

let configUnlisten: UnlistenFn | null = null;
const registeredShortcuts = new Set<string>();
let lastShortcutConfig: GlobalShortcutConfig | null = null;
const notifiedConflicts = new Set<string>();

/**
 * 对比两个快捷键配置是否相等
 */
function isShortcutConfigEqual(a: GlobalShortcutConfig | null, b: GlobalShortcutConfig): boolean {
  if (!a) return false;
  return a.enabled === b.enabled &&
         a.uploadClipboard === b.uploadClipboard &&
         a.uploadFromFile === b.uploadFromFile;
}

/**
 * 每次注册都要用当前配置，而配置可能刚被别处（设置页、云同步）改过——走 readFreshConfig 绕开陈旧缓存。
 */
async function loadConfig(): Promise<UserConfig> {
  const loaded = await readFreshConfig(DEFAULT_CONFIG);
  return loaded || DEFAULT_CONFIG;
}

const handleClipboardUpload = () => useUploadController().pasteClipboard();
// 快捷键不是「点按钮选文件」这条慢路，不出「更快的方法」提示
const handleFileSelectUpload = () => useUploadController().pickAndUpload({ showHint: false });

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
          // Why: register 回调是同步签名，handler 返回的 Promise 抛异常会变成浏览器层 unhandledrejection，这里兜底记日志。
          shortcut.handler().catch((err) => log.error(`${shortcut.name} 执行异常:`, err));
        }
      });
      registeredShortcuts.add(shortcut.key);
      log.info(`${shortcut.name} 已注册: ${shortcut.key}`);
    } catch (err) {
      log.error(`${shortcut.name} 注册失败:`, err);
      // 避免重复通知同一个冲突快捷键
      if (!notifiedConflicts.has(shortcut.key)) {
        useToast().warn('全局快捷键未生效', `${formatShortcut(shortcut.key, uiPlatform())} 已被其他程序占用，请在 设置 › 快捷键 中更换`);
        notifiedConflicts.add(shortcut.key);
      }
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
    log.info('所有快捷键已注销');
  } catch (err) {
    log.error('注销失败:', err);
  }
}

/** 设置页录制快捷键期间：全局快捷键先注销，免得按到原组合键时系统直接触发上传、网页收不到按键 */
let suspended = false;

export async function suspendGlobalShortcuts(): Promise<void> {
  suspended = true;
  await unregisterAllShortcuts();
}

/** 录制结束：按当前配置重新注册（录到新值时配置已经写好） */
export async function resumeGlobalShortcuts(): Promise<void> {
  suspended = false;
  const config = await loadConfig();
  const shortcutConfig = config.globalShortcut || DEFAULT_CONFIG.globalShortcut!;
  await unregisterAllShortcuts();
  await registerShortcuts(shortcutConfig);
  lastShortcutConfig = JSON.parse(JSON.stringify(shortcutConfig));
}

/** 试注册一下：系统里别的程序占着这个组合键时注册会失败。试完立刻注销 */
export async function probeShortcut(accelerator: string): Promise<boolean> {
  try {
    await register(accelerator, () => {});
  } catch (err) {
    log.info(`快捷键 ${accelerator} 试注册失败`, err);
    return false;
  }
  await unregister(accelerator).catch((err) => log.warn(`试注册后注销 ${accelerator} 失败`, err));
  return true;
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
      // 保存初始配置快照
      lastShortcutConfig = JSON.parse(JSON.stringify(shortcutConfig));

      // 监听配置更新事件，动态重新注册
      configUnlisten = await listen('config-updated', async () => {
        // 设置页正在录制：先不注册，录制结束时 resumeGlobalShortcuts 按最新配置注册
        if (suspended) return;
        const newConfig = await loadConfig();
        const newShortcutConfig = newConfig.globalShortcut || DEFAULT_CONFIG.globalShortcut!;

        // 对比配置是否变化，只在变化时才重新注册
        if (isShortcutConfigEqual(lastShortcutConfig, newShortcutConfig)) {
          log.info('配置未变化，跳过重新注册');
          return;
        }

        log.info('配置已更新，重新注册快捷键...');
        // 配置变化时清空通知记录，允许新配置的冲突通知
        notifiedConflicts.clear();
        await unregisterAllShortcuts();
        await registerShortcuts(newShortcutConfig);
        // 更新配置快照
        lastShortcutConfig = JSON.parse(JSON.stringify(newShortcutConfig));
      });

      log.info('初始化完成');
    } catch (err) {
      log.error('初始化失败:', err);
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
  };
}
