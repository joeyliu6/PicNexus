// 托盘（交接说明 8.6，T01–T08）：应用开着就在，装在外壳里。
// 菜单由 trayMenuModel 从「上传控制器」的配置、图床与进度推出来——和首页「上传到」、设置页读写的是同一份配置，
// 任何一处改了，这里跟着重画；菜单里点了什么，也交给同一个控制器 / 设置页的保存入口去改。
// 上传在后台进行，不打开主界面；结果由系统通知告知（useToast → appPresence）。

import { computed, ref, watch, type WatchStopHandle } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { emit as tauriEmit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { exit } from '@tauri-apps/plugin-process';
import { DEFAULT_CONFIG, isPublicRiskService } from '@/config/types';
import type { UploadController } from '@/composables/upload/useUploadController';
import { CLIPBOARD_IMAGE_EVENT } from '@/composables/upload/clipboardWatch';
import { clipboardHasUploadable } from '@/composables/upload/useClipboardImage';
import { refreshAppPresence } from '@/composables/appPresence';
import type { NavigatePayload } from '@/shell/navigatePayload';
import { useSettingsConfig } from '@/views/settings/useSettingsConfig';
import { createLogger } from '@/utils/logger';
import { uiPlatform } from '@/utils/platform';
import { applyTrayIcon, applyTrayMenu } from './nativeTray';
import { buildTrayMenu, type TrayAction } from './trayMenuModel';
import { trayIconOpacities, trayUploadStatus } from './trayProgress';

const log = createLogger('Tray');

/** 与 src-tauri/src/commands/tray.rs 的 TRAY_HOVER_EVENT 一致 */
export const TRAY_HOVER_EVENT = 'tray-pointer-enter';
/** 与 src-tauri/src/commands/tray.rs 的 TRAY_CLIPBOARD_EVENT 一致（Windows：剪贴板一变就来） */
export const TRAY_CLIPBOARD_EVENT = 'tray-clipboard-changed';

async function revealMainWindow(): Promise<void> {
  const window = getCurrentWindow();
  await window.unminimize().catch((error) => log.warn('恢复主窗口最小化状态失败', error));
  await window.show();
  await window.setFocus();
  // 拿不到前台时不会有焦点事件，显示完自己重判「在不在屏」
  await refreshAppPresence();
}

async function openPage(payload: NavigatePayload): Promise<void> {
  await revealMainWindow();
  await tauriEmit('navigate-to', payload);
}

/** 连着来几次只跑最后一次：正在跑时记下「还要再跑」，跑完按最新状态补一次 */
function latestOnly(task: () => Promise<void>, label: string): () => void {
  let running = false;
  let again = false;
  const run = async (): Promise<void> => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await task().catch((error) => log.warn(`${label}失败`, error));
      } while (again);
    } finally {
      running = false;
    }
  };
  return () => { void run(); };
}

