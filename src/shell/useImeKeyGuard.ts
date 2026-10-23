// 输入法正在选字时按的键归输入法：Enter 把打出的字母上屏、↑ ↓ 翻候选、Esc 取消选字，
// 界面不能同时把它当成「提交」「换一项」「关弹窗」。
// WebView2（Chromium）选字时照规范报 isComposing = true；macOS 的 WebKit 上屏的那一下 Enter 键名照旧是 Enter，
// 还排在 compositionend 之后（isComposing 已是 false，WebKit bug 165004），只能靠 keyCode 229 认出来。
// 自己记 compositionstart / compositionend 也拦不住：记号在这一下 Enter 到来之前就清掉了。

import { useEventListener } from '@vueuse/core';

/** 这一下按键是给输入法的（正在选字，或刚用它上屏） */
export function isImeKeystroke(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

export function useImeKeyGuard(): void {
  // 挂在 window 的捕获阶段：比界面里任何一个按键监听都早，拦下后谁也收不到
  useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    if (isImeKeystroke(event)) event.stopImmediatePropagation();
  }, { capture: true });
}
