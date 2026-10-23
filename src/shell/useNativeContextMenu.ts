// 右键不弹浏览器自己的菜单（后退、刷新、另存为、打印……）：桌面应用里那是网页的样子。
// 输入框里照常弹（剪切、复制、粘贴），选中的字上照常弹（复制）；
// 自己画了右键菜单的地方（图床页左栏）由 Reka 先拦下，这里不再管。

import { useEventListener } from '@vueuse/core';

/** 这些 input 不能打字，右键弹出来的只会是网页菜单 */
const NOT_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

/** 右键的地方在能打字的框里（只读的框也算：照样能复制） */
function inTextBox(el: Element): boolean {
  const box = el.closest('input, textarea, [contenteditable]');
  if (box instanceof HTMLInputElement) return !NOT_TEXT_INPUTS.has(box.type);
  if (box instanceof HTMLTextAreaElement) return true;
  return box instanceof HTMLElement && box.isContentEditable;
}

/** 浏览器自己的右键菜单留不留：输入框里、选中的字上留着，其余地方不弹 */
export function keepsNativeMenu(target: EventTarget | null, selection: Selection | null): boolean {
  if (!(target instanceof Element)) return false;
  if (inTextBox(target)) return true;
  return !!selection && !selection.isCollapsed && selection.toString().trim() !== '' && selection.containsNode(target, true);
}

export function useNativeContextMenu(): void {
  useEventListener(window, 'contextmenu', (event: MouseEvent) => {
    if (event.defaultPrevented || keepsNativeMenu(event.target, window.getSelection())) return;
    event.preventDefault();
  });
}
