// 全局上传入口（交接说明 8.1）：图片拖进窗口任何一页都会出现遮罩并上传；Ctrl+V / ⌘V 粘贴剪贴板图片。

import { onMounted, onUnmounted, reactive } from 'vue';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useEventListener } from '@vueuse/core';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { useUploadController } from '@/composables/upload/useUploadController';
import { createLogger } from '@/utils/logger';
import { summarizeDrop } from './dropFiles';

const log = createLogger('GlobalUploadInput');

export interface DropOverlayState {
  active: boolean;
  imageCount: number;
  skippedText: string;
}

/** 有对话框或命令面板开着：拖入、粘贴都不接，免得在弹窗背后悄悄传图 */
function modalOpen(): boolean {
  return !!document.querySelector('.pn-dialog[data-state="open"], .command-palette[data-state="open"]');
}

function isTextTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export function useGlobalUploadInput() {
  const upload = useUploadController();
  const overlay = reactive<DropOverlayState>({ active: false, imageCount: 0, skippedText: '' });
  let unlisten: UnlistenFn | null = null;
  let disposed = false;

  function reset() {
    overlay.active = false;
    overlay.imageCount = 0;
    overlay.skippedText = '';
  }

  onMounted(async () => {
    try {
      const stop = await getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === 'leave' || modalOpen()) {
          reset();
          return;
        }
        if (payload.type === 'enter') {
          const summary = summarizeDrop(payload.paths);
          overlay.active = true;
          overlay.imageCount = summary.images.length;
          overlay.skippedText = summary.skippedText;
        } else if (payload.type === 'drop') {
          const summary = summarizeDrop(payload.paths);
          reset();
          const canUpload = upload.hosts.value.some((h) => h.selected);
          if (canUpload && summary.images.length > 0) void upload.uploadFiles(summary.images);
        }
      });
      if (disposed) stop();
      else unlisten = stop;
    } catch (error) {
      log.error('设置拖放监听失败', error);
    }
  });

  onUnmounted(() => {
    disposed = true;
    unlisten?.();
  });

  // Ctrl+V / ⌘V：不在输入框里时上传剪贴板图片（任何页面）
  useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'v' || event.shiftKey || event.altKey) return;
    if (isTextTarget(event.target) || modalOpen()) return;
    event.preventDefault();
    void upload.pasteClipboard();
  });

  // 拖放悬停时 Esc 取消遮罩
  useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape' && overlay.active) reset();
  });

  return { overlay };
}
