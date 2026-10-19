// 全局上传入口（交接说明 8.1）：图片拖进窗口任何一页都会出现遮罩并上传；Ctrl+V / ⌘V 粘贴剪贴板图片。

import { computed, onMounted, onUnmounted, reactive } from 'vue';
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

/** 有对话框、命令面板或新手引导开着：拖入、粘贴都不接，免得在弹窗背后悄悄传图 */
function modalOpen(): boolean {
  return !!document.querySelector('.pn-dialog[data-state="open"], .command-palette[data-state="open"], .onboarding[data-state="open"]');
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
  /** 这次拖入已按 Esc 取消（H07）：松手不上传，直到下一次拖入 */
  let cancelled = false;

  const hasHost = () => upload.hosts.value.some((h) => h.selected);

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
          cancelled = false;
          const summary = summarizeDrop(payload.paths);
          overlay.active = true;
          overlay.imageCount = summary.images.length;
          overlay.skippedText = summary.skippedText;
        } else if (payload.type === 'drop') {
          const summary = summarizeDrop(payload.paths);
          reset();
          if (cancelled) {
            cancelled = false;
            return;
          }
          if (hasHost() && summary.images.length > 0) void upload.uploadFiles(summary.images);
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

  // 拖放悬停时 Esc 取消这次拖入（H07「Esc 或拖出窗口即取消」）
  useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !overlay.active) return;
    cancelled = true;
    reset();
  });

  /** ⑦ 拖入感应（M07）：松开就会上传时，侧栏 Logo 的花瓣张开「接住」；拖出、松手、Esc 即合拢 */
  const receiving = computed(() => overlay.active && overlay.imageCount > 0 && hasHost());

  return { overlay, receiving };
}
