// 主窗口在不在屏上：隐藏到托盘或最小化时，用户看不到应用内的通知，useToast 改发系统通知
// （托盘、全局快捷键、自动上传剪贴板发起的上传，结果都靠它送到用户眼前，交接说明 T02）。
// 判断结果缓存成一个同步可读的值，窗口焦点、尺寸、可见性一变就重新问一次系统。

import { getCurrentWindow } from '@tauri-apps/api/window';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { resolveResource } from '@tauri-apps/api/path';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { debounce } from '@/utils/debounce';
import { createLogger } from '@/utils/logger';

const log = createLogger('AppPresence');

/** 与 src-tauri/src/commands/tray.rs 的 WINDOW_PRESENCE_EVENT 一致：Rust 关到托盘 / 从托盘打开主窗口之后发 */
export const WINDOW_PRESENCE_EVENT = 'main-window-presence-changed';

/** 尺寸事件停下多久再重新判断（毫秒） */
const RESIZE_SETTLE_MS = 150;

let onScreen = true;

/** 主窗口此刻是否显示在屏上（没隐藏、没最小化）。装好之前按「在屏」算 */
export function isAppOnScreen(): boolean {
  return onScreen;
}

/** 每发起一次判断加一：几次同时在问系统时只认最后发起的那次（先问的可能晚回来，带着隐藏之前的旧答案） */
let asked = 0;

async function refresh(): Promise<void> {
  const mine = ++asked;
  const window = getCurrentWindow();
  const [visible, minimized] = await Promise.all([window.isVisible(), window.isMinimized()]);
  if (mine === asked) onScreen = visible && !minimized;
}

/** 应用自己隐藏 / 最小化主窗口之后调用（标题栏按钮）：不等焦点事件，马上重新判断 */
export async function refreshAppPresence(): Promise<void> {
  await refresh().catch((error) => log.warn('读取窗口状态失败', error));
}

/** 在应用外壳里装一次；返回卸载函数 */
export function installAppPresence(): () => void {
  const unlisteners: UnlistenFn[] = [];
  let disposed = false;
  const resync = () => { void refresh().catch((error) => log.warn('读取窗口状态失败', error)); };
  const keep = (promise: Promise<UnlistenFn>) => promise
    .then((unlisten) => { if (disposed) unlisten(); else unlisteners.push(unlisten); })
    .catch((error) => log.warn('监听窗口状态失败', error));

  // 拖动改大小时尺寸事件一串一串地来，停手再问一次
  const resyncLater = debounce(resync, RESIZE_SETTLE_MS);

  resync();
  const window = getCurrentWindow();
  // 关到托盘、从托盘打开（Rust 那几条路会专门通知）；换焦点；最小化 / 还原会改尺寸
  keep(listen(WINDOW_PRESENCE_EVENT, resync));
  keep(window.onFocusChanged(resync));
  keep(window.onResized(() => resyncLater()));
  document.addEventListener('visibilitychange', resync);

  return () => {
    disposed = true;
    resyncLater.cancel();
    document.removeEventListener('visibilitychange', resync);
    unlisteners.splice(0).forEach((unlisten) => unlisten());
  };
}

/** 发一条系统通知（第一次会请求权限）；失败只记日志 */
export async function notifySystem(title: string, body?: string): Promise<void> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    if (!granted) return;
    const icon = await resolveResource('icons/icon.png');
    sendNotification({ title, body, icon });
  } catch (error) {
    log.warn('系统通知发送失败', error);
  }
}

/** 测试用 */
export function __setAppOnScreenForTests(value: boolean): void {
  onScreen = value;
}