export function installTray(upload: UploadController): () => void {
  const platform = uiPlatform();
  const settings = useSettingsConfig();
  // Linux 收不到托盘悬停，没法在打开菜单前看剪贴板：第一项一直可点（decisions/tray.md）
  const clipboardHasImage = ref<boolean | null>(null);
  const taskbarLight = ref<boolean | null>(null);
  const unlisteners: UnlistenFn[] = [];
  const stops: WatchStopHandle[] = [];
  let disposed = false;

  // 几次上传可以同时进行：说最新的那次还在传的（新的那次先传完时接着说较早那次）
  const uploadStatus = computed(() => {
    const session = upload.sessions.find((s) => !s.finished);
    return session ? trayUploadStatus(upload.itemsOf(session)) : null;
  });
  const shortcutsEnabled = computed(() => ({ ...DEFAULT_CONFIG.globalShortcut!, ...upload.config.value.globalShortcut }).enabled);
  const rows = computed(() => buildTrayMenu({
    platform,
    hosts: upload.hosts.value,
    config: upload.config.value,
    clipboardHasImage: clipboardHasImage.value,
    upload: uploadStatus.value,
  }));

  // 一次要看两样（图片、文字），连着来几次时只认最后发起的那次
  let clipboardChecks = 0;
  async function refreshClipboard(): Promise<void> {
    if (platform === 'linux') return;
    const check = ++clipboardChecks;
    const hasImage = await clipboardHasUploadable();
    if (check === clipboardChecks) clipboardHasImage.value = hasImage;
  }

  async function refreshTaskbar(): Promise<void> {
    if (platform !== 'windows') return;
    taskbarLight.value = await invoke<boolean | null>('get_taskbar_light');
  }

  function toggleSetting(mutate: Parameters<typeof settings.patch>[1]): Promise<boolean> {
    return settings.patch(null, mutate);
  }

  async function run(action: TrayAction): Promise<void> {
    switch (action.type) {
      case 'uploadClipboard': return upload.pasteClipboard();
      case 'pickFiles': return upload.pickAndUpload({ showHint: false });
      case 'toggleHost': {
        const host = upload.hosts.value.find((h) => h.id === action.hostId);
        // 公共图床第一次启用要在主界面里确认风险（与首页同一个确认框）
        if (host && !host.selected && isPublicRiskService(action.hostId) && !upload.config.value.publicServiceRiskAccepted) await revealMainWindow();
        return upload.toggleHost(action.hostId);
      }
      case 'loginHost': return upload.loginHost(action.hostId);
      case 'manageHosts': return openPage({ view: 'settings', tab: 'hosting' });
      case 'setFormat': return upload.setFormat(action.format, { recopy: false });
      case 'customFormat':
        await upload.setFormat('custom', { recopy: false });
        return openPage({ view: 'settings', section: 'customTemplate' });
      case 'setCompression': return upload.setCompression(action.presetId);
      case 'compressionSettings': return openPage({ view: 'settings', section: 'compression' });
      case 'toggleAutoCopy':
        await toggleSetting((c) => { c.linkOutput = { ...DEFAULT_CONFIG.linkOutput!, ...c.linkOutput, autoCopy: c.linkOutput?.autoCopy === false }; });
        return;
      case 'toggleAutoUploadClipboard':
        await toggleSetting((c) => { c.appBehavior = { ...DEFAULT_CONFIG.appBehavior!, ...c.appBehavior, autoUploadClipboard: c.appBehavior?.autoUploadClipboard !== true }; });
        return;
      case 'toggleGlobalShortcut':
        await toggleSetting((c) => {
          const current = { ...DEFAULT_CONFIG.globalShortcut!, ...c.globalShortcut };
          c.globalShortcut = { ...current, enabled: !current.enabled };
        });
        return;
      case 'open': return revealMainWindow();
      case 'settings': return openPage('settings');
      case 'quit': return exit(0);
    }
  }

  // 菜单只在「长什么样」变了时重建（进度百分比不在菜单里，不会每帧重建）
  const menuSignature = computed(() => JSON.stringify(rows.value));
  const renderMenu = latestOnly(() => applyTrayMenu(rows.value, dispatch), '更新托盘菜单');

  /**
   * 点完之后要保证按配置重画过一次：系统菜单点勾选项时自己就把勾翻过去了，
   * 而配置可能没变（点已选中的格式、点「登录失效」的图床、取消了风险确认），签名不变就不会重建，勾会对不上。
   * 签名变了的，监听器已经在重画，不再多画一遍
   */
  function dispatch(action: TrayAction): void {
    const before = menuSignature.value;
    void run(action)
      .catch((error) => log.warn(`托盘菜单「${action.type}」失败`, error))
      .finally(() => { if (!disposed && upload.ready.value && menuSignature.value === before) renderMenu(); });
  }
  const iconSignature = computed(() => JSON.stringify([trayIconOpacities(uploadStatus.value, !shortcutsEnabled.value), taskbarLight.value]));
  const renderIcon = latestOnly(
    () => applyTrayIcon(trayIconOpacities(uploadStatus.value, !shortcutsEnabled.value), { platform, taskbarLight: taskbarLight.value }),
    '更新托盘图标',
  );

  const keep = (promise: Promise<UnlistenFn>) => promise
    .then((unlisten) => { if (disposed) unlisten(); else unlisteners.push(unlisten); })
    .catch((error) => log.warn('监听失败', error));

  // 配置读完之前先用 Rust 建的兜底菜单（打开 / 退出），免得启动时闪一下「未选择」
  stops.push(watch(upload.ready, (ready) => {
    if (!ready || disposed) return;
    stops.push(watch(menuSignature, renderMenu, { immediate: true }));
    stops.push(watch(iconSignature, renderIcon, { immediate: true }));
  }, { immediate: true }));

  void Promise.all([refreshClipboard(), refreshTaskbar()]).catch((error) => log.warn('读取剪贴板 / 任务栏状态失败', error));
  // 鼠标移到托盘图标上（Windows / macOS，打开菜单之前）：重看剪贴板与任务栏深浅
  keep(listen<{ taskbarLight: boolean | null }>(TRAY_HOVER_EVENT, (event) => {
    taskbarLight.value = event.payload.taskbarLight;
    void refreshClipboard().catch((error) => log.warn('读取剪贴板状态失败', error));
  }));
  // Windows：剪贴板一变就重看（悬停的通知有延迟，靠它保证打开菜单时已经是对的）
  keep(listen(TRAY_CLIPBOARD_EVENT, () => { void refreshClipboard().catch((error) => log.warn('读取剪贴板状态失败', error)); }));
  keep(listen(CLIPBOARD_IMAGE_EVENT, () => {
    clipboardChecks++;
    clipboardHasImage.value = platform === 'linux' ? null : true;
  }));
  // 切换 Windows 深浅模式时任务栏可能跟着变
  keep(getCurrentWindow().onThemeChanged(() => { void refreshTaskbar().catch((error) => log.warn('读取任务栏深浅失败', error)); }));

  return () => {
    disposed = true;
    stops.splice(0).forEach((stop) => stop());
    unlisteners.splice(0).forEach((unlisten) => unlisten());
  };
}
