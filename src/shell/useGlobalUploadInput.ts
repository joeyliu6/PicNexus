// 全局上传入口（交接说明 8.1）：图片拖进窗口任何一页都会出现遮罩并上传；Ctrl+V / ⌘V 粘贴剪贴板图片。
// 过渡期：链接健康页仍是旧页面，它的「文档修复」自己接拖入的 .md，那一页先不接管拖放。

import { onMounted, onUnmounted, reactive } from 'vue';
import { useRoute } from 'vue-router';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useEventListener } from '@vueuse/core';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { useUploadController } from '@/composables/upload/useUploadController';
import { createLogger } from '@/utils/logger';
import { summarizeDrop } from './dropFiles';

const log = createLogger('GlobalUploadInput');

/** 这些页面自己处理拖入（见文件头） */
const PAGES_WITH_OWN_DROP = new Set(['/health']);

export interface DropOverlayState {
  active: boolean;
  imageCount: number;
  skippedText: string;
}

function isTextTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export function useGlobalUploadInput() {
  const route = useRoute();
  const upload = useUploadController();
  const overlay = reactive<DropOverlayState>({ active: false, imageCount: 0, skippedText: '' });
  let unlisten: UnlistenFn | null = null;
  let disposed = false;

  const handlesDrop = () => !PAGES_WITH_OWN_DROP.has(route.path);

  function reset() {
    overlay.active = false;
    overlay.imageCount = 0;
    overlay.skippedText = '';
  }

  onMounted(async () => {
    try {
      const stop = await getCurrentWebview().onDragDropEvent((event) => {
        if (!handlesDrop()) return;
        const payload = event.payload;
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
        } else if (payload.type === 'leave') {
          reset();
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
    if (isTextTarget(event.target) || document.querySelector('.pn-dialog[data-state="open"]')) return;
    event.preventDefault();
    void upload.pasteClipboard();
  });

  // 拖放悬停时 Esc 取消遮罩
  useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape' && overlay.active) reset();
  });

  return { overlay };
}
