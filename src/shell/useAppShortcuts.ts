// 应用内快捷键（命令面板里列出的那些）：Ctrl K 命令面板、Ctrl 1–4 切页面、Ctrl , 设置、Ctrl O 选择文件上传。
// macOS 用 ⌘。输入框里打字时只认 Ctrl K，其余不抢。

import { useRouter } from 'vue-router';
import { useEventListener } from '@vueuse/core';
import { useUploadController } from '@/composables/upload/useUploadController';
import { useCommandPalette } from './useCommandPalette';

const PAGE_KEYS: Record<string, string> = { '1': '/home', '2': '/gallery', '3': '/health', '4': '/hosts', ',': '/settings' };

function inTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || !!el?.isContentEditable;
}

export function useAppShortcuts() {
  const router = useRouter();
  const palette = useCommandPalette();
  const upload = useUploadController();

  useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key === 'k') {
      event.preventDefault();
      palette.toggle();
      return;
    }
    if (inTextField(event.target) || palette.open.value) return;
    const path = PAGE_KEYS[key];
    if (path) {
      event.preventDefault();
      void router.push(path);
    } else if (key === 'o') {
      event.preventDefault();
      void upload.pickAndUpload();
    }
  });
}
