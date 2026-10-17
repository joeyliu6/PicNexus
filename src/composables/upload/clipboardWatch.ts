// 自动上传剪贴板（设置 › 上传与链接）：开关跟着配置走（启动时一次，之后每次配置变化），
// 后台发现剪贴板里出现新图片（Rust 侧 clipboard_watch）就照「粘贴上传」那条路传。
// 应用级常驻，装在外壳里；不必先打开设置页。
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { readFreshConfig } from '@/store/instances';
import { useToast } from '@/composables/useToast';
import { getErrorMessage } from '@/types/errors';
import { createLogger } from '@/utils/logger';

const log = createLogger('ClipboardWatch');

/** 与 src-tauri/src/commands/clipboard_watch.rs 的 CLIPBOARD_IMAGE_EVENT 一致 */
export const CLIPBOARD_IMAGE_EVENT = 'clipboard-image-changed';

export interface ClipboardWatchTarget {
  /** 上传剪贴板里的图（与 Ctrl+V 同一条路） */
  pasteClipboard: () => Promise<void>;
}

export function installClipboardWatch(target: ClipboardWatchTarget): () => void {
  let enabled: boolean | null = null;
  let disposed = false;
  const unlisteners: UnlistenFn[] = [];

  // 后台真的切过去了才记下：失败时保持原值，下次配置变化再试
  async function sync(): Promise<void> {
    const config = await readFreshConfig();
    const next = config?.appBehavior?.autoUploadClipboard === true;
    if (next === enabled || disposed) return;
    try {
      await invoke('set_clipboard_watch', { enabled: next });
    } catch (error) {
      log.warn('切换自动上传剪贴板失败', error);
      if (next) useToast().error('未能开启自动上传剪贴板', `${getErrorMessage(error) || '后台监听没有启动'}，请关闭后重新打开`);
      return;
    }
    enabled = next;
  }

  const resync = () => { void sync().catch((error) => log.warn('读取自动上传剪贴板设置失败', error)); };
  resync();
  const keep = (promise: Promise<UnlistenFn>) => promise
    .then((unlisten) => { if (disposed) unlisten(); else unlisteners.push(unlisten); })
    .catch((error) => log.warn('监听失败', error));
  keep(listen('config-updated', resync));
  keep(listen(CLIPBOARD_IMAGE_EVENT, () => {
    if (!enabled) return;
    void target.pasteClipboard().catch((error) => log.warn('自动上传剪贴板失败', error));
  }));

  return () => {
    disposed = true;
    unlisteners.splice(0).forEach((unlisten) => unlisten());
    if (enabled) void invoke('set_clipboard_watch', { enabled: false }).catch(() => undefined);
  };
}
